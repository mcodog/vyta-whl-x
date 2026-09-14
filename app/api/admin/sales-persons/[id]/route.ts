import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCreate, canDelete } from "@/lib/permissions";
import { logAuditServer } from "@/lib/admin/audit";
import { effectiveStatus } from "@/lib/admin/invoice-status";
import type { InvoiceStatus } from "@/lib/supabase";
import { coSoldInvoiceIds } from "@/lib/admin/sales-attribution";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getRole(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { role: "customer" as const, userId: null };
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { role: "customer" as const, userId: null };
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .single();
  return {
    role: (customer?.role || "customer") as "admin" | "assistant" | "customer",
    userId: user.id,
  };
}

// GET /api/admin/sales-persons/[id] — the "Partner 360" aggregate for one sales
// person: profile + tier (affiliate) data, invoice-commission stats, their book
// of business (bound customers), the invoices they're the rep on, and both
// commission ledgers. admin + assistant may read.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { role } = await getRole(request);
  if (role !== "admin" && role !== "assistant") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const { data: sp, error } = await supabase
    .from("sales_persons")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !sp) {
    return NextResponse.json({ error: "Sales person not found" }, { status: 404 });
  }
  const userId: string | null = sp.user_id ?? null;

  // Invoices they are credited on: the ones where they're the primary (the
  // invoices.sales_person_id column) plus any they co-sold, which only the
  // per-invoice roster names.
  const coSold = await coSoldInvoiceIds(supabase, id);
  const invoiceScope =
    coSold.length > 0
      ? `sales_person_id.eq.${id},id.in.(${coSold.join(",")})`
      : `sales_person_id.eq.${id}`;

  const [affRes, codeRes, salesComRes, invRes, refComRes, custRes, ownCustRes] = await Promise.all([
    userId
      ? supabase.from("affiliates").select("id, wallet_address, active, total_earnings, manual_code_only").eq("id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? supabase.from("referral_codes").select("code, uses_count").eq("affiliate_id", userId).eq("active", true).limit(1)
      : Promise.resolve({ data: [] }),
    supabase
      .from("sales_commissions")
      .select("id, amount, invoice_total, commission_rate, status, paid_at, created_at, invoice_id, invoices(invoice_number)")
      .eq("sales_person_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("invoices")
      .select("id, invoice_number, status, currency, total, issue_date, due_date, created_at, is_backorder, non_payable, fulfillment_status, payments(amount)")
      .or(invoiceScope)
      .order("issue_date", { ascending: false })
      .limit(500),
    userId
      ? supabase
          .from("commissions")
          .select("id, amount, order_total, commission_rate, status, paid_at, created_at, order_id, orders!commissions_order_id_fkey(order_number)")
          .eq("affiliate_id", userId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    userId
      ? supabase
          .from("customers")
          .select("id, first_name, last_name, email, created_at, price_currency, active")
          .eq("affiliate_id", userId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    // The affiliate's OWN customers row (shared id) carries their billing currency.
    userId
      ? supabase.from("customers").select("price_currency").eq("id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const aff = (affRes as any).data ?? null;
  const isAffiliate = !!userId && !!aff;
  const ownPriceCurrency =
    (ownCustRes as any).data?.price_currency === "USD" ? "USD" : "CAD";
  const code = ((codeRes as any).data ?? [])[0] ?? null;

  const salesCommissions = ((salesComRes as any).data ?? []).map((c: any) => ({
    id: c.id,
    amount: Number(c.amount) || 0,
    base: Number(c.invoice_total) || 0,
    commission_rate: Number(c.commission_rate) || 0,
    status: c.status,
    paid_at: c.paid_at,
    created_at: c.created_at,
    invoice_id: c.invoice_id,
    reference: c.invoices?.invoice_number ?? null,
  }));

  // Invoice-commission stats (mirrors the list numbers).
  let paidEarnings = 0;
  let pendingEarnings = 0;
  const invoiceIds = new Set<string>();
  for (const c of salesCommissions) {
    if (c.status === "paid") paidEarnings += c.amount;
    else if (c.status === "pending") pendingEarnings += c.amount;
    if (c.invoice_id) invoiceIds.add(c.invoice_id);
  }

  const referralCommissions = ((refComRes as any).data ?? []).map((c: any) => ({
    id: c.id,
    amount: Number(c.amount) || 0,
    base: Number(c.order_total) || 0,
    // Referral rate is stored as a fraction (0.10); normalize to a percent.
    commission_rate: (Number(c.commission_rate) || 0) * 100,
    status: c.status,
    paid_at: c.paid_at,
    created_at: c.created_at,
    reference: c.orders?.order_number ?? (c.order_id ? String(c.order_id).slice(0, 8) : null),
  }));
  let referralPaid = 0;
  let referralPending = 0;
  for (const c of referralCommissions) {
    if (c.status === "paid") referralPaid += c.amount;
    else if (c.status === "pending") referralPending += c.amount;
  }

  const invoices = ((invRes as any).data ?? []).map((inv: any) => {
    const paid = Math.min(
      (inv.payments ?? []).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0),
      Number(inv.total) || 0,
    );
    return {
      id: inv.id,
      invoice_number: inv.invoice_number,
      status: inv.status,
      status_effective: effectiveStatus(inv.status as InvoiceStatus, inv.due_date),
      currency: inv.currency,
      total: Number(inv.total) || 0,
      amount_paid: paid,
      amount_due: Math.max(0, (Number(inv.total) || 0) - paid),
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      is_backorder: inv.is_backorder,
      non_payable: inv.non_payable,
      created_at: inv.created_at,
    };
  });

  return NextResponse.json({
    sales_person: sp,
    is_affiliate: isAffiliate,
    affiliate: isAffiliate
      ? {
          id: userId,
          referral_code: code?.code ?? null,
          referral_uses: code?.uses_count ?? 0,
          wallet_address: aff?.wallet_address ?? null,
          login_active: aff?.active ?? null,
          manual_code_only: aff?.manual_code_only ?? false,
          total_earnings: Number(aff?.total_earnings) || 0,
          referral_paid: referralPaid,
          referral_pending: referralPending,
          price_currency: ownPriceCurrency,
        }
      : null,
    stats: {
      invoice_count: invoiceIds.size,
      paid_earnings: paidEarnings,
      pending_earnings: pendingEarnings,
    },
    customers: (custRes as any).data ?? [],
    invoices,
    commissions: { sales: salesCommissions, referral: referralCommissions },
  });
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { role, userId } = await getRole(request);
  if (!canCreate(role)) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const patch: Record<string, any> = {};
  for (const key of ["first_name", "last_name", "email", "phone", "commission_rate", "notes", "active"]) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  // Per-line discount presets (%). Clamp to 0–100; blank/invalid → 0 (no preset).
  for (const key of ["default_box_discount_pct", "default_vial_discount_pct"]) {
    if (body[key] !== undefined) patch[key] = Math.min(100, Math.max(0, Number(body[key]) || 0));
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("sales_persons")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAuditServer(supabase, {
    actor_id: userId,
    action: "sales_person.update",
    entity_type: "sales_person",
    entity_id: id,
    payload: patch,
  });
  return NextResponse.json({ sales_person: data });
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { role, userId } = await getRole(request);
  if (!canDelete(role)) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const { error } = await supabase.from("sales_persons").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAuditServer(supabase, {
    actor_id: userId,
    action: "sales_person.delete",
    entity_type: "sales_person",
    entity_id: id,
  });
  return NextResponse.json({ ok: true });
}
