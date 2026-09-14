import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logErrorServer } from "@/lib/admin/errorLog";
import { recordAudit } from "@/lib/admin/recordAudit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyCaller(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { role: "customer", userId: null as string | null };
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { role: "customer", userId: null };
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return { role: customer?.role ?? "customer", userId: user.id };
}

// DELETE /api/admin/shipment-logs — dismiss auto-shipment log rows from the
// dashboard feed. Deletes are service-role only (RLS grants read, not delete),
// so they must go through this route.
//   ?id=<uuid>        -> remove a single log row
//   ?scope=failures   -> remove every failed (ok=false) log row
export async function DELETE(request: NextRequest) {
  const { role, userId } = await verifyCaller(request);
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const scope = searchParams.get("scope");

  if (!id && scope !== "failures") {
    return NextResponse.json({ error: "id or scope=failures required" }, { status: 400 });
  }

  try {
    let query = supabase.from("shipment_auto_logs").delete();
    query = id ? query.eq("id", id) : query.eq("ok", false);
    const { data, error } = await query.select("id");
    if (error) throw error;

    await recordAudit({
      supabase,
      actorId: userId,
      action: "shipment_log.delete",
      entityType: "shipment_log",
      entityId: id ?? null,
      payload: { scope: id ? "single" : "failures", deleted: data?.length ?? 0 },
    });

    return NextResponse.json({ deleted: data?.length ?? 0 });
  } catch (error) {
    await logErrorServer(supabase, {
      area: "shipment-logs",
      route: "/api/admin/shipment-logs",
      method: "DELETE",
      actor_id: userId,
      error,
    });
    return NextResponse.json({ error: "Failed to delete shipment log" }, { status: 500 });
  }
}
