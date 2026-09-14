import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canEdit } from "@/lib/permissions";
import { logAuditServer } from "@/lib/admin/audit";
import { getSupplierOptionsForProducts } from "@/lib/admin/supplier-options-server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getAuth(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { role: "customer" as const, userId: null };
  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { role: "customer" as const, userId: null };
  const { data: customer } = await supabase
    .from("customers")
    .select("role")
    .eq("id", user.id)
    .single();
  return { role: (customer?.role || "customer") as any, userId: user.id };
}

// POST /api/admin/invoices/:id/convert-to-prepaid
// Turns an ordinary invoice into a prepaid (procurement) invoice: flips
// invoice_type to 'prepaid' and assigns each product-linked line the cheapest
// supplier (leaving any existing override untouched). Line items are updated in
// place — never deleted/re-inserted — so fulfillment progress is preserved.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { role, userId } = await getAuth(request);
  if (!canEdit(role)) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, invoice_number, invoice_type")
    .eq("id", id)
    .single();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  // Flip the type (idempotent — safe to call on an already-prepaid invoice).
  if (invoice.invoice_type !== "prepaid") {
    const { error: updErr } = await supabase
      .from("invoices")
      .update({ invoice_type: "prepaid" })
      .eq("id", id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Assign the cheapest supplier to each product line that has no supplier yet.
  const { data: lineItems } = await supabase
    .from("invoice_line_items")
    .select("id, product_id, preferred_supplier_id")
    .eq("invoice_id", id);

  const productIds = (lineItems ?? [])
    .map((li: any) => li.product_id)
    .filter((x: unknown): x is string => !!x);

  let assigned = 0;
  if (productIds.length > 0) {
    const { products } = await getSupplierOptionsForProducts(supabase, productIds);
    for (const li of lineItems ?? []) {
      if (!li.product_id || li.preferred_supplier_id) continue;
      const cheapest = products[li.product_id]?.cheapest_supplier_id ?? null;
      if (!cheapest) continue;
      const { error: liErr } = await supabase
        .from("invoice_line_items")
        .update({ preferred_supplier_id: cheapest })
        .eq("id", li.id);
      if (!liErr) assigned += 1;
    }
  }

  await logAuditServer(supabase, {
    actor_id: userId,
    action: "invoice.convert_prepaid",
    entity_type: "invoice",
    entity_id: id,
    payload: { invoice_number: invoice.invoice_number, lines_routed: assigned },
  });

  return NextResponse.json({ ok: true, lines_routed: assigned });
}
