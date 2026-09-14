import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Backorders are an admin/assistant tool — hidden from affiliates.
async function requireStaff(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return false;
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = customer?.role || "customer";
  return role === "admin" || role === "assistant";
}

// GET /api/admin/backorders?status=open|fulfilled
export async function GET(request: NextRequest) {
  if (!(await requireStaff(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const statusParam = request.nextUrl.searchParams.get("status") || "open";
  const status = ["open", "fulfilled", "cancelled", "handled"].includes(statusParam) ? statusParam : "open";

  const { data, error } = await supabase
    .from("backorders")
    .select(`
      id, status, created_at, fulfilled_at, handled_at, invoice_id, purchase_order_id,
      invoice:invoices!invoice_id (
        id, invoice_number, customer_name, customer_email, total, status, created_at,
        customer:customers!customer_id ( first_name, last_name, email )
      ),
      items:backorder_items ( * ),
      purchase_order:purchase_orders ( id, po_number, status )
    `)
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("list backorders error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const backorders = (data ?? []).map((row: any) => {
    const inv = row.invoice;
    const customerName =
      inv?.customer_name ||
      (inv?.customer
        ? [inv.customer.first_name, inv.customer.last_name].filter(Boolean).join(" ")
        : null);
    const items = row.items ?? [];
    return {
      ...row,
      customer_name_display: customerName,
      customer_email_display: inv?.customer_email ?? inv?.customer?.email ?? null,
      item_count: items.length,
      total_backordered: items.reduce((s: number, i: any) => s + Number(i.qty_backordered), 0),
    };
  });

  return NextResponse.json({ backorders });
}
