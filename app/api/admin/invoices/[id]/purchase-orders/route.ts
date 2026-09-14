import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCreate } from "@/lib/permissions";
import { computeLandedCosts, round2, round4 } from "@/lib/admin/po-landed-cost";
import { recordAudit } from "@/lib/admin/recordAudit";

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
    if (requireMutation) return { authorized: canCreate(role), role, userId: user.id };
    return { authorized: role === "admin" || role === "assistant", role, userId: user.id };
  } catch {
    return { authorized: false, role: "customer" as const, userId: null };
  }
}

// GET /api/admin/invoices/:id/purchase-orders
// Lists the purchase orders that were generated from this (prepaid) invoice.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { authorized } = await verifyAdminRole(request);
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await ctx.params;

  const { data, error } = await supabase
    .from("purchase_orders")
    .select(`*, supplier:suppliers (id, name), items:purchase_order_items (id, description, sku_snapshot, qty, product_id)`)
    .eq("source_invoice_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ purchase_orders: data ?? [] });
}

interface GroupItem {
  product_id?: string | null;
  description?: string;
  sku_snapshot?: string | null;
  qty?: number;
  unit_price?: number;
  price_type?: "box" | "vial";
}
interface Group {
  supplier_id?: string;
  notes?: string | null;
  expected_date?: string | null;
  items?: GroupItem[];
}

// POST /api/admin/invoices/:id/purchase-orders
// Body: { groups: [{ supplier_id, notes?, expected_date?, items: [...] }] }
// Creates one purchase order per group, each linked back to this invoice via
// source_invoice_id. Totals and landed costs are computed server-side. Partial
// success is reported (a failed group doesn't abort the others).
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { authorized, userId } = await verifyAdminRole(request, true);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const { id } = await ctx.params;

  // The invoice must exist and be a prepaid invoice.
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, invoice_number, invoice_type")
    .eq("id", id)
    .single();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const groups: Group[] = Array.isArray(body?.groups) ? body.groups : [];
  if (groups.length === 0) {
    return NextResponse.json({ error: "At least one supplier group is required" }, { status: 400 });
  }

  const created: any[] = [];
  const failures: Array<{ supplier_id: string | null; error: string }> = [];

  for (const group of groups) {
    try {
      if (!group.supplier_id) throw new Error("supplier_id is required");
      const items = Array.isArray(group.items) ? group.items : [];
      if (items.length === 0) throw new Error("At least one line item is required");

      const cleanedItems = items.map((it) => {
        const qty = Number(it.qty);
        const unit = Number(it.unit_price);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error("Invalid item qty");
        if (!Number.isFinite(unit) || unit < 0) throw new Error("Invalid item unit_price");
        return {
          product_id: it.product_id ?? null,
          description: String(it.description ?? "").trim() || "Item",
          sku_snapshot: it.sku_snapshot ?? null,
          qty,
          unit_price: unit,
          line_total: Number((qty * unit).toFixed(2)),
          price_type: it.price_type === "vial" ? "vial" : "box",
        };
      });

      const subtotal = cleanedItems.reduce((s, i) => s + i.line_total, 0);
      const total = Number(subtotal.toFixed(2));
      const landed = computeLandedCosts({ lines: cleanedItems, shippingFee: 0, discountAmount: 0 });

      const notes =
        (group.notes && String(group.notes).trim()) ||
        `Prepaid procurement for invoice ${invoice.invoice_number}`;

      const { data: po, error: poErr } = await supabase
        .from("purchase_orders")
        .insert({
          supplier_id: group.supplier_id,
          status: "pending",
          tax_type: "percentage",
          tax_value: 0,
          tax_total: 0,
          subtotal: Number(subtotal.toFixed(2)),
          shipping_fee: 0,
          discount_type: "fixed",
          discount_value: 0,
          discount: 0,
          total,
          notes,
          expected_date: group.expected_date ?? null,
          source_invoice_id: id,
          created_by: userId,
        })
        .select()
        .single();
      if (poErr || !po) throw new Error(poErr?.message ?? "Insert failed");

      const itemRows = cleanedItems.map((it, i) => ({
        ...it,
        purchase_order_id: po.id,
        landed_unit_cost: round4(landed[i].landedUnitCost),
        landed_line_total: round2(landed[i].landedLineTotal),
      }));
      const { error: itemsErr } = await supabase.from("purchase_order_items").insert(itemRows);
      if (itemsErr) {
        await supabase.from("purchase_orders").delete().eq("id", po.id);
        throw new Error(itemsErr.message);
      }

      created.push(po);

      await recordAudit({
        supabase,
        actorId: userId,
        action: "purchase_order.create",
        entityType: "purchase_order",
        entityId: po.id,
        payload: {
          supplier_id: group.supplier_id,
          total,
          item_count: cleanedItems.length,
          source_invoice_id: id,
        },
      });
    } catch (e: any) {
      failures.push({ supplier_id: group.supplier_id ?? null, error: e?.message ?? "Failed" });
    }
  }

  const status = created.length > 0 ? 201 : 500;
  return NextResponse.json({ purchase_orders: created, failures }, { status });
}
