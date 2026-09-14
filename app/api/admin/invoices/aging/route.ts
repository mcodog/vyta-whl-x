import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { AgingBucket } from "@/lib/supabase";
import { coSoldInvoiceIds } from "@/lib/admin/sales-attribution";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getCaller(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = customer?.role || "customer";
  if (role !== "admin" && role !== "assistant" && role !== "affiliate") return null;
  return { id: user.id, role };
}

// GET /api/admin/invoices/aging
export async function GET(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  await supabase.rpc("mark_overdue_invoices");

  let query = supabase
    .from("invoices")
    .select("total, due_date, status, customer_id, sales_person_id, payments (amount)")
    .neq("status", "paid")
    .neq("status", "draft")
    .neq("status", "cancelled");

  // Scope the aging report to an affiliate's own invoices.
  if (caller.role === "affiliate") {
    const { data: custs } = await supabase
      .from("customers")
      .select("id")
      .eq("affiliate_id", caller.id);
    const customerIds = (custs ?? []).map((c) => c.id);
    const { data: sp } = await supabase
      .from("sales_persons")
      .select("id")
      .eq("user_id", caller.id)
      .maybeSingle();
    const ors: string[] = [];
    if (customerIds.length) ors.push(`customer_id.in.(${customerIds.join(",")})`);
    if (sp?.id) {
      ors.push(`sales_person_id.eq.${sp.id}`);
      // Invoices they co-sold are credited on the roster, not on the column.
      const coSold = await coSoldInvoiceIds(supabase, sp.id);
      if (coSold.length > 0) ors.push(`id.in.(${coSold.join(",")})`);
    }
    if (ors.length === 0) {
      const ordered = ["current", "1-30", "31-60", "61-90", "90+"] as const;
      return NextResponse.json({ buckets: ordered.map((l) => ({ label: l, count: 0, total: 0 })) });
    }
    query = query.or(ors.join(","));
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const empty = (label: AgingBucket["label"]): AgingBucket => ({ label, count: 0, total: 0 });
  const buckets: Record<AgingBucket["label"], AgingBucket> = {
    current: empty("current"),
    "1-30": empty("1-30"),
    "31-60": empty("31-60"),
    "61-90": empty("61-90"),
    "90+": empty("90+"),
  };

  for (const row of data ?? []) {
    const paid = (row.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0);
    const due = Math.max(0, Number(row.total) - paid);
    if (due <= 0) continue;

    const dueDate = new Date(row.due_date);
    const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000);
    let label: AgingBucket["label"];
    if (daysOverdue < 1) label = "current";
    else if (daysOverdue <= 30) label = "1-30";
    else if (daysOverdue <= 60) label = "31-60";
    else if (daysOverdue <= 90) label = "61-90";
    else label = "90+";
    buckets[label].count += 1;
    buckets[label].total += due;
  }

  const ordered: AgingBucket["label"][] = ["current", "1-30", "31-60", "61-90", "90+"];
  return NextResponse.json({
    buckets: ordered.map((l) => ({
      ...buckets[l],
      total: Number(buckets[l].total.toFixed(2)),
    })),
  });
}
