import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canEdit, canDelete } from "@/lib/permissions";
import { logAuditServer } from "@/lib/admin/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getActor(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { role: "customer" as const, id: null };
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { role: "customer" as const, id: null };
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .single();
  return {
    role: (customer?.role || "customer") as "admin" | "assistant" | "customer",
    id: user.id,
  };
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
}

function toIso(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function cleanLinks(value: unknown): { label: string; url: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (!v || typeof v !== "object") return null;
      const label = typeof (v as any).label === "string" ? (v as any).label.trim() : "";
      const url = typeof (v as any).url === "string" ? (v as any).url.trim() : "";
      if (!label && !url) return null;
      return { label: label || url, url };
    })
    .filter((v): v is { label: string; url: string } => v !== null);
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!canEdit(actor.role)) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const patch: Record<string, any> = {};

  if (body.category !== undefined) patch.category = String(body.category).trim() || "feature";
  if (body.title !== undefined) {
    if (!String(body.title).trim()) {
      return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
    }
    patch.title = String(body.title).trim();
  }
  if (body.summary !== undefined) patch.summary = String(body.summary).trim();
  if (body.body !== undefined) patch.body = String(body.body).trim() ? body.body : null;
  if (body.author !== undefined) patch.author = String(body.author).trim() || null;
  if (body.version !== undefined) patch.version = String(body.version).trim() || null;
  if (body.impact !== undefined) {
    patch.impact =
      body.impact === "critical" || body.impact === "major" || body.impact === "minor"
        ? body.impact
        : null;
  }
  if (body.tags !== undefined) patch.tags = cleanStringArray(body.tags);
  if (body.affected_areas !== undefined) patch.affected_areas = cleanStringArray(body.affected_areas);
  if (body.links !== undefined) patch.links = cleanLinks(body.links);
  if (body.entry_date !== undefined) patch.entry_date = toIso(body.entry_date);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("changelog_entries")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(supabase, {
    actor_id: actor.id,
    action: "changelog.update",
    entity_type: "changelog_entry",
    entity_id: id,
    payload: { fields: Object.keys(patch) },
  });

  return NextResponse.json({ entry: data });
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor(request);
  if (!canDelete(actor.role)) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const { error } = await supabase.from("changelog_entries").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(supabase, {
    actor_id: actor.id,
    action: "changelog.delete",
    entity_type: "changelog_entry",
    entity_id: id,
    payload: null,
  });

  return NextResponse.json({ ok: true });
}
