import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendSupabasePasswordReset } from "@/lib/admin/magic-link";
import { logAuditServer } from "@/lib/admin/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type Role = "admin" | "assistant" | "affiliate" | "customer";

async function getCaller(request: NextRequest): Promise<{ id: string; role: Role } | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  return { id: user.id, role: (customer?.role || "customer") as Role };
}

// POST /api/admin/customers/password-reset — email a password-reset link to a
// customer or affiliate (both live in `customers`). Admin/assistant may target
// anyone; affiliates may only target customers bound to them — the same rule
// the sibling magic-link route enforces.
//
// Supabase generates and sends the email itself (recovery type, implicit flow
// so the link works outside the recipient's browser). Requires custom SMTP
// configured in Supabase for reliable delivery — see MAGIC-LINK-SETUP.md.
export async function POST(request: NextRequest) {
  const caller = await getCaller(request);
  if (!caller || caller.role === "customer") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const customerId = (body.customer_id ?? "").trim();
  if (!customerId) {
    return NextResponse.json({ error: "customer_id is required" }, { status: 400 });
  }

  const { data: customer, error: lookupError } = await supabase
    .from("customers")
    .select("id, email, first_name, last_name, affiliate_id, active")
    .eq("id", customerId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  // Affiliates can only reset passwords for their own bound customers.
  if (caller.role === "affiliate" && customer.affiliate_id !== caller.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (customer.active === false) {
    return NextResponse.json(
      { error: "This account is deactivated." },
      { status: 400 },
    );
  }

  const email = (customer.email ?? "").trim().toLowerCase();
  // Guest records use a synthetic @aminocan.local address and have no inbox.
  if (!email || email.endsWith("@aminocan.local")) {
    return NextResponse.json(
      { error: "This account doesn't have a real email address on file." },
      { status: 400 },
    );
  }

  const sent = await sendSupabasePasswordReset(email);

  if (!sent.success) {
    const msg = sent.error || "Failed to send the password reset email";
    // Supabase rate-limits recovery emails; ask the staffer to wait rather than
    // surface a raw error. Custom SMTP raises this limit substantially.
    if (/rate limit|too many|after \d+ second|email rate/i.test(msg)) {
      return NextResponse.json(
        { error: "Too many reset emails requested for this account. Please wait a minute and try again." },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  await logAuditServer(supabase, {
    actor_id: caller.id,
    action: "customer.password_reset",
    entity_type: "customer",
    entity_id: customer.id,
    payload: { email },
  });

  return NextResponse.json({ success: true });
}
