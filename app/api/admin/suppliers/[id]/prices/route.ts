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

// GET /api/admin/suppliers/:id/prices
// Returns every active product joined with this supplier's price (null when the
// supplier has no explicit row — callers fall back to the original price).
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { authorized } = await verifyAdminRole(request);
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await ctx.params;

  const { data: products, error: prodErr } = await supabase
    .from("products")
    .select("id, name, sku, strength, price")
    .eq("active", true)
    .order("name");
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });

  const { data: prices, error: priceErr } = await supabase
    .from("supplier_prices")
    .select("product_id, price")
    .eq("supplier_id", id);
  if (priceErr) return NextResponse.json({ error: priceErr.message }, { status: 500 });

  const priceMap = new Map<string, number>(
    (prices ?? []).map((r: any) => [r.product_id, Number(r.price)]),
  );

  const rows = (products ?? []).map((p: any) => ({
    product_id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    strength: p.strength ?? null,
    original_price: Number(p.price ?? 0),
    supplier_price: priceMap.has(p.id) ? priceMap.get(p.id)! : null,
  }));

  return NextResponse.json({ prices: rows });
}

// PUT /api/admin/suppliers/:id/prices
// Body: { items: [{ product_id, price }] } — upserts each supplier price.
export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { authorized, userId } = await verifyAdminRole(request, true);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const rawItems = Array.isArray(body.items) ? body.items : [];

  const rows = rawItems
    .map((it: any) => ({
      supplier_id: id,
      product_id: String(it.product_id ?? ""),
      price: Math.max(0, Number(it.price)),
    }))
    .filter((r: any) => r.product_id && Number.isFinite(r.price));

  if (rows.length === 0) {
    return NextResponse.json({ error: "No valid price rows to save" }, { status: 400 });
  }

  const { error } = await supabase
    .from("supplier_prices")
    .upsert(rows, { onConflict: "supplier_id,product_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(supabase, {
    actor_id: userId,
    action: "supplier_price.update",
    entity_type: "supplier_price",
    entity_id: id,
    payload: { count: rows.length },
  });

  return NextResponse.json({ ok: true, saved: rows.length });
}
