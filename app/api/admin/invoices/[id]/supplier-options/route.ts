import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupplierOptionsForProducts } from "@/lib/admin/supplier-options-server";

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

// GET /api/admin/invoices/:id/supplier-options
// For every product-bearing line item on the invoice, returns which suppliers
// carry the product and at what price (cheapest flagged), plus the full supplier
// list so the UI can assign a supplier even to products no one explicitly prices.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await verifyAdminRead(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const { data: lineItems, error: liErr } = await supabase
    .from("invoice_line_items")
    .select("product_id")
    .eq("invoice_id", id);
  if (liErr) return NextResponse.json({ error: liErr.message }, { status: 500 });

  const productIds = (lineItems ?? [])
    .map((li: { product_id: string | null }) => li.product_id)
    .filter((x): x is string => !!x);

  const result = await getSupplierOptionsForProducts(supabase, productIds);
  return NextResponse.json(result);
}
