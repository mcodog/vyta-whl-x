import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeShippingEarnings } from "@/lib/admin/shipping-earnings";

// Dashboard "overview" — the numbers behind the top KPI strip and the three
// standing charts (revenue paid vs outstanding, top affiliates by commission,
// most-ordered products). Computed with the service role so the math is
// authoritative and never gated by client RLS. Admin/assistant only.
//
// Wiring notes (the previous KPIs read wrong):
//   - Revenue is the INVOICE book, not raw orders.total (which summed cancelled
//     and unpaid orders). Paid is per-invoice payments capped at the invoice
//     total; outstanding = invoiced − paid (never negative). Mirrors the
//     Analytics page semantics so the two can't drift.
//   - Pending commissions combine BOTH ledgers: referral (`commissions`) and
//     invoice (`sales_commissions`). The old card only summed referral.
//   - Shipping earnings are the shipping line on those same invoices, shared
//     with Analytics via computeShippingEarnings() so the two never drift.

export const revalidate = 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Same set the Analytics revenue book uses. 'overdue' is a computed status (not
// stored) so it simply never matches — kept for parity with analytics-data.ts.
const REVENUE_INVOICE_STATUSES = ["sent", "partial", "paid", "overdue"];

// First instant of the current month (UTC) as an ISO string, for the
// new-customers-this-month count.
function startOfMonthISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function verifyStaff(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return false;
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = customer?.role;
  return role === "admin" || role === "assistant";
}

export async function GET(request: NextRequest) {
  if (!(await verifyStaff(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const monthStart = startOfMonthISO();

    // --- Parallel base fetches -------------------------------------------------
    const [
      invoicesRes,
      refCommRes,
      salesCommRes,
      salesPersonsRes,
      affiliatesRes,
      newCustomersRes,
    ] = await Promise.all([
      supabase
        .from("invoices")
        .select("id, total, status, issue_date, currency, shipping_cost, payments ( amount )")
        .in("status", REVENUE_INVOICE_STATUSES),
      supabase.from("commissions").select("affiliate_id, amount, status"),
      supabase.from("sales_commissions").select("sales_person_id, amount, status"),
      supabase.from("sales_persons").select("id, user_id").not("user_id", "is", null),
      supabase.from("affiliates").select("id, first_name, last_name"),
      // New customers registered this month (buyers only — excludes staff /
      // affiliate / warehouse accounts).
      supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("role", "customer")
        .gte("created_at", monthStart),
    ]);

    // --- Revenue (paid vs outstanding) + month-by-month -----------------------
    const invoices = (invoicesRes.data ?? []) as Array<{
      id: string;
      total: number;
      status: string;
      issue_date: string | null;
      currency: string | null;
      shipping_cost: number | null;
      payments: Array<{ amount: number }>;
    }>;

    // Last 12 months of buckets, oldest → newest, keyed 'YYYY-MM'.
    const now = new Date();
    const monthKeys: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      monthKeys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    }
    const monthBuckets = new Map(monthKeys.map((m) => [m, { invoiced: 0, paid: 0 }]));

    let invoiced = 0;
    let paid = 0;
    for (const inv of invoices) {
      const total = Number(inv.total) || 0;
      const invPaid = Math.min(
        (inv.payments ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0),
        total,
      );
      invoiced += total;
      paid += invPaid;

      const mk = inv.issue_date ? inv.issue_date.slice(0, 7) : null;
      if (mk) {
        const b = monthBuckets.get(mk);
        if (b) {
          b.invoiced += total;
          b.paid += invPaid;
        }
      }
    }
    const outstanding = Math.max(0, invoiced - paid);
    const monthly = monthKeys.map((m) => {
      const b = monthBuckets.get(m)!;
      return {
        month: m,
        invoiced: Number(b.invoiced.toFixed(2)),
        paid: Number(b.paid.toFixed(2)),
      };
    });

    // --- Shipping earnings ----------------------------------------------------
    // Gross shipping revenue billed on those same invoices (handling markup
    // included; carrier cost isn't stored anywhere).
    const shipping = computeShippingEarnings(invoices, invoiced);

    // --- Affiliate commissions (referral + invoice, paid + pending) -----------
    // Map each affiliate's linked sales_person row back to the affiliate uid.
    const spToAffiliate = new Map<string, string>();
    for (const sp of (salesPersonsRes.data ?? []) as Array<{ id: string; user_id: string | null }>) {
      if (sp.user_id) spToAffiliate.set(sp.id, sp.user_id);
    }

    const commByAffiliate = new Map<string, { paid: number; pending: number }>();
    const bump = (affId: string | null | undefined, amount: number, status: string) => {
      if (!affId) return;
      const e = commByAffiliate.get(affId) ?? { paid: 0, pending: 0 };
      if (status === "paid") e.paid += amount;
      else if (status === "pending") e.pending += amount;
      commByAffiliate.set(affId, e);
    };
    for (const c of (refCommRes.data ?? []) as Array<{ affiliate_id: string | null; amount: number; status: string }>) {
      bump(c.affiliate_id, Number(c.amount) || 0, c.status);
    }
    for (const c of (salesCommRes.data ?? []) as Array<{ sales_person_id: string; amount: number; status: string }>) {
      bump(spToAffiliate.get(c.sales_person_id), Number(c.amount) || 0, c.status);
    }

    const affNames = new Map<string, string>();
    for (const a of (affiliatesRes.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>) {
      affNames.set(a.id, [a.first_name, a.last_name].filter(Boolean).join(" ") || "Affiliate");
    }

    const topAffiliates = Array.from(commByAffiliate.entries())
      .map(([id, v]) => ({
        id,
        name: affNames.get(id) ?? "Affiliate",
        paid: Number(v.paid.toFixed(2)),
        pending: Number(v.pending.toFixed(2)),
        total: Number((v.paid + v.pending).toFixed(2)),
      }))
      .filter((a) => a.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Total pending we owe across BOTH ledgers — referral + every invoice
    // commission (reps included, not just affiliate-mapped ones). This is the
    // KPI the old card got wrong (it summed referral only).
    let pendingCommissions = 0;
    for (const c of (refCommRes.data ?? []) as Array<{ amount: number; status: string }>) {
      if (c.status === "pending") pendingCommissions += Number(c.amount) || 0;
    }
    for (const c of (salesCommRes.data ?? []) as Array<{ amount: number; status: string }>) {
      if (c.status === "pending") pendingCommissions += Number(c.amount) || 0;
    }

    // --- New customers (MTD) + affiliate count --------------------------------
    const newCustomersMTD = newCustomersRes.count ?? 0;
    const totalAffiliates = (affiliatesRes.data ?? []).length;

    // --- Most-ordered products (by units, from revenue invoices) --------------
    const invoiceIds = invoices.map((i) => i.id);
    const productUnits = new Map<string, { id: string | null; name: string; units: number }>();
    if (invoiceIds.length > 0) {
      const { data: lineItems } = await supabase
        .from("invoice_line_items")
        .select("product_id, description, qty, product:products ( name )")
        .in("invoice_id", invoiceIds);
      for (const li of (lineItems ?? []) as any[]) {
        const key = li.product_id ?? `desc:${(li.description || "").toLowerCase()}`;
        const name = (li.product?.name as string | undefined) ?? li.description ?? "Item";
        const e = productUnits.get(key) ?? { id: li.product_id ?? null, name, units: 0 };
        e.units += Number(li.qty) || 0;
        productUnits.set(key, e);
      }
    }
    const topProducts = Array.from(productUnits.values())
      .filter((p) => p.units > 0)
      .sort((a, b) => b.units - a.units)
      .slice(0, 5)
      .map((p) => ({ id: p.id, name: p.name, units: p.units }));

    return NextResponse.json({
      stats: {
        paidRevenue: Number(paid.toFixed(2)),
        invoiced: Number(invoiced.toFixed(2)),
        outstanding: Number(outstanding.toFixed(2)),
        newCustomersMTD,
        totalAffiliates,
        pendingCommissions: Number(pendingCommissions.toFixed(2)),
        shippingCollected: shipping.collected,
        shippingCharged: shipping.charged,
        shippingInvoiceCount: shipping.invoice_count,
      },
      revenue: {
        paid: Number(paid.toFixed(2)),
        outstanding: Number(outstanding.toFixed(2)),
      },
      shipping,
      monthly,
      topAffiliates,
      topProducts,
    });
  } catch (e) {
    console.error("dashboard overview error:", e);
    const message = e instanceof Error ? e.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
