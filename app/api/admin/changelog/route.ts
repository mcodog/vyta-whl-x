import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCreate } from "@/lib/permissions";
import { logAuditServer } from "@/lib/admin/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/** Resolve the caller's role and id from the bearer token. */
async function getActor(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { role: "customer" as const, id: null, name: null };
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { role: "customer" as const, id: null, name: null };
  const { data: customer } = await supabase
    .from("customers")
    .select("role, first_name, last_name")
    .eq("id", user.id)
    .single();
  const name = customer
    ? `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim()
    : null;
  return {
    role: (customer?.role || "customer") as "admin" | "assistant" | "customer",
    id: user.id,
    name: name || null,
  };
}

/** Normalize a string[] input, dropping blanks. */
function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
}

/** Parse an incoming date to an ISO string, falling back to now if invalid. */
function toIso(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/** Normalize related links input to [{ label, url }]. */
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

export async function GET(request: NextRequest) {
  const { role } = await getActor(request);
  if (role !== "admin" && role !== "assistant") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { data, error } = await supabase
    .from("changelog_entries")
    .select("*")
    .order("entry_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(request: NextRequest) {
  const actor = await getActor(request);
  if (!canCreate(actor.role)) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  if (!body?.title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const impact =
    body.impact === "critical" || body.impact === "major" || body.impact === "minor"
      ? body.impact
      : null;

  const insert = {
    category: (body.category?.trim() || "feature") as string,
    title: body.title.trim(),
    summary: typeof body.summary === "string" ? body.summary.trim() : "",
    body: typeof body.body === "string" && body.body.trim() ? body.body : null,
    author: (body.author?.trim() || actor.name) ?? null,
    version: body.version?.trim() || null,
    impact,
    tags: cleanStringArray(body.tags),
    affected_areas: cleanStringArray(body.affected_areas),
    links: cleanLinks(body.links),
    entry_date: toIso(body.entry_date),
    created_by: actor.id,
  };

  const { data, error } = await supabase
    .from("changelog_entries")
    .insert(insert)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(supabase, {
    actor_id: actor.id,
    action: "changelog.create",
    entity_type: "changelog_entry",
    entity_id: data.id,
    payload: { title: data.title, category: data.category },
  });

  return NextResponse.json({ entry: data }, { status: 201 });
}
