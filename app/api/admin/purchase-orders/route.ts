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

    if (requireMutation && !canCreate(role)) {
      return { authorized: false, role, userId: user.id };
    }
    if (!requireMutation && (role === "admin" || role === "assistant")) {
      return { authorized: true, role, userId: user.id };
    }
    return { authorized: role === "admin", role, userId: user.id };
  } catch (e) {
    console.error("verifyAdminRole error:", e);
    return { authorized: false, role: "customer" as const, userId: null };
  }
}

// GET /api/admin/purchase-orders
export async function GET(request: NextRequest) {
  const { authorized } = await verifyAdminRole(request);
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const status = params.get("status");
  const supplierId = params.get("supplier_id");

  let query = supabase
    .from("purchase_orders")
    .select(`*, supplier:suppliers (id, name), items:purchase_order_items (id)`)
    .order("created_at", { ascending: false });

  if (status && status !== "all") query = query.eq("status", status);
  if (supplierId) query = query.eq("supplier_id", supplierId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ purchase_orders: data ?? [] });
}

// POST /api/admin/purchase-orders
export async function POST(request: NextRequest) {
  const { authorized, userId } = await verifyAdminRole(request, true);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      supplier_id,
      status = "pending",
      tax_type = "percentage",
      tax_value = 0,
      shipping_fee = 0,
      discount_type = "fixed",
      discount_value = 0,
      order_date = null,
      expected_date = null,
      notes = null,
      items = [],
      backorder_id = null,
    } = body ?? {};

    if (!supplier_id) {
      return NextResponse.json({ error: "supplier_id is required" }, { status: 400 });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
    }

    // Validate items + compute totals server-side (don't trust the client)
    const cleanedItems = items.map((it: any) => {
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
    const taxValueNum = Number(tax_value) || 0;
    const shippingFee = Math.max(0, Number(shipping_fee) || 0);
    const discountValueNum = Math.max(0, Number(discount_value) || 0);
    // Discount can be a flat amount or a percentage of the product subtotal.
    const discountAmount =
      discount_type === "percentage"
        ? Number((subtotal * (discountValueNum / 100)).toFixed(2))
        : Number(discountValueNum.toFixed(2));
    // Financial summary order: subtotal -> shipping fee -> discount -> tax.
    // Tax (when a percentage) is applied to the running total after shipping
    // and discount.
    const taxableBase = subtotal + shippingFee - discountAmount;
    const taxTotal =
      tax_type === "percentage"
        ? Number((taxableBase * (taxValueNum / 100)).toFixed(2))
        : Number(taxValueNum.toFixed(2));
    const total = Number((subtotal + shippingFee - discountAmount + taxTotal).toFixed(2));

    // Landed cost per line: fold each line's share of shipping and discount
    // into its per-unit cost (allocated by value). Recorded on the line so
    // COGS / margin can read the true cost basis without re-deriving it.
    const landed = computeLandedCosts({
      lines: cleanedItems,
      shippingFee,
      discountAmount,
    });

    const { data: po, error: poErr } = await supabase
      .from("purchase_orders")
      .insert({
        supplier_id,
        status,
        tax_type,
        tax_value: taxValueNum,
        tax_total: taxTotal,
        subtotal: Number(subtotal.toFixed(2)),
        shipping_fee: Number(shippingFee.toFixed(2)),
        discount_type,
        discount_value: Number(discountValueNum.toFixed(2)),
        discount: Number(discountAmount.toFixed(2)),
        total,
        notes,
        order_date,
        expected_date,
        created_by: userId,
      })
      .select()
      .single();

    if (poErr || !po) {
      console.error("createPurchaseOrder insert error:", poErr);
      return NextResponse.json({ error: poErr?.message ?? "Insert failed" }, { status: 500 });
    }

    const itemRows = cleanedItems.map((it, i) => ({
      ...it,
      purchase_order_id: po.id,
      landed_unit_cost: round4(landed[i].landedUnitCost),
      landed_line_total: round2(landed[i].landedLineTotal),
    }));
    const { error: itemsErr } = await supabase.from("purchase_order_items").insert(itemRows);
    if (itemsErr) {
      await supabase.from("purchase_orders").delete().eq("id", po.id);
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }

    // Initial create as 'fulfilled' applies inventory immediately and marks
    // every line fully received so completion reads 100%.
    if (status === "fulfilled") {
      const { error: rpcErr } = await supabase.rpc("apply_po_inventory", { po_id: po.id });
      if (rpcErr) console.error("apply_po_inventory at create:", rpcErr);
      const { data: insertedItems } = await supabase
        .from("purchase_order_items")
        .select("id, qty")
        .eq("purchase_order_id", po.id);
      for (const r of insertedItems ?? []) {
        await supabase
          .from("purchase_order_items")
          .update({ qty_received: r.qty })
          .eq("id", r.id);
      }
    }

    // Fulfilling a backorder: flush it (mark fulfilled + link this PO).
    if (backorder_id) {
      const { data: flushed, error: boErr } = await supabase
        .from("backorders")
        .update({
          status: "fulfilled",
          purchase_order_id: po.id,
          fulfilled_at: new Date().toISOString(),
        })
        .eq("id", backorder_id)
        .eq("status", "open")
        .select("invoice_id")
        .maybeSingle();
      if (boErr) console.error("flush backorder failed:", boErr);

      // Recommended action, made actionable: once the restock has actually
      // landed (PO received → 'fulfilled'), promote the owed items' backorder
      // invoice out of draft so it re-enters the warehouse queue. Without this
      // the customer's backordered portion is silently forgotten — nobody is
      // ever prompted to pack and ship it. Only when stock is truly in; a PO
      // that's merely 'ordered' leaves the invoice as a draft until it arrives.
      if (flushed?.invoice_id && status === "fulfilled") {
        const { error: promoteErr } = await supabase
          .from("invoices")
          .update({ status: "sent" })
          .eq("id", flushed.invoice_id)
          .eq("status", "draft");
        if (promoteErr) console.error("promote backorder invoice failed:", promoteErr);
      }
    }

    await recordAudit({
      supabase,
      actorId: userId,
      action: "purchase_order.create",
      entityType: "purchase_order",
      entityId: po.id,
      payload: {
        supplier_id,
        status,
        total,
        item_count: cleanedItems.length,
        backorder_id: backorder_id ?? null,
      },
    });

    return NextResponse.json({ purchase_order: po }, { status: 201 });
  } catch (e: any) {
    console.error("POST /purchase-orders error:", e);
    return NextResponse.json({ error: e?.message ?? "Internal server error" }, { status: 500 });
  }
}
