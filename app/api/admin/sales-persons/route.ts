import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCreate } from "@/lib/permissions";
import { logAuditServer } from "@/lib/admin/audit";

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

// Page through a table (beats PostgREST's 1000-row cap), invoking `onPage` for
// each chunk. Best-effort — stops on error or a short page.
async function paginateAll(
  table: string,
  select: string,
  onPage: (rows: any[]) => void,
) {
  const PAGE = 1000;
  const MAX_PAGES = 40;
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(p * PAGE, p * PAGE + PAGE - 1);
    if (error || !data) break;
    onPage(data);
    if (data.length < PAGE) break;
  }
}

// GET /api/admin/sales-persons — the merged "Sales People" list (ADR 0003).
// Returns every sales_persons row enriched with its invoice-commission stats and,
// for rows linked to a login (user_id → an affiliate account), the affiliate
// tier data: referral code, wallet, login state, and referral earnings.
// admin + assistant may read.
export async function GET(request: NextRequest) {
  const { role } = await getRole(request);
  if (role !== "admin" && role !== "assistant") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { data: people, error } = await supabase
    .from("sales_persons")
    .select("*")
    .order("last_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const salesPersons = people ?? [];

  // Affiliate accounts keyed by id (= sales_persons.user_id when linked).
  const { data: affiliates } = await supabase
    .from("affiliates")
    .select("id, wallet_address, active, total_earnings, manual_code_only");
  const affMap = new Map((affiliates ?? []).map((a) => [a.id, a]));

  // The billing currency lives on each affiliate's own customers row (shared id).
  const affIds = (affiliates ?? []).map((a) => a.id);
  const currencyMap = new Map<string, "CAD" | "USD">();
  if (affIds.length) {
    const { data: custCurrencies } = await supabase
      .from("customers")
      .select("id, price_currency")
      .in("id", affIds);
    for (const c of custCurrencies ?? []) {
      currencyMap.set(c.id, c.price_currency === "USD" ? "USD" : "CAD");
    }
  }

  // First active referral code per affiliate.
  const { data: codes } = await supabase
    .from("referral_codes")
    .select("affiliate_id, code, uses_count")
    .eq("active", true);
  const codeMap = new Map<string, { code: string; uses_count: number }>();
  for (const c of codes ?? []) if (!codeMap.has(c.affiliate_id)) codeMap.set(c.affiliate_id, c);

  // Invoice-commission stats per sales person (paginated).
  const scAgg = new Map<string, { paid: number; pending: number; invoices: Set<string> }>();
  await paginateAll("sales_commissions", "sales_person_id, amount, status, invoice_id", (rows) => {
    for (const r of rows) {
      if (!r.sales_person_id) continue;
      const b = scAgg.get(r.sales_person_id) ?? { paid: 0, pending: 0, invoices: new Set<string>() };
      if (r.status === "paid") b.paid += Number(r.amount) || 0;
      else if (r.status === "pending") b.pending += Number(r.amount) || 0;
      if (r.invoice_id) b.invoices.add(r.invoice_id);
      scAgg.set(r.sales_person_id, b);
    }
  });

  // Referral-commission stats per affiliate (paginated).
  const rcAgg = new Map<string, { paid: number; pending: number }>();
  await paginateAll("commissions", "affiliate_id, amount, status", (rows) => {
    for (const r of rows) {
      if (!r.affiliate_id) continue;
      const b = rcAgg.get(r.affiliate_id) ?? { paid: 0, pending: 0 };
      if (r.status === "paid") b.paid += Number(r.amount) || 0;
      else if (r.status === "pending") b.pending += Number(r.amount) || 0;
      rcAgg.set(r.affiliate_id, b);
    }
  });

  const enriched = salesPersons.map((sp) => {
    const sc = scAgg.get(sp.id);
    const isAffiliate = !!sp.user_id && affMap.has(sp.user_id);
    const aff = isAffiliate ? affMap.get(sp.user_id) : null;
    const code = isAffiliate ? codeMap.get(sp.user_id) : null;
    const rc = isAffiliate ? rcAgg.get(sp.user_id) : null;
    return {
      ...sp,
      paid_earnings: sc?.paid ?? 0,
      pending_earnings: sc?.pending ?? 0,
      invoice_count: sc?.invoices.size ?? 0,
      is_affiliate: isAffiliate,
      affiliate: isAffiliate
        ? {
            referral_code: code?.code ?? null,
            referral_uses: code?.uses_count ?? 0,
            wallet_address: aff?.wallet_address ?? null,
            login_active: aff?.active ?? null,
            manual_code_only: aff?.manual_code_only ?? false,
            total_earnings: Number(aff?.total_earnings) || 0,
            referral_paid: rc?.paid ?? 0,
            referral_pending: rc?.pending ?? 0,
            price_currency: currencyMap.get(sp.user_id) ?? "CAD",
          }
        : null,
    };
  });

  return NextResponse.json({ sales_persons: enriched });
}

export async function POST(request: NextRequest) {
  const { role, userId } = await getRole(request);
  if (!canCreate(role)) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  if (!body?.first_name?.trim() || !body?.last_name?.trim()) {
    return NextResponse.json({ error: "First and last name are required" }, { status: 400 });
  }
  // Clamp a percentage to 0–100; blank/invalid → 0 (no preset).
  const clampPct = (v: unknown) => Math.min(100, Math.max(0, Number(v) || 0));
  const { data, error } = await supabase
    .from("sales_persons")
    .insert({
      first_name: body.first_name.trim(),
      last_name: body.last_name.trim(),
      email: body.email ?? null,
      phone: body.phone ?? null,
      commission_rate: body.commission_rate ?? 5,
      notes: body.notes ?? null,
      active: body.active ?? true,
      default_box_discount_pct: clampPct(body.default_box_discount_pct),
      default_vial_discount_pct: clampPct(body.default_vial_discount_pct),
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAuditServer(supabase, {
    actor_id: userId,
    action: "sales_person.create",
    entity_type: "sales_person",
    entity_id: data.id,
    payload: { first_name: data.first_name, last_name: data.last_name },
  });
  return NextResponse.json({ sales_person: data }, { status: 201 });
}
