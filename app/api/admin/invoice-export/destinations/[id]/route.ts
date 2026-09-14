import { NextRequest, NextResponse } from "next/server";
import { exportSupabase, getExportAuth } from "@/lib/admin/export-server";
import { logAuditServer } from "@/lib/admin/audit";

function maskDestination(row: any) {
  const { secret, ...rest } = row;
  return { ...rest, secret_set: Boolean(secret) };
}

// PATCH /api/admin/invoice-export/destinations/:id — admin edits a destination.
// The secret is only overwritten when a non-empty value is supplied.
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { role, userId } = await getExportAuth(request);
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if (body.label !== undefined) {
    const label = String(body.label).trim();
    if (!label) return NextResponse.json({ error: "Label cannot be empty" }, { status: 400 });
    patch.label = label;
  }
  if (body.edge_function_url !== undefined) {
    const url = String(body.edge_function_url).trim();
    if (!url) return NextResponse.json({ error: "URL cannot be empty" }, { status: 400 });
    try {
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      return NextResponse.json({ error: "Edge Function URL is not a valid URL" }, { status: 400 });
    }
    patch.edge_function_url = url;
  }
  if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null;
  if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
  // Only rotate the secret when a fresh non-empty value is provided.
  if (typeof body.secret === "string" && body.secret.trim()) {
    patch.secret = body.secret.trim();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  const { data, error } = await exportSupabase
    .from("invoice_export_destinations")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: error ? 500 : 404 });
  }

  await logAuditServer(exportSupabase, {
    actor_id: userId,
    action: "update",
    entity_type: "invoice_export_destination",
    entity_id: id,
    payload: { fields: Object.keys(patch) },
  });

  return NextResponse.json({ destination: maskDestination(data) });
}

// DELETE /api/admin/invoice-export/destinations/:id — admin removes it.
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { role, userId } = await getExportAuth(request);
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const { error } = await exportSupabase
    .from("invoice_export_destinations")
    .delete()
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAuditServer(exportSupabase, {
    actor_id: userId,
    action: "delete",
    entity_type: "invoice_export_destination",
    entity_id: id,
  });

  return NextResponse.json({ ok: true });
}
