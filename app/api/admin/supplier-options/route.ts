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

// POST /api/admin/supplier-options
// Body: { product_ids: string[] }
// Like the invoice-scoped route, but for an arbitrary set of products — used by
// the prepaid invoice form (which has draft line items but no saved invoice yet)
// to show the cheapest supplier per product and let the user override.
export async function POST(request: NextRequest) {
  if (!(await verifyAdminRead(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const productIds: string[] = Array.isArray(body?.product_ids)
    ? body.product_ids.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
    : [];

  const result = await getSupplierOptionsForProducts(supabase, productIds);
  return NextResponse.json(result);
}
