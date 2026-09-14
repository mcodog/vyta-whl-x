import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function requireStaff(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return false;
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = customer?.role || "customer";
  return role === "admin" || role === "assistant";
}

// GET /api/admin/backorders/count — number of OPEN backorders (for the nav badge)
export async function GET(request: NextRequest) {
  if (!(await requireStaff(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { count, error } = await supabase
    .from("backorders")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: count ?? 0 });
}
