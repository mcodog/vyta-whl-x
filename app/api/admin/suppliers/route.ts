import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCreate } from "@/lib/permissions";
import { logAuditServer } from "@/lib/admin/audit";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdminRole(request: NextRequest, requireMutation = false) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return { authorized: false, role: "customer" as const, userId: null };
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return { authorized: false, role: "customer" as const, userId: null };
    const { data: customer } = await supabase
      .from("customers")
      .select("role")
      .eq("id", user.id)
      .single();
    const role = customer?.role || "customer";
    if (requireMutation && !canCreate(role)) return { authorized: false, role, userId: user.id };
    if (!requireMutation && (role === "admin" || role === "assistant")) {
      return { authorized: true, role, userId: user.id };
    }
    return { authorized: role === "admin", role, userId: user.id };
  } catch {
    return { authorized: false, role: "customer" as const, userId: null };
  }
}

export async function GET(request: NextRequest) {
  const { authorized } = await verifyAdminRole(request);
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data, error } = await supabase.from("suppliers").select("*").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ suppliers: data ?? [] });
}

export async function POST(request: NextRequest) {
  const { authorized, userId } = await verifyAdminRole(request, true);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: "Supplier name is required" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name: body.name.trim(),
      contact_person: body.contact_person ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      lead_time_days: body.lead_time_days ?? 7,
      notes: body.notes ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Seed the new supplier's pricelist from default product prices. Non-fatal:
  // missing entries fall back to products.price everywhere, so a failure here
  // just means prices show their defaults until edited/synced.
  try {
    const { data: products } = await supabase
      .from("products")
      .select("id, price")
      .eq("active", true);
    if (products && products.length > 0) {
      await supabase.from("supplier_prices").upsert(
        products.map((p: any) => ({
          supplier_id: data.id,
          product_id: p.id,
          price: Number(p.price) || 0,
        })),
        { onConflict: "supplier_id,product_id" },
      );
    }
  } catch (e) {
    console.error("seed supplier_prices failed:", e);
  }

  await logAuditServer(supabase, {
    actor_id: userId,
    action: "supplier.create",
    entity_type: "supplier",
    entity_id: data.id,
    payload: { name: data.name },
  });

  return NextResponse.json({ supplier: data }, { status: 201 });
}
