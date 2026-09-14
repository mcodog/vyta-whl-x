import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Invoice export — server-side payload builder + destination caller.
// ---------------------------------------------------------------------------
// The far side has a *similar* schema but different row ids, so everything is
// sent by value: customers are matched on email, products on SKU, and the
// invoice on its number. The receiving `import-invoice` Edge Function decides
// what to match, create, or skip. See supabase/functions/import-invoice.
// ---------------------------------------------------------------------------

/** A destination row (secret included — only ever used server-side). */
export interface ExportDestination {
  id: string;
  label: string;
  edge_function_url: string;
  secret: string;
  enabled: boolean;
  notes: string | null;
}

export interface ExportCustomer {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  shipping_address: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
  shipping_country: string | null;
}

export interface ExportLineItem {
  sku: string | null;
  product_name: string | null;
  strength: string | null;
  description: string;
  qty: number;
  unit_price: number;
  discount_pct: number;
  line_total: number;
  price_type: "box" | "vial";
}

export interface ExportPayment {
  amount: number;
  method: string;
  reference_note: string | null;
  paid_at: string;
}

export interface ExportInvoice {
  invoice_number: string;
  order_number: string | null;
  issue_date: string;
  due_date: string;
  subtotal: number;
  tax_rate: number;
  tax_total: number;
  shipping_cost: number;
  processing_fee: number;
  show_processing_fee: boolean;
  total: number;
  status: string;
  currency: string;
  with_labels: boolean;
  fulfillment_type: string;
  notes: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
}

/** The full body POSTed to a destination Edge Function. */
export interface ExportPayload {
  source: string;
  mode: "preview" | "commit";
  /** When committing, overwrite an invoice that already exists on the far side. */
  overwrite?: boolean;
  invoice: ExportInvoice;
  customer: ExportCustomer | null;
  line_items: ExportLineItem[];
  payments: ExportPayment[];
}

/** Identifies the calling site in the payload (`source`). */
export const EXPORT_SOURCE = "aminocan";

/**
 * Build the normalized, by-value payload for a single invoice. Returns null if
 * the invoice does not exist. `mode`/`overwrite` are filled in by the caller.
 */
export async function buildInvoiceExportPayload(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<Omit<ExportPayload, "mode" | "overwrite"> | null> {
  const { data, error } = await supabase
    .from("invoices")
    .select(
      `
      *,
      customer:customers!customer_id (
        email, first_name, last_name, phone,
        shipping_address, shipping_city, shipping_state,
        shipping_postal_code, shipping_country
      ),
      order:orders!order_id ( order_number ),
      line_items:invoice_line_items (
        *, product:products ( sku, name, strength )
      ),
      payments ( amount, method, reference_note, paid_at )
    `,
    )
    .eq("id", invoiceId)
    .single();

  if (error || !data) return null;

  const inv = data as any;

  const customer: ExportCustomer | null = inv.customer
    ? {
        email: inv.customer.email ?? null,
        first_name: inv.customer.first_name ?? null,
        last_name: inv.customer.last_name ?? null,
        phone: inv.customer.phone ?? null,
        shipping_address: inv.customer.shipping_address ?? null,
        shipping_city: inv.customer.shipping_city ?? null,
        shipping_state: inv.customer.shipping_state ?? null,
        shipping_postal_code: inv.customer.shipping_postal_code ?? null,
        shipping_country: inv.customer.shipping_country ?? null,
      }
    : null;

  const line_items: ExportLineItem[] = (inv.line_items ?? []).map((li: any) => ({
    sku: li.product?.sku ?? null,
    product_name: li.product?.name ?? null,
    strength: li.product?.strength ?? null,
    description: li.description,
    qty: Number(li.qty),
    unit_price: Number(li.unit_price),
    discount_pct: Number(li.discount_pct ?? 0),
    line_total: Number(li.line_total),
    price_type: (li.price_type as "box" | "vial") ?? "box",
  }));

  const payments: ExportPayment[] = (inv.payments ?? []).map((p: any) => ({
    amount: Number(p.amount),
    method: p.method,
    reference_note: p.reference_note ?? null,
    paid_at: p.paid_at,
  }));

  const invoice: ExportInvoice = {
    invoice_number: inv.invoice_number,
    order_number: inv.order?.order_number ?? null,
    issue_date: inv.issue_date,
    due_date: inv.due_date,
    subtotal: Number(inv.subtotal),
    tax_rate: Number(inv.tax_rate),
    tax_total: Number(inv.tax_total),
    shipping_cost: Number(inv.shipping_cost),
    processing_fee: Number(inv.processing_fee ?? 0),
    show_processing_fee: Boolean(inv.show_processing_fee),
    total: Number(inv.total),
    status: inv.status,
    currency: inv.currency ?? "CAD",
    with_labels: Boolean(inv.with_labels),
    fulfillment_type: inv.fulfillment_type ?? "shipment",
    notes: inv.notes ?? null,
    customer_name: inv.customer_name ?? null,
    customer_email: inv.customer_email ?? null,
    customer_phone: inv.customer_phone ?? null,
  };

  return { source: EXPORT_SOURCE, invoice, customer, line_items, payments };
}

/** What the far side reports back (best-effort; fields are optional). */
export interface DestinationReport {
  ok: boolean;
  mode?: "preview" | "commit";
  /** Whether every REQUIRED column/table exists on the far side. */
  columns_ok?: boolean;
  /** Per-table lists of OPTIONAL columns the far side lacks (values dropped). */
  missing_columns?: Record<string, string[]>;
  /** Per-table lists of REQUIRED columns the far side lacks (blocking). */
  missing_required?: Record<string, string[]>;
  /** Tables the far side is missing entirely. */
  missing_tables?: string[];
  /** commit only: payments were dropped because the far side has no table. */
  payments_skipped?: boolean;
  /** Existence checks. */
  invoice_exists?: boolean;
  customer_exists?: boolean;
  /** Per-SKU: does the product already exist on the far side? */
  products?: Array<{ sku: string | null; exists: boolean }>;
  /** commit only. */
  status?: "success" | "skipped" | "failed";
  remote_invoice_id?: string | null;
  remote_invoice_number?: string | null;
  created?: { customer?: boolean; products?: number; payments?: number };
  message?: string;
  error?: string;
}

export interface DestinationCallResult {
  ok: boolean;
  httpStatus: number;
  report: DestinationReport | null;
  error: string | null;
}

/**
 * POST a payload to a destination Edge Function with the shared secret as a
 * bearer token. Never throws — network/parse failures come back on `error`.
 */
export async function callDestination(
  dest: Pick<ExportDestination, "edge_function_url" | "secret">,
  payload: ExportPayload,
): Promise<DestinationCallResult> {
  try {
    const res = await fetch(dest.edge_function_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dest.secret}`,
      },
      body: JSON.stringify(payload),
      // Guard against a hung far side.
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let report: DestinationReport | null = null;
    try {
      report = text ? (JSON.parse(text) as DestinationReport) : null;
    } catch {
      report = null;
    }
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        report,
        error:
          report?.error ||
          report?.message ||
          `Destination returned ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
      };
    }
    return { ok: true, httpStatus: res.status, report, error: null };
  } catch (e: any) {
    const msg =
      e?.name === "TimeoutError"
        ? "Destination timed out after 30s"
        : e?.message || "Failed to reach destination";
    return { ok: false, httpStatus: 0, report: null, error: msg };
  }
}
