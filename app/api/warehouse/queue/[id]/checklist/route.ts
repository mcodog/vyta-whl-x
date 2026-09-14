import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logAuditServer } from "@/lib/admin/audit";
import { verifyWarehouse } from "../../route";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// PATCH /api/warehouse/queue/:id/checklist
// Persist the set of handling-step keys the warehouse has checked off.
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { authorized, userId } = await verifyWarehouse(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const raw = body?.checklist;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "checklist must be an array" }, { status: 400 });
  }
  // Keep only unique, non-empty string keys.
  const checklist = [...new Set(raw.filter((k: unknown): k is string => typeof k === "string" && k.length > 0))];

  const { error } = await supabase
    .from("invoices")
    .update({ handling_checklist: checklist })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(supabase, {
    actor_id: userId,
    action: "invoice.handling_checklist_update",
    entity_type: "invoice",
    entity_id: id,
    payload: { checklist },
  });

  return NextResponse.json({ ok: true, handling_checklist: checklist });
}
