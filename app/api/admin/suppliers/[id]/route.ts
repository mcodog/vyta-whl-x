import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCreate, canDelete } from "@/lib/permissions";
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

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { role, userId } = await getRole(request);
  if (!canCreate(role)) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const patch: Record<string, any> = {};
  for (const key of ["name", "contact_person", "email", "phone", "lead_time_days", "notes"]) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("suppliers")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAuditServer(supabase, {
    actor_id: userId,
    action: "supplier.update",
    entity_type: "supplier",
    entity_id: id,
    payload: patch,
  });
  return NextResponse.json({ supplier: data });
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { role, userId } = await getRole(request);
  if (!canDelete(role)) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const { error } = await supabase.from("suppliers").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAuditServer(supabase, {
    actor_id: userId,
    action: "supplier.delete",
    entity_type: "supplier",
    entity_id: id,
  });
  return NextResponse.json({ ok: true });
}
