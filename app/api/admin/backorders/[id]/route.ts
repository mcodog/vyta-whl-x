import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/admin/recordAudit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getRole(request: NextRequest): Promise<{ role: string; userId: string | null }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { role: "customer", userId: null };
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { role: "customer", userId: null };
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return { role: customer?.role || "customer", userId: user.id };
}

async function requireStaff(request: NextRequest): Promise<boolean> {
  const { role } = await getRole(request);
  return role === "admin" || role === "assistant";
}

// GET /api/admin/backorders/:id — a single backorder with its items, used to
// prefill a purchase-order draft.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const { data, error } = await supabase
    .from("backorders")
    .select(`
      id, status, created_at, fulfilled_at, invoice_id, purchase_order_id,
      invoice:invoices!invoice_id ( id, invoice_number ),
      items:backorder_items ( * )
    `)
    .eq("id", id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ backorder: data });
}

// PATCH /api/admin/backorders/:id — staff. Move a backorder between the
// "open" and "handled" states. "handled" is a manual clear (no PO needed);
// only this row's status/handled_at change — the invoice, PO and stock are
// left untouched. Fulfilled backorders are terminal history and cannot be
// patched here.
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { role, userId } = await getRole(request);
  if (role !== "admin" && role !== "assistant") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const body = await request.json().catch(() => ({}));
  const nextStatus = body?.status;
  if (nextStatus !== "handled" && nextStatus !== "open") {
    return NextResponse.json({ error: "status must be 'handled' or 'open'" }, { status: 400 });
  }

  // Only allow the open <-> handled transition; never touch a fulfilled/cancelled row.
  const fromStatus = nextStatus === "handled" ? "open" : "handled";
  const { data, error } = await supabase
    .from("backorders")
    .update({
      status: nextStatus,
      handled_at: nextStatus === "handled" ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .eq("status", fromStatus)
    .select("id, status, invoice_id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: `Backorder not found or not in '${fromStatus}' state` },
      { status: 409 },
    );
  }

  await recordAudit({
    supabase,
    actorId: userId,
    action: nextStatus === "handled" ? "backorder.handle" : "backorder.reopen",
    entityType: "backorder",
    entityId: id,
    payload: { from: fromStatus, to: nextStatus, invoice_id: data.invoice_id ?? null },
  });

  return NextResponse.json({ backorder: data });
}

// DELETE /api/admin/backorders/:id — admin only. Removes the backorder record
// (its backorder_items cascade). The linked invoice/PO are left untouched.
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { role, userId } = await getRole(request);
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const { id } = await ctx.params;

  // Grab a little context before the row (and its items) cascade away.
  const { data: existing } = await supabase
    .from("backorders")
    .select("status, invoice_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("backorders").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    supabase,
    actorId: userId,
    action: "backorder.delete",
    entityType: "backorder",
    entityId: id,
    payload: {
      status: existing?.status ?? null,
      invoice_id: existing?.invoice_id ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
