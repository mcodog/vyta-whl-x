import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdmin(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return false;
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return false;
    const { data: customer } = await supabase
      .from("customers")
      .select("role")
      .eq("id", user.id)
      .single();
    const role = customer?.role || "customer";
    return role === "admin" || role === "assistant";
  } catch {
    return false;
  }
}

// GET /api/admin/pricelists/active — the active pricelist + its product prices.
// Returns { pricelist: null, items: [] } when none is active. Consumed by the
// invoice form to look up per-product prices (product_id -> price).
export async function GET(request: NextRequest) {
  if (!(await verifyAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Select * (not an explicit column list) so this keeps working even if the
  // `currency` column hasn't been migrated yet — currency just comes back
  // undefined and is inferred from the name client-side.
  // Use order+limit(1) rather than maybeSingle(): if the single-active index is
  // ever missing and two rows are active, maybeSingle() would 500 and the whole
  // invoice would silently fall back to catalog prices. Taking the most-recently
  // updated active row keeps pricing working.
  const { data: rows, error } = await supabase
    .from("pricelists")
    .select("*")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const pricelist = rows?.[0] ?? null;
  if (!pricelist) return NextResponse.json({ pricelist: null, items: [] });

  const { data: items } = await supabase
    .from("pricelist_items")
    .select("product_id, price, unlabeled_price")
    .eq("pricelist_id", pricelist.id);

  return NextResponse.json({ pricelist, items: items ?? [] });
}
