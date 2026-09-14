import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";
import { logAuditServer } from "@/lib/admin/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdmin(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  let { data: rows } = await supabase.from("customers").select("role").eq("id", user.id);
  if (!rows?.length && user.email) {
    const { data: emailRows } = await supabase
      .from("customers")
      .select("role")
      .eq("email", user.email.toLowerCase());
    rows = emailRows;
  }
  return rows?.[0]?.role === "admin" ? user.id : null;
}

function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

/**
 * POST /api/admin/sales-persons/[id]/promote
 * Promotes a contact-only sales person ("Rep") into a full affiliate — "the step
 * up" (ADR 0003). Creates the login account (auth user + customers row with
 * role='affiliate' + affiliates row + referral code) and LINKS the person's
 * EXISTING sales_persons row to it (`user_id`), so their commission history is
 * preserved. Fails if the sales person is already an affiliate.
 *
 * The caller then emails a set-password link (same as the Add Affiliate flow).
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const adminId = await verifyAdmin(request);
  if (!adminId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));

  const { data: sp } = await supabase
    .from("sales_persons")
    .select("id, first_name, last_name, email, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!sp) return NextResponse.json({ error: "Sales person not found" }, { status: 404 });
  if (sp.user_id) {
    return NextResponse.json({ error: "This sales person is already an affiliate" }, { status: 400 });
  }

  const email = String(body.email || sp.email || "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json(
      { error: "An email is required to create the affiliate login" },
      { status: 400 },
    );
  }
  const wallet_address = body.wallet_address ? String(body.wallet_address).trim() : null;

  // 1. Auth user (throwaway password; a set-up link is emailed afterwards).
  const effectivePassword = randomBytes(24).toString("hex");
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: effectivePassword,
    email_confirm: true,
    user_metadata: { first_name: sp.first_name, last_name: sp.last_name },
  });
  if (authError || !authData.user) {
    const msg = authError?.message || "Failed to create login";
    const status = /already|exist/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
  const userId = authData.user.id;
  const passwordHash = createHash("sha256").update(effectivePassword).digest("hex");

  // 2. affiliates row (rollback the auth user on failure).
  const { error: affErr } = await supabase.from("affiliates").insert({
    id: userId,
    email,
    first_name: sp.first_name,
    last_name: sp.last_name,
    wallet_address,
    password_hash: passwordHash,
    active: true,
    total_earnings: 0,
  });
  if (affErr) {
    await supabase.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: affErr.message || "Failed to create affiliate profile" }, { status: 500 });
  }

  // 3. Unique referral code.
  let referralCode = "";
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateReferralCode();
    const { data: existing } = await supabase.from("referral_codes").select("id").eq("code", candidate).maybeSingle();
    if (!existing) { referralCode = candidate; break; }
  }
  if (referralCode) {
    await supabase.from("referral_codes").insert({ affiliate_id: userId, code: referralCode, active: true, uses_count: 0 });
  }

  // 4. customers row with the affiliate role (their /admin login).
  await supabase.from("customers").upsert(
    { id: userId, email, first_name: sp.first_name, last_name: sp.last_name, role: "affiliate", active: true, email_verified: true },
    { onConflict: "id" },
  );

  // 5. Link the EXISTING sales_persons row (keeps commission history) — the key
  //    difference from creating a brand-new affiliate.
  const { error: linkErr } = await supabase
    .from("sales_persons")
    .update({ user_id: userId, email })
    .eq("id", id);
  if (linkErr) {
    console.error("promote: failed to link sales_persons row", linkErr);
  }

  await logAuditServer(supabase, {
    actor_id: adminId,
    action: "sales_person.promote",
    entity_type: "sales_person",
    entity_id: id,
    payload: { affiliate_id: userId, email },
  });

  return NextResponse.json({ success: true, affiliate_id: userId, referral_code: referralCode || null });
}
