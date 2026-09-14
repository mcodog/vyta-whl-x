import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logAuditServer } from "@/lib/admin/audit";
import { verifyWarehouse } from "../../route";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const lineTotal = (qty: number, unitPrice: number, discountPct: number) =>
  Number((qty * unitPrice * (1 - discountPct / 100)).toFixed(2));

// Recompute and persist a backorder invoice's totals from its line items.
async function recomputeInvoiceTotals(invoiceId: string) {
  const { data: lines } = await supabase
    .from("invoice_line_items")
    .select("line_total")
    .eq("invoice_id", invoiceId);
  const subtotal = (lines ?? []).reduce((s, l: any) => s + Number(l.line_total ?? 0), 0);
  const { data: inv } = await supabase
    .from("invoices")
    .select("tax_rate, shipping_cost")
    .eq("id", invoiceId)
    .single();
  const taxRate = Number(inv?.tax_rate ?? 0);
  const shipping = Number(inv?.shipping_cost ?? 0);
  const taxTotal = Number((subtotal * (taxRate / 100)).toFixed(2));
  const total = Number((subtotal + taxTotal + shipping).toFixed(2));
  await supabase
    .from("invoices")
    .update({
      subtotal: Number(subtotal.toFixed(2)),
      tax_total: taxTotal,
      total,
    })
    .eq("id", invoiceId);
}

// Find the single backorder invoice bound to `parentId`, or create it. Every
// backorder from the parent funnels into this one invoice — no new invoice is
// created after the first.
async function getOrCreateBackorderInvoice(parentId: string) {
  const { data: existing } = await supabase
    .from("invoices")
    .select("id, invoice_number")
    .eq("parent_invoice_id", parentId)
    .eq("is_backorder", true)
    .limit(1)
    .maybeSingle();
  if (existing) return existing;

  const { data: parent } = await supabase
    .from("invoices")
    .select(
      "customer_id, customer_name, customer_email, customer_phone, fulfillment_type, sales_person_id, issue_date",
    )
    .eq("id", parentId)
    .single();

  const { data: created, error } = await supabase
    .from("invoices")
    .insert({
      customer_id: parent?.customer_id ?? null,
      customer_name: parent?.customer_name ?? null,
      customer_email: parent?.customer_email ?? null,
      customer_phone: parent?.customer_phone ?? null,
      issue_date: parent?.issue_date ?? new Date().toISOString().slice(0, 10),
      subtotal: 0,
      tax_rate: 0,
      tax_total: 0,
      shipping_cost: 0,
      total: 0,
      // Draft keeps it out of the warehouse queue; non_payable marks it as a
      // tracking-only backorder that should never be collected on.
      status: "draft",
      fulfillment_type: parent?.fulfillment_type ?? "shipment",
      is_backorder: true,
      non_payable: true,
      parent_invoice_id: parentId,
      notes: "Backorder — awaiting stock (non-payable).",
    })
    .select("id, invoice_number")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Could not create backorder invoice");

  // Surface it in the Backorders tab as well.
  await supabase.from("backorders").insert({ invoice_id: created.id, status: "open" }).then(
    undefined,
    () => {},
  );

  return created;
}

// POST /api/warehouse/queue/:id/line
// Body: { action: 'fulfill' | 'backorder', line_item_id, qty }
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { authorized, userId } = await verifyWarehouse(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const action = body?.action as "fulfill" | "backorder" | undefined;
  const lineItemId = body?.line_item_id as string | undefined;
  const reqQty = Math.floor(Number(body?.qty));

  if (action !== "fulfill" && action !== "backorder") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  if (!lineItemId) {
    return NextResponse.json({ error: "line_item_id is required" }, { status: 400 });
  }
  if (!Number.isFinite(reqQty) || reqQty <= 0) {
    return NextResponse.json({ error: "qty must be a positive number" }, { status: 400 });
  }

  // Load the line item and confirm it belongs to this invoice.
  const { data: line, error: lineErr } = await supabase
    .from("invoice_line_items")
    .select("id, invoice_id, product_id, description, qty, unit_price, discount_pct, qty_fulfilled, qty_backordered")
    .eq("id", lineItemId)
    .single();
  if (lineErr || !line || line.invoice_id !== id) {
    return NextResponse.json({ error: "Line item not found on this invoice" }, { status: 404 });
  }

  const qty = Number(line.qty);
  const fulfilled = Number(line.qty_fulfilled ?? 0);
  const backordered = Number(line.qty_backordered ?? 0);

  if (action === "fulfill") {
    // Cap fulfilled so fulfilled + backordered never exceeds the line quantity.
    const maxFulfill = Math.max(0, qty - backordered);
    const newFulfilled = Math.min(reqQty, maxFulfill);
    const { error } = await supabase
      .from("invoice_line_items")
      .update({ qty_fulfilled: newFulfilled })
      .eq("id", lineItemId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logAuditServer(supabase, {
      actor_id: userId,
      action: "invoice.line_fulfill",
      entity_type: "invoice",
      entity_id: id,
      payload: { line_item_id: lineItemId, qty_fulfilled: newFulfilled },
    });
    return NextResponse.json({ ok: true, qty_fulfilled: newFulfilled });
  }

  // --- backorder ---------------------------------------------------------
  // Only the portion that's neither fulfilled nor already backordered can move.
  const available = Math.max(0, qty - fulfilled - backordered);
  if (available <= 0) {
    return NextResponse.json(
      { error: "Nothing left to backorder on this line" },
      { status: 400 },
    );
  }
  const moveQty = Math.min(reqQty, available);

  const backInvoice = await getOrCreateBackorderInvoice(id);

  // Merge into an existing matching line on the backorder invoice (same product
  // / description) so quantities accumulate instead of stacking duplicate rows.
  const { data: existingLine } = await supabase
    .from("invoice_line_items")
    .select("id, qty, unit_price, discount_pct")
    .eq("invoice_id", backInvoice.id)
    .eq("description", line.description)
    .limit(1)
    .maybeSingle();

  const unit = Number(line.unit_price ?? 0);
  const disc = Number(line.discount_pct ?? 0);

  if (existingLine) {
    const newQty = Number(existingLine.qty) + moveQty;
    const { error } = await supabase
      .from("invoice_line_items")
      .update({ qty: newQty, line_total: lineTotal(newQty, unit, disc) })
      .eq("id", existingLine.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase.from("invoice_line_items").insert({
      invoice_id: backInvoice.id,
      product_id: line.product_id,
      description: line.description,
      qty: moveQty,
      unit_price: unit,
      discount_pct: disc,
      line_total: lineTotal(moveQty, unit, disc),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Track the moved quantity on the original line.
  const { error: upErr } = await supabase
    .from("invoice_line_items")
    .update({ qty_backordered: backordered + moveQty })
    .eq("id", lineItemId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await recomputeInvoiceTotals(backInvoice.id);

  await logAuditServer(supabase, {
    actor_id: userId,
    action: "invoice.line_backorder",
    entity_type: "invoice",
    entity_id: id,
    payload: {
      line_item_id: lineItemId,
      qty: moveQty,
      backorder_invoice_id: backInvoice.id,
    },
  });

  return NextResponse.json({
    ok: true,
    qty_backordered: backordered + moveQty,
    backorder_invoice_id: backInvoice.id,
    backorder_invoice_number: backInvoice.invoice_number,
  });
}
