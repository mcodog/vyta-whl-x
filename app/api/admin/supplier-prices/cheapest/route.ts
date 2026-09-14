import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function verifyAdminRead(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) return false;
    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return false;
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

// GET /api/admin/supplier-prices/cheapest
// Returns the cheapest supplier per product (across all explicit supplier_prices
// rows), keyed by product_id. Used by the PO page to flag a cheaper supplier.
export async function GET(request: NextRequest) {
  if (!(await verifyAdminRead(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("supplier_prices")
    .select("product_id, price, supplier:suppliers ( id, name )");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const cheapest: Record<string, { supplier_id: string; supplier_name: string; price: number }> = {};
  for (const row of (data ?? []) as any[]) {
    const price = Number(row.price);
    if (!row.supplier?.id || !Number.isFinite(price)) continue;
    const current = cheapest[row.product_id];
    if (!current || price < current.price) {
      cheapest[row.product_id] = {
        supplier_id: row.supplier.id,
        supplier_name: row.supplier.name,
        price,
      };
    }
  }

  return NextResponse.json({ cheapest });
}
