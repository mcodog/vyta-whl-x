import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logAuditServer } from "@/lib/admin/audit";
import { sendPackingList } from "@/lib/admin/send-packing-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: c } = await supabase
    .from("customers")
    .select("role, email, can_send_fulfillment_emails")
    .eq("id", user.id)
    .single();
  const role = c?.role || "customer";
  const canSend = role === "admin" || (role === "warehouse" && !!c?.can_send_fulfillment_emails);
  return { userId: user.id, role, email: c?.email ?? user.email ?? "", canSend };
}

// POST /api/warehouse/queue/:id/packing-list
// Manually (re)send the Packing List to the customer's client. Admins always;
// warehouse staff only when granted can_send_fulfillment_emails.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!auth.canSend) {
    return NextResponse.json({ error: "You don't have permission to send emails" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const toOverride = typeof body?.to === "string" && body.to.trim() ? body.to.trim() : null;

  const result = await sendPackingList(supabase, id, {
    userId: auth.userId,
    userEmail: auth.email,
    toOverride,
  });

  if (result.skipped) {
    return NextResponse.json({ error: result.error ?? "Not a client shipment" }, { status: 400 });
  }
  if (!result.success) {
    return NextResponse.json({ error: result.error ?? "Send failed" }, { status: 500 });
  }

  await logAuditServer(supabase, {
    actor_id: auth.userId,
    action: "fulfillment.packing_list_sent",
    entity_type: "invoice",
    entity_id: id,
    payload: { to: result.to, manual: true },
  });

  return NextResponse.json({ ok: true, to: result.to });
}
