// ============================================================================
// import-invoice — Supabase Edge Function (RECEIVING side)
// ----------------------------------------------------------------------------
// Deploy this on the website that should RECEIVE invoices. The sending site
// (aminocan) POSTs an invoice payload here; this function validates it, checks
// what already exists, and (in commit mode) writes the invoice, its line
// items, and payments into this project's database — matching the customer by
// email and each product by SKU, creating them when missing.
//
//   POST body: {
//     source, mode: "preview" | "commit", overwrite?: boolean,
//     invoice:   { invoice_number, issue_date, due_date, subtotal, tax_rate,
//                  tax_total, shipping_cost, processing_fee, show_processing_fee,
//                  total, status, currency, with_labels, fulfillment_type,
//                  notes, customer_name, customer_email, customer_phone },
//     customer:  { email, first_name, last_name, phone, shipping_* } | null,
//     line_items:[{ sku, product_name, strength, description, qty, unit_price,
//                   discount_pct, line_total, price_type }],
//     payments:  [{ amount, method, reference_note, paid_at }],
//   }
//
//   Auth: Authorization: Bearer <IMPORT_INVOICE_SECRET>
//
//   mode "preview" writes NOTHING. It returns a report: are our columns
//   compatible (columns_ok / missing_columns / missing_required / missing_tables)
//   and do the invoice / customer / products already exist? The sending admin
//   reviews this before committing.
//
//   mode "commit" performs the writes. If the invoice number already exists it
//   is skipped (status "skipped") unless overwrite=true, in which case the
//   existing invoice is replaced.
//
// Robust to a *similar* (not identical) schema: only columns that actually
// exist here are written — anything the sender includes that we don't have
// (e.g. tax_rate, processing_fee, with_labels) is dropped and reported, never
// fatal. Commit is only blocked when a genuinely REQUIRED column or table is
// missing.
//
// Required secrets (set with `supabase secrets set`):
//   IMPORT_INVOICE_SECRET   — must match the sender's destination secret
// Provided automatically by the Edge runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Mode = "preview" | "commit";
type Client = ReturnType<typeof createClient>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Columns we would like to write, per table (the full candidate set). The real
// set is intersected with what actually exists here.
const INVOICE_COLS = [
  "invoice_number", "customer_id", "customer_name", "customer_email",
  "customer_phone", "issue_date", "due_date", "subtotal", "tax_rate",
  "tax_total", "shipping_cost", "processing_fee", "show_processing_fee",
  "total", "status", "currency", "with_labels", "fulfillment_type", "notes",
];
const CUSTOMER_COLS = [
  "email", "first_name", "last_name", "phone", "password_hash", "role",
  "shipping_address", "shipping_city", "shipping_state",
  "shipping_postal_code", "shipping_country",
];
const PRODUCT_COLS = ["name", "sku", "price", "strength", "active"];
const LINE_ITEM_COLS = [
  "invoice_id", "product_id", "description", "qty", "unit_price",
  "discount_pct", "line_total", "price_type",
];
const PAYMENT_COLS = [
  "invoice_id", "amount", "method", "reference_note", "paid_at",
];

// Columns that MUST exist for an import to be possible. Missing any of these
// blocks a commit (everything else is optional and simply dropped).
const REQUIRED: Record<string, string[]> = {
  invoices: [
    "invoice_number", "issue_date", "due_date", "subtotal", "tax_total",
    "shipping_cost", "total", "status",
  ],
  customers: ["email"],
  products: ["name", "sku", "price"],
  invoice_line_items: ["invoice_id", "description", "qty", "unit_price", "line_total"],
  // payments is optional entirely — no required columns.
};
// Tables that must exist for a commit to proceed.
const REQUIRED_TABLES = ["invoices", "invoice_line_items", "customers", "products"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function isMissingTable(e: { code?: string; message?: string }): boolean {
  const code = e.code ?? "";
  const msg = e.message ?? "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    code === "PGRST202" ||
    /find the table/i.test(msg) ||
    /relation .* does not exist/i.test(msg)
  );
}

function isMissingColumn(e: { code?: string; message?: string }): boolean {
  const code = e.code ?? "";
  const msg = e.message ?? "";
  return code === "42703" || code === "PGRST204" || /column .* does not exist/i.test(msg);
}

interface Probe {
  exists: boolean; // does the table exist / is it reachable?
  existing: string[];
  missing: string[];
}

// Return which of `cols` exist on `table`, and whether the table exists at all.
async function probeTable(sb: Client, table: string, cols: string[]): Promise<Probe> {
  const { error } = await sb.from(table).select(cols.join(",")).limit(1);
  if (!error) return { exists: true, existing: cols, missing: [] };
  if (isMissingTable(error)) return { exists: false, existing: [], missing: cols };
  // Table exists but at least one column is unknown — split them.
  const existing: string[] = [];
  const missing: string[] = [];
  for (const c of cols) {
    const { error: e } = await sb.from(table).select(c).limit(1);
    if (e && isMissingColumn(e)) missing.push(c);
    else if (e && isMissingTable(e)) return { exists: false, existing: [], missing: cols };
    else existing.push(c);
  }
  return { exists: true, existing, missing };
}

// Keep only the keys of `obj` that are in `allowed`.
function pick(obj: Record<string, unknown>, allowed: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of allowed) if (k in obj) out[k] = obj[k];
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // --- Auth: shared secret bearer token -----------------------------------
  const secret = Deno.env.get("IMPORT_INVOICE_SECRET");
  if (!secret) return json({ ok: false, error: "Server missing IMPORT_INVOICE_SECRET" }, 500);
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (token !== secret) return json({ ok: false, error: "Unauthorized" }, 401);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const mode: Mode = payload?.mode === "commit" ? "commit" : "preview";
  const overwrite = Boolean(payload?.overwrite);
  const invoice = payload?.invoice;
  const customer = payload?.customer ?? null;
  const lineItems: any[] = Array.isArray(payload?.line_items) ? payload.line_items : [];
  const payments: any[] = Array.isArray(payload?.payments) ? payload.payments : [];

  if (!invoice?.invoice_number) {
    return json({ ok: false, error: "Missing invoice.invoice_number" }, 400);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // --- 1. Schema compatibility check --------------------------------------
  const cols: Record<string, Probe> = {
    invoices: await probeTable(sb, "invoices", INVOICE_COLS),
    customers: await probeTable(sb, "customers", CUSTOMER_COLS),
    products: await probeTable(sb, "products", PRODUCT_COLS),
    invoice_line_items: await probeTable(sb, "invoice_line_items", LINE_ITEM_COLS),
    payments: await probeTable(sb, "payments", PAYMENT_COLS),
  };

  // Missing optional columns (informational — these values are dropped).
  const missing_columns: Record<string, string[]> = {};
  for (const [t, r] of Object.entries(cols)) {
    if (r.exists && r.missing.length) missing_columns[t] = r.missing;
  }
  // Missing tables.
  const missing_tables = Object.entries(cols)
    .filter(([, r]) => !r.exists)
    .map(([t]) => t);
  // Missing REQUIRED columns (blocking).
  const missing_required: Record<string, string[]> = {};
  for (const [t, req] of Object.entries(REQUIRED)) {
    const r = cols[t];
    const miss = !r.exists ? req : req.filter((c) => r.missing.includes(c));
    if (miss.length) missing_required[t] = miss;
  }
  const requiredTablesOk = REQUIRED_TABLES.every((t) => cols[t].exists);
  const columns_ok =
    requiredTablesOk && Object.keys(missing_required).length === 0;

  // --- 2. Existence checks -------------------------------------------------
  const { data: existingInvoice } = await sb
    .from("invoices")
    .select("id, invoice_number")
    .eq("invoice_number", invoice.invoice_number)
    .maybeSingle();

  const custEmail = customer?.email ?? invoice.customer_email ?? null;
  let existingCustomer: { id: string } | null = null;
  if (custEmail && cols.customers.exists) {
    const { data } = await sb
      .from("customers")
      .select("id")
      .eq("email", custEmail)
      .maybeSingle();
    existingCustomer = (data as any) ?? null;
  }

  const skus = [...new Set(lineItems.map((li) => li.sku).filter(Boolean))] as string[];
  const productReport: Array<{ sku: string | null; exists: boolean }> = [];
  const existingProductBySku: Record<string, string> = {};
  if (skus.length && cols.products.exists) {
    const { data } = await sb.from("products").select("id, sku").in("sku", skus);
    for (const p of data ?? []) existingProductBySku[(p as any).sku] = (p as any).id;
  }
  for (const sku of skus) {
    productReport.push({ sku, exists: Boolean(existingProductBySku[sku]) });
  }

  const baseReport = {
    ok: true,
    mode,
    columns_ok,
    missing_columns,
    missing_required,
    missing_tables,
    invoice_exists: Boolean(existingInvoice),
    customer_exists: Boolean(existingCustomer),
    products: productReport,
  };

  // --- Preview: report only, no writes ------------------------------------
  if (mode === "preview") {
    return json(baseReport);
  }

  // --- Commit --------------------------------------------------------------
  // Only block when a genuinely required column/table is missing. Optional
  // columns the sender includes but we lack are simply dropped below.
  if (!columns_ok) {
    return json({
      ...baseReport,
      status: "failed",
      error:
        missing_tables.length
          ? `Missing required tables: ${missing_tables.join(", ")}`
          : `Missing required columns: ${Object.entries(missing_required)
              .map(([t, c]) => `${t} (${c.join(", ")})`)
              .join("; ")}`,
    }, 422);
  }

  // Existing invoice: skip unless overwrite.
  if (existingInvoice && !overwrite) {
    return json({
      ...baseReport,
      status: "skipped",
      message: "Invoice already exists on this site",
      remote_invoice_id: existingInvoice.id,
      remote_invoice_number: existingInvoice.invoice_number,
    });
  }

  const created = { customer: false, products: 0, payments: 0 };

  try {
    // 2a. Resolve / create customer.
    let customerId: string | null = existingCustomer?.id ?? null;
    if (!customerId && custEmail) {
      const candidate: Record<string, unknown> = {
        email: custEmail,
        first_name: customer?.first_name ?? invoice.customer_name?.split(" ")?.[0] ?? "",
        last_name:
          customer?.last_name ??
          invoice.customer_name?.split(" ")?.slice(1).join(" ") ??
          "",
        phone: customer?.phone ?? invoice.customer_phone ?? null,
        // Imported customers can't log in until they reset — placeholder only.
        password_hash: "imported-no-login",
        role: "customer",
        shipping_address: customer?.shipping_address ?? null,
        shipping_city: customer?.shipping_city ?? null,
        shipping_state: customer?.shipping_state ?? null,
        shipping_postal_code: customer?.shipping_postal_code ?? null,
        shipping_country: customer?.shipping_country ?? null,
      };
      const { data: newCust, error: custErr } = await sb
        .from("customers")
        .insert(pick(candidate, cols.customers.existing))
        .select("id")
        .single();
      if (custErr) throw new Error(`Customer create failed: ${custErr.message}`);
      customerId = (newCust as any).id;
      created.customer = true;
    }

    // 2b. Resolve / create products by SKU.
    const productIdBySku: Record<string, string> = { ...existingProductBySku };
    for (const li of lineItems) {
      if (!li.sku || productIdBySku[li.sku]) continue;
      const candidate: Record<string, unknown> = {
        name: li.product_name || li.description || li.sku,
        sku: li.sku,
        price: Number(li.unit_price) || 0,
        strength: li.strength ?? null,
        active: true,
      };
      const { data: newProd, error: prodErr } = await sb
        .from("products")
        .insert(pick(candidate, cols.products.existing))
        .select("id")
        .single();
      if (prodErr) throw new Error(`Product create failed (${li.sku}): ${prodErr.message}`);
      productIdBySku[li.sku] = (newProd as any).id;
      created.products += 1;
    }

    // 2c. Overwrite: drop the existing invoice (cascades line items/payments).
    if (existingInvoice && overwrite) {
      const { error: delErr } = await sb.from("invoices").delete().eq("id", existingInvoice.id);
      if (delErr) throw new Error(`Overwrite delete failed: ${delErr.message}`);
    }

    // 2d. Insert the invoice.
    const invCandidate: Record<string, unknown> = {
      invoice_number: invoice.invoice_number,
      customer_id: customerId,
      customer_name: invoice.customer_name ?? null,
      customer_email: invoice.customer_email ?? custEmail,
      customer_phone: invoice.customer_phone ?? null,
      issue_date: invoice.issue_date,
      due_date: invoice.due_date,
      subtotal: invoice.subtotal ?? 0,
      tax_rate: invoice.tax_rate ?? 0,
      tax_total: invoice.tax_total ?? 0,
      shipping_cost: invoice.shipping_cost ?? 0,
      processing_fee: invoice.processing_fee ?? 0,
      show_processing_fee: invoice.show_processing_fee ?? false,
      total: invoice.total ?? 0,
      status: invoice.status ?? "sent",
      currency: invoice.currency ?? "CAD",
      with_labels: invoice.with_labels ?? true,
      fulfillment_type: invoice.fulfillment_type ?? "shipment",
      notes: invoice.notes ?? null,
    };
    const { data: newInv, error: invErr } = await sb
      .from("invoices")
      .insert(pick(invCandidate, cols.invoices.existing))
      .select("id, invoice_number")
      .single();
    if (invErr) throw new Error(`Invoice create failed: ${invErr.message}`);
    const invoiceId = (newInv as any).id;

    // 2e. Line items.
    if (lineItems.length && cols.invoice_line_items.exists) {
      const rows = lineItems.map((li) =>
        pick(
          {
            invoice_id: invoiceId,
            product_id: li.sku ? productIdBySku[li.sku] ?? null : null,
            description: li.description ?? li.product_name ?? "",
            qty: Number(li.qty) || 1,
            unit_price: Number(li.unit_price) || 0,
            discount_pct: Number(li.discount_pct) || 0,
            line_total: Number(li.line_total) || 0,
            price_type: li.price_type ?? "box",
          },
          cols.invoice_line_items.existing,
        ),
      );
      const { error: liErr } = await sb.from("invoice_line_items").insert(rows);
      if (liErr) throw new Error(`Line items create failed: ${liErr.message}`);
    }

    // 2f. Payments (skipped if this site has no payments table).
    let payments_skipped = false;
    if (payments.length) {
      if (!cols.payments.exists) {
        payments_skipped = true;
      } else {
        const rows = payments.map((p) =>
          pick(
            {
              invoice_id: invoiceId,
              amount: Number(p.amount) || 0,
              method: p.method ?? "other",
              reference_note: p.reference_note ?? null,
              paid_at: p.paid_at ?? new Date().toISOString(),
            },
            cols.payments.existing,
          ),
        );
        const { error: payErr } = await sb.from("payments").insert(rows);
        if (payErr) throw new Error(`Payments create failed: ${payErr.message}`);
        created.payments = payments.length;
      }
    }

    return json({
      ...baseReport,
      status: "success",
      remote_invoice_id: invoiceId,
      remote_invoice_number: (newInv as any).invoice_number,
      created,
      payments_skipped,
      message: existingInvoice ? "Invoice overwritten" : "Invoice imported",
    });
  } catch (e) {
    return json({
      ...baseReport,
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
    }, 500);
  }
});
