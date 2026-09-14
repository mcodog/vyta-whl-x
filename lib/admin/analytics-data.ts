/**
 * Shared server-side computation for the admin Analytics dashboard. Both the
 * JSON summary endpoint (`/api/admin/analytics/summary`) and the printable
 * report (`/api/admin/analytics/report`) call {@link computeAnalyticsSummary}
 * so the on-screen figures and the downloaded report can never drift apart.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AnalyticsSummary,
  CurrencyRevenue,
  InvoiceCurrency,
  InvoiceStatus,
  PerformanceEntry,
  ProductPerformanceEntry,
  PurchaseOrderStatus,
  RevenueInvoice,
} from "@/lib/supabase";
import { effectiveStatus } from "@/lib/admin/invoice-status";
import { canViewAnalytics, type UserRole } from "@/lib/permissions";
import { computeShippingEarnings } from "@/lib/admin/shipping-earnings";
import { loadInvoiceRosters } from "@/lib/admin/sales-attribution";

// How many rows each Performance leaderboard returns.
export const TOP_N = 8;

const LOW_STOCK_THRESHOLD = 5;
const OPEN_PO_STATUSES: PurchaseOrderStatus[] = ["pending", "partially_fulfilled"];
const REVENUE_INVOICE_STATUSES = ["sent", "partial", "paid", "overdue"];

export interface AnalyticsRange {
  from: string | null; // YYYY-MM-DD inclusive
  to: string | null; // YYYY-MM-DD inclusive
}

/**
 * Verify the bearer token belongs to someone allowed to view Analytics — admin,
 * assistant, or a dedicated analytics account (see canViewAnalytics). Kept under
 * the historical name so its two callers (summary + report routes) don't churn.
 */
export async function isAdminOrAssistant(
  supabase: SupabaseClient,
  authHeader: string | null,
): Promise<boolean> {
  if (!authHeader) return false;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return false;
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = (customer?.role || "customer") as UserRole;
  return canViewAnalytics(role);
}

/**
 * Compute the full analytics summary for a date range. Throws on a query error
 * so callers can translate it into their own error response.
 */
export async function computeAnalyticsSummary(
  supabase: SupabaseClient,
  range: AnalyticsRange,
): Promise<AnalyticsSummary> {
  const { from, to } = range;

  // Build the revenue invoice query with optional date scope on issue_date
  let invoiceQuery = supabase
    .from("invoices")
    .select(`
      id, invoice_number, issue_date, due_date, total, status, currency,
      shipping_cost, customer_id, customer_name,
      sales_person_id, sales_person_commission_amount,
      sales_person:sales_persons ( id, first_name, last_name ),
      customer:customers!customer_id (
        id, first_name, last_name, affiliate_id,
        bound_affiliate:affiliates!customers_affiliate_id_fkey ( id, first_name, last_name )
      ),
      payments ( amount )
    `)
    .in("status", REVENUE_INVOICE_STATUSES);
  if (from) invoiceQuery = invoiceQuery.gte("issue_date", from);
  if (to) invoiceQuery = invoiceQuery.lte("issue_date", to);

  // Draft invoices are surfaced in the audit list only — they are NOT revenue
  // yet, so they never touch invoiced/paid/outstanding or the leaderboards.
  // Fetched separately (lightweight projection) and merged into the list below.
  let draftQuery = supabase
    .from("invoices")
    .select(`
      id, invoice_number, issue_date, due_date, total, currency,
      customer_id, customer_name,
      customer:customers!customer_id ( first_name, last_name ),
      payments ( amount )
    `)
    .eq("status", "draft");
  if (from) draftQuery = draftQuery.gte("issue_date", from);
  if (to) draftQuery = draftQuery.lte("issue_date", to);

  // Open POs query, optionally scoped to created_at range
  let poQuery = supabase
    .from("purchase_orders")
    .select(`id, po_number, status, total, expected_date, supplier:suppliers (id, name)`)
    .in("status", OPEN_PO_STATUSES)
    .order("expected_date", { ascending: true, nullsFirst: false });
  if (from) poQuery = poQuery.gte("created_at", from);
  if (to) poQuery = poQuery.lte("created_at", to);

  // Parallel fetch
  const [productsRes, posRes, invoicesRes, draftsRes] = await Promise.all([
    supabase.from("products").select("id, price, stock_quantity").eq("active", true),
    poQuery,
    invoiceQuery,
    draftQuery,
  ]);

  if (productsRes.error || posRes.error || invoicesRes.error || draftsRes.error) {
    const err = productsRes.error || posRes.error || invoicesRes.error || draftsRes.error;
    throw new Error(err?.message ?? "Query failed");
  }

  // -------- inventory --------------------------------------------------------
  const products = productsRes.data ?? [];
  const inventory = products.reduce(
    (acc, p: any) => {
      const qty = Number(p.stock_quantity) || 0;
      const price = Number(p.price) || 0;
      acc.units += qty;
      acc.value += qty * price;
      acc.sku_count += 1;
      if (qty < LOW_STOCK_THRESHOLD) acc.low_stock_count += 1;
      return acc;
    },
    { units: 0, value: 0, sku_count: 0, low_stock_count: 0 },
  );
  inventory.value = Number(inventory.value.toFixed(2));

  // -------- incoming POs -----------------------------------------------------
  const pos = (posRes.data ?? []) as unknown as Array<{
    id: string;
    po_number: string;
    status: PurchaseOrderStatus;
    total: number;
    expected_date: string | null;
    supplier: { id: string; name: string } | null;
  }>;
  const poIds = pos.map((p) => p.id);
  const incomingValue = pos.reduce((s, p) => s + Number(p.total), 0);

  let incomingUnits = 0;
  if (poIds.length > 0) {
    const { data: items } = await supabase
      .from("purchase_order_items")
      .select("qty")
      .in("purchase_order_id", poIds);
    incomingUnits = (items ?? []).reduce((s, i: any) => s + Number(i.qty), 0);
  }

  // -------- revenue ----------------------------------------------------------
  // Per-invoice paid math — payments tied to draft/excluded invoices never
  // inflate the global paid figure, so outstanding cannot go negative.
  // PostgREST can't statically prove the embedded relations are to-one, so the
  // generated result type widens them to arrays; at runtime (FK-disambiguated
  // to-one embeds) they are single objects. Cast through unknown to the real
  // runtime shape.
  const invoices = (invoicesRes.data ?? []) as unknown as Array<{
    id: string;
    invoice_number: string;
    issue_date: string | null;
    due_date: string | null;
    total: number;
    status: string;
    currency: string | null;
    shipping_cost: number | null;
    customer_id: string | null;
    customer_name: string | null;
    sales_person_id: string | null;
    sales_person_commission_amount: number | null;
    sales_person: { id: string; first_name: string | null; last_name: string | null } | null;
    customer: {
      id: string;
      first_name: string | null;
      last_name: string | null;
      affiliate_id: string | null;
      bound_affiliate: { id: string; first_name: string | null; last_name: string | null } | null;
    } | null;
    payments: Array<{ amount: number }>;
  }>;
  // Commission rosters, read separately rather than embedded so a database that
  // hasn't run multi-sales-person-migration.sql still renders analytics off the
  // invoices' own primary sales person.
  const rosters = await loadInvoiceRosters(
    supabase,
    invoices.map((inv) => inv.id),
  );

  let invoiced = 0;
  let paid = 0;
  let paidInvoiceCount = 0;

  // -------- performance leaderboards -----------------------------------------
  // Accumulate revenue per customer / sales person / affiliate as we walk the
  // invoices. Amounts are nominal (CAD + USD combined), matching the existing
  // customer/affiliate reports.
  type Acc = { id: string | null; name: string; revenue: number; paid: number; invoice_count: number; commission: number };
  const bump = (
    map: Map<string, Acc>,
    key: string,
    id: string | null,
    name: string,
    total: number,
    invPaid: number,
    commission = 0,
  ) => {
    const e = map.get(key) ?? { id, name, revenue: 0, paid: 0, invoice_count: 0, commission: 0 };
    e.revenue += total;
    e.paid += invPaid;
    e.invoice_count += 1;
    e.commission += commission;
    map.set(key, e);
  };
  const custAcc = new Map<string, Acc>();
  const spAcc = new Map<string, Acc>();
  const affAcc = new Map<string, Acc>();
  // Track CAD and USD separately — amounts are never converted, so each
  // currency's figures accumulate on their own. Invoices predating the
  // currency flag (null) count as CAD, matching the column's default.
  const emptyCur = (): CurrencyRevenue => ({
    invoiced: 0,
    paid: 0,
    outstanding: 0,
    invoice_count: 0,
    paid_invoice_count: 0,
  });
  const byCurrency: Record<InvoiceCurrency, CurrencyRevenue> = {
    CAD: emptyCur(),
    USD: emptyCur(),
  };
  // Audit list: every invoice feeding the figures above, so the range is
  // traceable in the UI. Lightweight projection, sorted newest-first below.
  const revenueInvoices: RevenueInvoice[] = [];
  for (const inv of invoices) {
    const cur: InvoiceCurrency = inv.currency === "USD" ? "USD" : "CAD";
    const total = Number(inv.total);
    const invPaid = Math.min(
      (inv.payments ?? []).reduce((s, p) => s + Number(p.amount), 0),
      total,
    ); // never exceed invoice total
    invoiced += total;
    paid += invPaid;
    if (inv.status === "paid") paidInvoiceCount += 1;

    const bucket = byCurrency[cur];
    bucket.invoiced += total;
    bucket.paid += invPaid;
    bucket.invoice_count += 1;
    if (inv.status === "paid") bucket.paid_invoice_count += 1;

    // Customer leaderboard — key by customer id, else by the guest name typed
    // on the invoice (so unlinked guests still aggregate by name).
    const custName = inv.customer
      ? [inv.customer.first_name, inv.customer.last_name].filter(Boolean).join(" ") || "Unnamed customer"
      : (inv.customer_name?.trim() || null);

    revenueInvoices.push({
      id: inv.id,
      invoice_number: inv.invoice_number,
      issue_date: inv.issue_date,
      customer_name: custName,
      // Compute overdue live so the audit list agrees with the invoices view.
      status: inv.due_date
        ? effectiveStatus(inv.status as InvoiceStatus, inv.due_date)
        : (inv.status as InvoiceStatus),
      currency: cur,
      total: Number(total.toFixed(2)),
      paid: Number(invPaid.toFixed(2)),
    });

    if (inv.customer_id || custName) {
      const key = inv.customer_id ?? `name:${(custName || "").toLowerCase()}`;
      bump(custAcc, key, inv.customer_id, custName || "Guest", total, invPaid);
    }

    // Sales-person leaderboard. An invoice can credit up to five people, so
    // every one of them is bumped with their OWN commission. Revenue is
    // attributed in full to each — a co-sold deal counts once for each person
    // who brought it in — so the leaderboard's revenue column can exceed total
    // revenue when co-selling happens. That is deliberate: it answers "how much
    // did this person bring in", not "how do the invoices divide up".
    const roster = rosters.get(inv.id) ?? [];
    const creditedTeam: Array<{
      id: string;
      person: { first_name: string | null; last_name: string | null } | null;
      commission: number;
    }> =
      roster.length > 0
        ? roster.map((m) => ({
            id: m.sales_person_id,
            person: (m.sales_person as { first_name: string | null; last_name: string | null } | null) ?? null,
            commission: m.commission_amount,
          }))
        : inv.sales_person_id && inv.sales_person
          ? [
              {
                id: inv.sales_person_id,
                person: inv.sales_person,
                commission: Number(inv.sales_person_commission_amount) || 0,
              },
            ]
          : [];
    for (const member of creditedTeam) {
      if (!member.id) continue;
      const name =
        [member.person?.first_name, member.person?.last_name].filter(Boolean).join(" ") ||
        "Sales person";
      bump(spAcc, member.id, member.id, name, total, invPaid, member.commission);
    }

    // Affiliate leaderboard — attributed via the customer's bound affiliate.
    const aff = inv.customer?.bound_affiliate ?? null;
    if (aff) {
      const name =
        [aff.first_name, aff.last_name].filter(Boolean).join(" ") || "Affiliate";
      bump(affAcc, aff.id, aff.id, name, total, invPaid);
    }
  }
  for (const cur of ["CAD", "USD"] as InvoiceCurrency[]) {
    const b = byCurrency[cur];
    b.invoiced = Number(b.invoiced.toFixed(2));
    b.paid = Number(b.paid.toFixed(2));
    b.outstanding = Math.max(0, Number((b.invoiced - b.paid).toFixed(2)));
  }

  // Merge draft invoices into the audit list (list-only — see draftQuery). They
  // carry their own zero-or-partial payments but never feed the revenue totals.
  const drafts = (draftsRes.data ?? []) as unknown as Array<{
    id: string;
    invoice_number: string;
    issue_date: string | null;
    total: number;
    currency: string | null;
    customer_id: string | null;
    customer_name: string | null;
    customer: { first_name: string | null; last_name: string | null } | null;
    payments: Array<{ amount: number }>;
  }>;
  for (const d of drafts) {
    const total = Number(d.total);
    const invPaid = Math.min(
      (d.payments ?? []).reduce((s, p) => s + Number(p.amount), 0),
      total,
    );
    const custName = d.customer
      ? [d.customer.first_name, d.customer.last_name].filter(Boolean).join(" ") || "Unnamed customer"
      : (d.customer_name?.trim() || null);
    revenueInvoices.push({
      id: d.id,
      invoice_number: d.invoice_number,
      issue_date: d.issue_date,
      customer_name: custName,
      status: "draft",
      currency: d.currency === "USD" ? "USD" : "CAD",
      total: Number(total.toFixed(2)),
      paid: Number(invPaid.toFixed(2)),
    });
  }

  // Newest issue date first; nulls sink to the bottom.
  revenueInvoices.sort((a, b) => {
    if (!a.issue_date) return 1;
    if (!b.issue_date) return -1;
    return b.issue_date.localeCompare(a.issue_date);
  });

  // -------- top-selling products ---------------------------------------------
  // Aggregate line items belonging to the in-scope invoices, keyed by product
  // (falling back to the free-text description for adhoc lines).
  const invoiceIds = invoices.map((i) => i.id);
  const productAcc = new Map<string, { id: string | null; name: string; units: number; revenue: number }>();
  if (invoiceIds.length > 0) {
    const { data: lineItems } = await supabase
      .from("invoice_line_items")
      .select("product_id, description, qty, line_total, product:products ( id, name )")
      .in("invoice_id", invoiceIds);
    for (const li of (lineItems ?? []) as any[]) {
      const prod = li.product as { id: string; name: string } | null;
      const key = li.product_id ?? `desc:${(li.description || "").toLowerCase()}`;
      const name = prod?.name ?? li.description ?? "Item";
      const e = productAcc.get(key) ?? { id: li.product_id ?? null, name, units: 0, revenue: 0 };
      e.units += Number(li.qty) || 0;
      e.revenue += Number(li.line_total) || 0;
      productAcc.set(key, e);
    }
  }

  const toEntries = (map: Map<string, Acc>): PerformanceEntry[] =>
    Array.from(map.values())
      .map((e) => ({
        id: e.id,
        name: e.name,
        revenue: Number(e.revenue.toFixed(2)),
        paid: Number(e.paid.toFixed(2)),
        invoice_count: e.invoice_count,
        commission: Number(e.commission.toFixed(2)),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, TOP_N);

  // -------- shipping earnings ------------------------------------------------
  // Gross shipping revenue billed on the same invoices feeding `revenue` above
  // (handling markup included — carrier cost is never persisted).
  const shipping = computeShippingEarnings(invoices, invoiced);

  const topProducts: ProductPerformanceEntry[] = Array.from(productAcc.values())
    .map((e) => ({ id: e.id, name: e.name, units: e.units, revenue: Number(e.revenue.toFixed(2)) }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, TOP_N);

  return {
    inventory,
    incoming: {
      units: incomingUnits,
      value: Number(incomingValue.toFixed(2)),
      po_count: pos.length,
      pos: pos.map((p) => ({
        id: p.id,
        po_number: p.po_number,
        supplier_name: p.supplier?.name ?? null,
        status: p.status,
        total: Number(p.total),
        expected_date: p.expected_date,
      })),
    },
    revenue: {
      invoiced: Number(invoiced.toFixed(2)),
      paid: Number(paid.toFixed(2)),
      outstanding: Math.max(0, Number((invoiced - paid).toFixed(2))),
      invoice_count: invoices.length,
      paid_invoice_count: paidInvoiceCount,
      by_currency: byCurrency,
      invoices: revenueInvoices,
      range: { from, to },
    },
    shipping,
    performance: {
      top_customers: toEntries(custAcc),
      top_sales_persons: toEntries(spAcc),
      top_affiliates: toEntries(affAcc),
      top_products: topProducts,
    },
  };
}
