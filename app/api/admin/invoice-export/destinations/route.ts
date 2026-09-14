import { NextRequest, NextResponse } from "next/server";
import { exportSupabase, getExportAuth } from "@/lib/admin/export-server";
import { logAuditServer } from "@/lib/admin/audit";

// Never send the raw secret to the browser — only whether one is set.
function maskDestination(row: any) {
  const { secret, ...rest } = row;
  return { ...rest, secret_set: Boolean(secret) };
}

// GET /api/admin/invoice-export/destinations
// admin/assistant may read the destination list (secrets masked).
export async function GET(request: NextRequest) {
  const { role } = await getExportAuth(request);
  if (role !== "admin" && role !== "assistant") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { data, error } = await exportSupabase
    .from("invoice_export_destinations")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ destinations: (data ?? []).map(maskDestination) });
}

// POST /api/admin/invoice-export/destinations — admin creates a destination.
export async function POST(request: NextRequest) {
  const { role, userId } = await getExportAuth(request);
  if (role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const label = String(body.label ?? "").trim();
  const url = String(body.edge_function_url ?? "").trim();
  const secret = String(body.secret ?? "").trim();
  const notes = body.notes ? String(body.notes).trim() : null;
  const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

  if (!label) return NextResponse.json({ error: "Label is required" }, { status: 400 });
  if (!url) return NextResponse.json({ error: "Edge Function URL is required" }, { status: 400 });
  try {
    // Basic URL sanity check.
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    return NextResponse.json({ error: "Edge Function URL is not a valid URL" }, { status: 400 });
  }
  if (!secret) return NextResponse.json({ error: "Shared secret is required" }, { status: 400 });

  const { data, error } = await exportSupabase
    .from("invoice_export_destinations")
    .insert({ label, edge_function_url: url, secret, notes, enabled })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAuditServer(exportSupabase, {
    actor_id: userId,
    action: "create",
    entity_type: "invoice_export_destination",
    entity_id: data.id,
    payload: { label, edge_function_url: url },
  });

  return NextResponse.json({ destination: maskDestination(data) }, { status: 201 });
}
