import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCreate } from "@/lib/permissions";
import { recordAudit } from "@/lib/admin/recordAudit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdminRole(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return { authorized: false, userId: null as string | null };
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { authorized: false, userId: null };

    const { data: customer } = await supabase
      .from("customers")
      .select("role")
      .eq("id", user.id)
      .single();
    const role = customer?.role || "customer";
    return { authorized: canCreate(role), userId: user.id };
  } catch {
    return { authorized: false, userId: null };
  }
}

const PO_SELECT = `
  *,
  supplier:suppliers (*),
  items:purchase_order_items (*, product:products ( vials_per_box )),
  receipts:purchase_order_receipts (
    *,
    items:purchase_order_receipt_items (*)
  )
`;

// POST /api/admin/purchase-orders/:id/receipts
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { authorized, userId } = await verifyAdminRole(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .map((it: any) => ({ po_item_id: String(it.po_item_id ?? ""), qty: Number(it.qty) }))
    .filter((it: any) => it.po_item_id && Number.isFinite(it.qty) && it.qty > 0);

  if (items.length === 0) {
    return NextResponse.json({ error: "Enter at least one quantity to receive" }, { status: 400 });
  }

  const { error: rpcErr } = await supabase.rpc("receive_po_items", {
    p_po_id: id,
    p_actor: userId,
    p_note: body.note ?? null,
    p_items: items,
  });

  if (rpcErr) {
    console.error("receive_po_items failed:", rpcErr);
    return NextResponse.json({ error: rpcErr.message || "Could not record receipt" }, { status: 400 });
  }

  await recordAudit({
    supabase,
    actorId: userId,
    action: "purchase_order.receive",
    entityType: "purchase_order",
    entityId: id,
    payload: {
      lines: items.length,
      qty_total: items.reduce((s: number, it: { qty: number }) => s + it.qty, 0),
      note: body.note ?? null,
    },
  });

  const { data: fresh } = await supabase
    .from("purchase_orders")
    .select(PO_SELECT)
    .eq("id", id)
    .single();

  return NextResponse.json({ purchase_order: fresh }, { status: 201 });
}
