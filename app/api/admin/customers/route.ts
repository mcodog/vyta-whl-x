import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logAuditServer } from "@/lib/admin/audit";
import { loadCustomerRosters } from "@/lib/admin/sales-attribution";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type Role = "admin" | "assistant" | "affiliate" | "customer";

async function getCaller(request: NextRequest): Promise<{ id: string; role: Role } | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return { id: user.id, role: (customer?.role || "customer") as Role };
}

// Copy a client's saved price list onto a newly-bound customer, so the client's
// prices apply to customers they add later (not just existing ones). Best-effort:
// pricing should never block customer creation.
async function applyAffiliatePricelist(customerId: string, affiliateId: string) {
  try {
    const { data: list } = await supabase
      .from("affiliate_price_overrides")
      .select("product_id, override_price")
      .eq("affiliate_id", affiliateId);
    if (!list || list.length === 0) return;
    await supabase.from("customer_price_overrides").upsert(
      list.map((r) => ({
        customer_id: customerId,
        product_id: r.product_id,
        override_price: r.override_price,
      })),
      { onConflict: "customer_id,product_id" },
    );
  } catch (e) {
    console.error("Failed to apply affiliate price list to new customer:", e);
  }
}

// Fallback rollup: paginate the invoices table in memory (beats PostgREST's
// 1000-row cap) when the get_customer_invoice_rollup RPC is unavailable — e.g.
// before the migration has run. Mirrors the RPC exactly: invoice_count excludes
// backorder child invoices; invoiced_total is non-backorder, non-cancelled gross.
async function scanCustomerInvoiceRollup(
  scopeIds: string[] | null,
): Promise<Record<string, { invoice_count: number; invoiced_total: number }>> {
  const agg: Record<string, { invoice_count: number; invoiced_total: number }> = {};
  if (scopeIds && scopeIds.length === 0) return agg;
  const PAGE = 1000;
  const MAX_PAGES = 40; // safety cap (~40k invoices)
  for (let p = 0; p < MAX_PAGES; p++) {
    let q = supabase
      .from("invoices")
      .select("customer_id, total, status, is_backorder")
      .not("customer_id", "is", null)
      .range(p * PAGE, p * PAGE + PAGE - 1);
    if (scopeIds) q = q.in("customer_id", scopeIds);
    const { data: rows, error } = await q;
    if (error || !rows) break;
    for (const r of rows) {
      const cid = r.customer_id as string | null;
      if (!cid) continue;
      const b = agg[cid] ?? (agg[cid] = { invoice_count: 0, invoiced_total: 0 });
      if (r.is_backorder) continue;
      b.invoice_count += 1;
      if (r.status !== "cancelled") b.invoiced_total += Number(r.total) || 0;
    }
    if (rows.length < PAGE) break;
  }
  return agg;
}

type ShipToClient = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  city: string | null;
};

// Ship-to clients per customer, paginated past PostgREST's 1000-row cap. Pass
// scopeIds to limit the scan to an affiliate's own customers; null scans all.
// Always returns a per-customer count (every role sorts the Customers list by
// it); the grouped rows are collected only when withDetail is set, since just
// the affiliate portal renders the client names.
async function scanCustomerClients(
  scopeIds: string[] | null,
  withDetail: boolean,
): Promise<{
  clientsByCustomer: Record<string, ShipToClient[]>;
  clientCounts: Record<string, number>;
}> {
  const clientsByCustomer: Record<string, ShipToClient[]> = {};
  const clientCounts: Record<string, number> = {};
  if (scopeIds && scopeIds.length === 0) return { clientsByCustomer, clientCounts };
  const PAGE = 1000;
  const MAX_PAGES = 40; // safety cap (~40k clients)
  const cols: string = withDetail ? "id, customer_id, first_name, last_name, city" : "customer_id";
  for (let p = 0; p < MAX_PAGES; p++) {
    let q = supabase
      .from("customer_clients")
      .select(cols)
      .order("created_at", { ascending: false })
      .range(p * PAGE, p * PAGE + PAGE - 1);
    if (scopeIds) q = q.in("customer_id", scopeIds);
    const { data, error } = await q;
    if (error) {
      console.error("Error listing ship-to clients:", error);
      break;
    }
    const rows = (data ?? []) as unknown as Array<
      ShipToClient & { customer_id: string }
    >;
    for (const r of rows) {
      clientCounts[r.customer_id] = (clientCounts[r.customer_id] ?? 0) + 1;
      if (!withDetail) continue;
      (clientsByCustomer[r.customer_id] ??= []).push({
        id: r.id,
        first_name: r.first_name,
        last_name: r.last_name,
        city: r.city,
      });
    }
    if (rows.length < PAGE) break;
  }
  return { clientsByCustomer, clientCounts };
}

// GET /api/admin/customers — scoped customer list.
// admin/assistant: all customers. affiliate: only their bound customers.
export async function GET(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller || caller.role === "customer") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let query = supabase
    .from("customers")
    .select(
      "*, bound_affiliate:affiliates!customers_affiliate_id_fkey(id, first_name, last_name, email), default_sales_person:sales_persons!customers_default_sales_person_id_fkey(id, first_name, last_name, email, commission_rate), applied_pricelist:pricelists!customers_applied_pricelist_id_fkey(id, name, is_active)",
    )
    .order("created_at", { ascending: false });

  if (caller.role === "affiliate") {
    query = query.eq("affiliate_id", caller.id);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Error listing customers:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const customers = data ?? [];
  const scopeIds = caller.role === "affiliate" ? customers.map((c) => c.id) : null;

  // Per-customer invoice rollup (count + gross invoiced) so the list can sort by
  // invoice volume / spend. Prefer the SQL-side get_customer_invoice_rollup RPC;
  // fall back to an in-memory paginated scan if it isn't available yet.
  let agg: Record<string, { invoice_count: number; invoiced_total: number }> = {};
  try {
    const { data: rollup, error: rpcErr } = await supabase.rpc(
      "get_customer_invoice_rollup",
      { p_customer_ids: scopeIds },
    );
    if (rpcErr) throw rpcErr;
    for (const r of (rollup ?? []) as Array<{ customer_id: string; invoice_count: number; invoiced_total: number }>) {
      agg[r.customer_id] = {
        invoice_count: Number(r.invoice_count) || 0,
        invoiced_total: Number(r.invoiced_total) || 0,
      };
    }
  } catch (e) {
    console.error("get_customer_invoice_rollup RPC failed, scanning instead:", e);
    agg = await scanCustomerInvoiceRollup(scopeIds);
  }

  // Ship-to clients (end-recipients) per customer. Every role gets a count —
  // the Customers list sorts by it (most clients first) and shows it in the
  // Ship-to clients column. Affiliates additionally get the client names, which
  // their portal renders under the count.
  const isAffiliate = caller.role === "affiliate";
  const { clientsByCustomer, clientCounts } = await scanCustomerClients(scopeIds, isAffiliate);

  // Sales teams come from their own failure-tolerant query rather than a
  // PostgREST embed: an embed on a table a pre-migration database doesn't have
  // would fail this whole select and take the customers list down with it.
  const teams = await loadCustomerRosters(
    supabase,
    customers.map((c) => String(c.id)),
  );

  const withAgg = customers.map((c) => ({
    ...c,
    invoice_count: agg[c.id]?.invoice_count ?? 0,
    invoiced_total: agg[c.id]?.invoiced_total ?? 0,
    ship_to_client_count: clientCounts[c.id] ?? 0,
    ship_to_clients: isAffiliate ? clientsByCustomer[c.id] ?? [] : [],
    sales_people: teams.get(String(c.id)) ?? [],
  }));

  return NextResponse.json({ customers: withAgg });
}

// POST /api/admin/customers — create a customer.
// - With a password: creates a real Supabase auth account (optionally
//   auto-confirmed), mirroring the signup route.
// - Without a password: creates a guest record (used by the invoice form).
// Affiliates may create customers; those are auto-bound to the affiliate.
export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller || (caller.role !== "admin" && caller.role !== "affiliate")) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const first_name = (body.first_name ?? "").trim();
  const last_name = (body.last_name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  // Optional secondary/backup email; informational only (not used for auth).
  const alternate_email = (body.alternate_email ?? "").trim().toLowerCase();
  const phone = (body.phone ?? "").trim();
  // Optional shipping address — captured by the invoice quick-add "new account"
  // path so a guest customer can be seeded with their address up front.
  const shipping_address = (body.shipping_address ?? "").trim();
  const shipping_city = (body.shipping_city ?? "").trim();
  const shipping_state = (body.shipping_state ?? "").trim();
  const shipping_postal_code = (body.shipping_postal_code ?? "").trim();
  const shipping_country = (body.shipping_country ?? "").trim();
  // Price-display currency tag; defaults to CAD unless USD is explicitly set.
  const price_currency = body.price_currency === "USD" ? "USD" : "CAD";
  // Default product-label preference; WITH labels unless explicitly set to false.
  const default_with_labels = body.default_with_labels === false ? false : true;
  // Storefront price conversion; off unless explicitly enabled, so a price list
  // configured in the customer's own currency is charged as configured.
  const convert_storefront_prices = body.convert_storefront_prices === true;
  const password = (body.password ?? "").trim();
  // Default to a confirmed account so a magic-link sign-in works immediately.
  const autoConfirm = body.auto_confirm !== undefined ? !!body.auto_confirm : true;
  // Create a real Supabase auth account when explicitly requested or whenever a
  // password is supplied. A passwordless sign-in link is emailed only when the
  // caller opts in (the dedicated "New Customer" form does; the invoice
  // quick-add path does not).
  const createLogin = !!body.create_login || !!password;

  // Affiliates always bind new customers to themselves; admins may specify.
  const affiliate_id =
    caller.role === "affiliate" ? caller.id : (body.affiliate_id ?? null);

  // ---- De-dup against an existing affiliate ------------------------------
  // An affiliate already owns a customers row (role='affiliate') and can be
  // invoiced like any customer (ADR 0003). If this email belongs to an
  // affiliate, minting a new customer would split one person across two records.
  // Surface the collision (409) so the caller can confirm a merge; on confirm
  // (admin only) fold the entered contact info into the affiliate's own record
  // and reuse it instead of creating a duplicate.
  let existingAffiliate: { id: string; first_name: string | null; last_name: string | null; email: string } | null = null;
  if (email) {
    const { data: aff } = await supabase
      .from("affiliates")
      .select("id, first_name, last_name, email")
      .ilike("email", email)
      .maybeSingle();
    if (aff) existingAffiliate = aff as typeof existingAffiliate;
  }
  const mergeIntoAffiliateId =
    typeof body.merge_into_affiliate_id === "string" ? body.merge_into_affiliate_id : null;

  if (existingAffiliate) {
    const confirmed = mergeIntoAffiliateId === existingAffiliate.id && caller.role === "admin";
    if (!confirmed) {
      // Not (yet) a confirmed admin merge — report the collision so the UI can
      // prompt. Affiliates never get the merge path (they can't edit an
      // affiliate profile); they just see the collision.
      return NextResponse.json(
        {
          error: "This email already belongs to an affiliate.",
          conflict: {
            type: "affiliate",
            id: existingAffiliate.id,
            first_name: existingAffiliate.first_name,
            last_name: existingAffiliate.last_name,
            email: existingAffiliate.email,
          },
        },
        { status: 409 },
      );
    }

    // Confirmed merge: enrich the affiliate's customers row with the entered
    // contact info (never clobbering its own identity) and reuse it.
    const { data: affCustomer } = await supabase
      .from("customers")
      .select("*")
      .eq("id", existingAffiliate.id)
      .maybeSingle();
    if (!affCustomer) {
      return NextResponse.json({ error: "Affiliate record not found" }, { status: 404 });
    }

    const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (first_name && !affCustomer.first_name) upd.first_name = first_name;
    if (last_name && !affCustomer.last_name) upd.last_name = last_name;
    if (alternate_email) upd.alternate_email = alternate_email;
    if (phone) upd.phone = phone;
    if (shipping_address) upd.shipping_address = shipping_address;
    if (shipping_city) upd.shipping_city = shipping_city;
    if (shipping_state) upd.shipping_state = shipping_state;
    if (shipping_postal_code) upd.shipping_postal_code = shipping_postal_code;
    if (shipping_country) upd.shipping_country = shipping_country;
    if (body.price_currency === "USD" || body.price_currency === "CAD") upd.price_currency = price_currency;
    if (body.default_with_labels !== undefined) upd.default_with_labels = default_with_labels;
    if (body.convert_storefront_prices !== undefined) {
      upd.convert_storefront_prices = convert_storefront_prices;
    }

    const { data: updated, error: updErr } = await supabase
      .from("customers")
      .update(upd)
      .eq("id", existingAffiliate.id)
      .select()
      .single();
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    await logAuditServer(supabase, {
      actor_id: caller.id,
      action: "customer.merge_into_affiliate",
      entity_type: "customer",
      entity_id: existingAffiliate.id,
      payload: { email, source: "customer_create" },
    });

    return NextResponse.json({ customer: updated, merged_into: "affiliate" }, { status: 200 });
  }

  if (createLogin) {
    // Real auth-backed account (requires a valid email). A password is
    // optional — without one the customer signs in via the magic link.
    if (!email) {
      return NextResponse.json({ error: "Email is required to create a login" }, { status: 400 });
    }
    if (password && password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      ...(password ? { password } : {}),
      email_confirm: autoConfirm,
      user_metadata: { first_name, last_name },
    });

    if (authError || !authData.user) {
      const msg = authError?.message || "Failed to create login";
      const status = /already|exist/i.test(msg) ? 409 : 500;
      return NextResponse.json({ error: msg }, { status });
    }

    const { data, error } = await supabase
      .from("customers")
      .insert({
        id: authData.user.id,
        first_name: first_name || null,
        last_name: last_name || null,
        email,
        alternate_email: alternate_email || null,
        phone: phone || null,
        shipping_address: shipping_address || null,
        shipping_city: shipping_city || null,
        shipping_state: shipping_state || null,
        shipping_postal_code: shipping_postal_code || null,
        shipping_country: shipping_country || null,
        role: "customer",
        active: true,
        price_currency,
        default_with_labels,
        convert_storefront_prices,
        email_verified: autoConfirm,
        affiliate_id,
      })
      .select()
      .single();

    if (error) {
      // Roll back the auth user if the profile insert fails.
      await supabase.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If bound to a client, seed the customer with that client's price list.
    if (affiliate_id) await applyAffiliatePricelist(data.id, affiliate_id);

    await logAuditServer(supabase, {
      actor_id: caller.id,
      action: "customer.create",
      entity_type: "customer",
      entity_id: data.id,
      payload: {
        email: data.email,
        name: `${first_name} ${last_name}`.trim() || null,
        affiliate_id,
      },
    });

    // The account is created without a password unless one was supplied; the
    // create dialog then emails a set-up link (/account/set-password) so the
    // customer chooses their own password. A link can also be resent later from
    // the Customers list via /api/admin/customers/magic-link.
    return NextResponse.json({ customer: data }, { status: 201 });
  }

  // Guest record (no login).
  if (!first_name && !last_name && !email) {
    return NextResponse.json(
      { error: "Enter a name or email for the new customer" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("customers")
    .insert({
      first_name: first_name || null,
      last_name: last_name || null,
      email: email || `guest+${Date.now()}@aminocan.local`,
      alternate_email: alternate_email || null,
      phone: phone || null,
      shipping_address: shipping_address || null,
      shipping_city: shipping_city || null,
      shipping_state: shipping_state || null,
      shipping_postal_code: shipping_postal_code || null,
      shipping_country: shipping_country || null,
      role: "customer",
      active: true,
      price_currency,
      default_with_labels,
      affiliate_id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If bound to a client, seed the customer with that client's price list.
  if (affiliate_id) await applyAffiliatePricelist(data.id, affiliate_id);

  await logAuditServer(supabase, {
    actor_id: caller.id,
    action: "customer.create",
    entity_type: "customer",
    entity_id: data.id,
    payload: {
      email: data.email,
      name: `${first_name} ${last_name}`.trim() || null,
      affiliate_id,
    },
  });

  return NextResponse.json({ customer: data }, { status: 201 });
}
