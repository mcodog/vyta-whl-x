import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Resolve the caller's role from the Bearer token (same pattern as the other
// admin routes — there is no shared helper). Only admins and assistants may see
// the full people graph; affiliates get a scoped customer list elsewhere.
async function getRole(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return "customer";
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return "customer";
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return customer?.role || "customer";
}

// Page through a table in 1000-row chunks so counts/revenue aren't silently
// capped at PostgREST's default row limit (these tables can be large).
async function selectAll<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  orderColumn = "created_at",
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

type CustomerRow = {
  id: string; first_name: string | null; last_name: string | null; email: string | null;
  phone: string | null; role: string | null; active: boolean | null;
  price_currency: string | null; affiliate_id: string | null;
  default_sales_person_id: string | null; shipping_city: string | null;
  shipping_state: string | null; shipping_country: string | null; created_at: string | null;
};
type ClientRow = { id: string; customer_id: string; created_at: string | null };
type InvoiceRow = { customer_id: string | null; total: number | null; status: string | null; created_at: string | null };

/**
 * GET /api/admin/genealogy
 *
 * Returns the whole "people" graph in one shot so the client can render a
 * customer genealogy tree without N+1 round-trips:
 *   affiliate  ─┐
 *   sales person┴─►  customer  ─►  client (end-recipient)
 *
 * The client joins the pieces (affiliate_id / default_sales_person_id /
 * customer_clients.customer_id) and can re-root the tree on either the
 * affiliate or the sales person. Per-customer invoice aggregates (count,
 * revenue, last activity) and per-customer client counts are computed here.
 */
export async function GET(request: NextRequest) {
  const role = await getRole(request);
  if (role !== "admin" && role !== "assistant") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const [affiliates, salesPersons, customers, clients, invoices] = await Promise.all([
      selectAll(
        supabase,
        "affiliates",
        "id, first_name, last_name, email, active, total_earnings, created_at",
      ),
      selectAll(
        supabase,
        "sales_persons",
        "id, first_name, last_name, email, commission_rate, active, total_earnings, user_id, created_at",
      ),
      selectAll<CustomerRow>(
        supabase,
        "customers",
        "id, first_name, last_name, email, phone, role, active, price_currency, affiliate_id, default_sales_person_id, shipping_city, shipping_state, shipping_country, created_at",
      ),
      selectAll<ClientRow & Record<string, unknown>>(
        supabase,
        "customer_clients",
        "id, customer_id, first_name, last_name, address, city, state, country, email, phone, created_at",
      ),
      selectAll<InvoiceRow>(supabase, "invoices", "customer_id, total, status, created_at"),
    ]);

    // Per-customer invoice rollups (skip cancelled invoices for revenue/count).
    const invoiceStats = new Map<
      string,
      { invoice_count: number; revenue: number; last_invoice_at: string | null }
    >();
    for (const inv of invoices) {
      if (!inv.customer_id || inv.status === "cancelled") continue;
      const s =
        invoiceStats.get(inv.customer_id) ??
        { invoice_count: 0, revenue: 0, last_invoice_at: null as string | null };
      s.invoice_count += 1;
      s.revenue += Number(inv.total) || 0;
      if (!s.last_invoice_at || (inv.created_at && inv.created_at > s.last_invoice_at)) {
        s.last_invoice_at = inv.created_at ?? s.last_invoice_at;
      }
      invoiceStats.set(inv.customer_id, s);
    }

    // Per-customer client counts.
    const clientCounts = new Map<string, number>();
    for (const cl of clients) {
      clientCounts.set(cl.customer_id, (clientCounts.get(cl.customer_id) ?? 0) + 1);
    }

    const customersOut = customers.map((c) => {
      const stats = invoiceStats.get(c.id);
      return {
        ...c,
        invoice_count: stats?.invoice_count ?? 0,
        revenue: stats?.revenue ?? 0,
        last_invoice_at: stats?.last_invoice_at ?? null,
        client_count: clientCounts.get(c.id) ?? 0,
      };
    });

    return NextResponse.json({
      affiliates,
      salesPersons,
      customers: customersOut,
      clients,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to build genealogy";
    console.error("Error building genealogy:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
