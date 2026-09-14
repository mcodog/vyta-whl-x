import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { logAuditServer } from "@/lib/admin/audit";

// Use the shared service-role client (autoRefreshToken: false, persistSession: false)
const supabase = getSupabase();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Helper: verify the caller is an admin — returns actor info for logging
async function verifyAdmin(
  request: NextRequest,
): Promise<{ authorized: boolean; email?: string; role?: string; userId?: string | null }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { authorized: false };

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) return { authorized: false };

  // Try by ID first, fall back to email (mirrors /api/auth/customer behaviour)
  let { data: rows } = await supabase
    .from("customers")
    .select("role, email")
    .eq("id", user.id);

  if (!rows?.length && user.email) {
    const { data: emailRows } = await supabase
      .from("customers")
      .select("role, email")
      .eq("email", user.email.toLowerCase());
    rows = emailRows;
  }

  const role = rows?.[0]?.role;
  const email = rows?.[0]?.email ?? user.email;
  return { authorized: role === "admin", email, role, userId: user.id };
}

/**
 * POST /api/admin/users
 * Creates a new Supabase Auth user (with email auto-confirmed) and a customers row.
 * Requires admin role.
 */
export async function POST(request: NextRequest) {
  console.log("[POST /api/admin/users] Request received");
  console.log(
    "[POST /api/admin/users] SERVICE_ROLE_KEY prefix:",
    serviceRoleKey?.slice(0, 20),
  );
  console.log(
    "[POST /api/admin/users] SUPABASE_URL:",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );

  const actor = await verifyAdmin(request);
  console.log("[POST /api/admin/users] actor:", {
    email: actor.email,
    role: actor.role,
    authorized: actor.authorized,
  });

  if (!actor.authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { email, first_name, last_name, role, password, phone, active } = body;
  console.log("[POST /api/admin/users] Body:", {
    email,
    first_name,
    last_name,
    role,
    phone,
    active,
    hasPassword: !!password,
  });

  if (!email || !first_name || !last_name || !role || !password) {
    console.log("[POST /api/admin/users] Missing required fields");
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  console.log("[POST /api/admin/users] Creating auth user via admin API...");
  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { first_name, last_name },
    });
  console.log("[POST /api/admin/users] Auth user result:", {
    userId: authData?.user?.id,
    errorMessage: authError?.message,
    errorCode: (authError as any)?.code,
    errorStatus: (authError as any)?.status,
  });

  if (authError || !authData.user) {
    console.error(
      "[POST /api/admin/users] Auth user creation failed — full error:",
      JSON.stringify(authError),
    );
    return NextResponse.json(
      { error: authError?.message || "Failed to create auth user" },
      { status: 500 },
    );
  }

  console.log("[POST /api/admin/users] Inserting customers row...");
  const { error: profileError } = await supabase.from("customers").insert({
    id: authData.user.id,
    email: email.toLowerCase(),
    first_name,
    last_name,
    phone: phone || null,
    role,
    is_admin: role === "admin",
    active: active !== undefined ? active : true,
    email_verified: true,
  });
  console.log(
    "[POST /api/admin/users] customers insert error:",
    profileError?.message ?? "none",
  );

  if (profileError) {
    await supabase.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json(
      { error: profileError.message || "Failed to create customer profile" },
      { status: 500 },
    );
  }

  await logAuditServer(supabase, {
    actor_id: actor.userId ?? null,
    action: "user.create",
    entity_type: "user",
    entity_id: authData.user.id,
    payload: { email: email.toLowerCase(), role },
  });

  console.log("[POST /api/admin/users] Done — user created successfully");
  return NextResponse.json({ success: true });
}
