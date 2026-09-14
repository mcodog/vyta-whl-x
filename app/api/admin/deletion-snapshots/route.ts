import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Admin + assistant may read the archive of deleted records. Deletion itself is
// admin-only (see /api/admin/deletion-review), but viewing the history is a
// read the wider admin team is trusted with.
async function verifyStaff(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) return false;

  let { data: rows } = await supabase.from("customers").select("role").eq("id", user.id);
  if (!rows?.length && user.email) {
    const { data: emailRows } = await supabase
      .from("customers")
      .select("role")
      .eq("email", user.email.toLowerCase());
    rows = emailRows;
  }
  const role = rows?.[0]?.role;
  return role === "admin" || role === "assistant";
}

/**
 * GET /api/admin/deletion-snapshots        → list (metadata only, newest first)
 * GET /api/admin/deletion-snapshots?id=…    → one row with the full snapshot JSON
 */
export async function GET(request: NextRequest) {
  if (!(await verifyStaff(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (id) {
    const { data, error } = await supabase
      .from("entity_deletion_snapshots")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ snapshot: data });
  }

  const { data, error } = await supabase
    .from("entity_deletion_snapshots")
    .select("id, entity_type, entity_id, entity_label, counts, disposition, guest_customer_id, created_by, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ snapshots: data ?? [] });
}
