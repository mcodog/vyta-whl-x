import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canCreate } from "@/lib/permissions";
import {
  computeLandedCosts,
  resolveDiscountAmount,
  round2,
  round4,
} from "@/lib/admin/po-landed-cost";
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

    if (requireMutation && !canCreate(role)) return { authorized: false, role, userId: user.id };
    if (!requireMutation && (role === "admin" || role === "assistant")) {
      return { authorized: true, role, userId: user.id };
    }
    return { authorized: role === "admin", role, userId: user.id };
  } catch {
    return { authorized: false, role: "customer" as const, userId: null };
  }
}

// GET /api/admin/purchase-orders/:id
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { authorized } = await verifyAdminRole(request);
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await ctx.params;
  const { data, error } = await supabase
    .from("purchase_orders")
    .select(`*, supplier:suppliers (*), items:purchase_order_items (*)`)
    .eq("id", id)
    .single();
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Receipts are optional — tolerate the receiving tables not existing yet.
  const { data: receipts } = await supabase
    .from("purchase_order_receipts")
    .select(`*, items:purchase_order_receipt_items (*)`)
    .eq("purchase_order_id", id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ purchase_order: { ...data, receipts: receipts ?? [] } });
}

// PATCH /api/admin/purchase-orders/:id
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { authorized, userId } = await verifyAdminRole(request, true);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const { data: existing, error: fetchErr } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchErr || !existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const isLocked = existing.status === "paid" || existing.status === "cancelled";

  // When locked, only the status field can change
  if (isLocked) {
    const allowedKeys = ["status"];
    const submittedKeys = Object.keys(body);
    const disallowed = submittedKeys.filter((k) => !allowedKeys.includes(k));
    if (disallowed.length > 0) {
      return NextResponse.json(
        {
          error: `This purchase order is ${existing.status} and only its status may change. Disallowed fields: ${disallowed.join(", ")}`,
        },
        { status: 422 },
      );
    }
  }

  // Fulfillment status is derived from receiving — it can't be set by hand.
  if (body.status === "fulfilled" || body.status === "partially_fulfilled") {
    return NextResponse.json(
      { error: "Use the receiving panel to fulfill line items; this status is set automatically." },
      { status: 422 },
    );
  }

  // Once any quantity has been received, line items are frozen to protect the
  // received history. An admin can override the lock (body.override_receiving_lock)
  // to edit anyway — in that case we reconcile in place (see below) instead of
  // rejecting, so receipt records are preserved rather than orphaned.
  const overrideReceivingLock = body.override_receiving_lock === true;
  let existingItemRows: { id: string; qty_received: number }[] = [];
  if (Array.isArray(body.items)) {
    const { data: receivedRows } = await supabase
      .from("purchase_order_items")
      .select("id, qty_received")
      .eq("purchase_order_id", id);
    existingItemRows = (receivedRows ?? []).map((r: any) => ({
      id: r.id,
      qty_received: Number(r.qty_received) || 0,
    }));
    const anyReceived = existingItemRows.some((r) => r.qty_received > 0);
    if (anyReceived && !overrideReceivingLock) {
      return NextResponse.json(
        { error: "Line items can't be changed after receiving has started." },
        { status: 422 },
      );
    }
  }

  const patch: Record<string, any> = {};
  if (body.supplier_id !== undefined) patch.supplier_id = body.supplier_id;
  if (body.status !== undefined) patch.status = body.status;
  if (body.tax_type !== undefined) patch.tax_type = body.tax_type;
  if (body.tax_value !== undefined) patch.tax_value = Number(body.tax_value) || 0;
  if (body.shipping_fee !== undefined) patch.shipping_fee = Math.max(0, Number(body.shipping_fee) || 0);
  if (body.discount_type !== undefined) patch.discount_type = body.discount_type;
  if (body.discount_value !== undefined) patch.discount_value = Math.max(0, Number(body.discount_value) || 0);
  if (body.order_date !== undefined) patch.order_date = body.order_date;
  if (body.expected_date !== undefined) patch.expected_date = body.expected_date;
  if (body.notes !== undefined) patch.notes = body.notes;

  // Replace items if supplied
  let nextSubtotal: number | null = null;
  if (Array.isArray(body.items)) {
    try {
      // Normalize + validate every incoming line (keeping any existing row id).
      const cleaned: Array<{
        id: string | null;
        product_id: string | null;
        description: string;
        sku_snapshot: string | null;
        qty: number;
        unit_price: number;
        line_total: number;
        price_type: "box" | "vial";
      }> = body.items.map((it: any) => {
        const qty = Number(it.qty);
        const unit = Number(it.unit_price);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error("Invalid item qty");
        if (!Number.isFinite(unit) || unit < 0) throw new Error("Invalid item unit_price");
        return {
          id: typeof it.id === "string" ? it.id : null,
          product_id: it.product_id ?? null,
          description: String(it.description ?? "").trim() || "Item",
          sku_snapshot: it.sku_snapshot ?? null,
          qty,
          unit_price: unit,
          line_total: Number((qty * unit).toFixed(2)),
          price_type: it.price_type === "vial" ? "vial" : "box",
        };
      });

      // Landed cost per line — allocate the order's shipping and discount
      // across these lines by value. Uses the *effective* shipping/discount
      // (whatever this PATCH ends up with, falling back to the stored values)
      // so the per-line cost basis stays in sync with the order totals.
      const subtotalNext = cleaned.reduce((s: number, i: any) => s + i.line_total, 0);
      const shippingFeeEff = patch.shipping_fee ?? Number(existing.shipping_fee ?? 0);
      const discountTypeEff = patch.discount_type ?? existing.discount_type ?? "fixed";
      const discountValueEff = patch.discount_value ?? Number(existing.discount_value ?? 0);
      const discountAmountEff = resolveDiscountAmount(
        discountTypeEff,
        discountValueEff,
        subtotalNext,
      );
      const landed = computeLandedCosts({
        lines: cleaned,
        shippingFee: shippingFeeEff,
        discountAmount: discountAmountEff,
      });

      // Persisted column shape for a line (the id is handled separately).
      const toRow = (c: (typeof cleaned)[number], l: (typeof landed)[number]) => ({
        product_id: c.product_id,
        description: c.description,
        sku_snapshot: c.sku_snapshot,
        qty: c.qty,
        unit_price: c.unit_price,
        line_total: c.line_total,
        price_type: c.price_type,
        landed_unit_cost: round4(l.landedUnitCost),
        landed_line_total: round2(l.landedLineTotal),
      });

      const receivedById = new Map(existingItemRows.map((r) => [r.id, r.qty_received]));
      const anyReceived = existingItemRows.some((r) => r.qty_received > 0);

      if (overrideReceivingLock && anyReceived) {
        // In-place reconciliation: update existing rows by id, insert new lines,
        // and delete only rows with no received quantity. Received lines keep
        // their id, so purchase_order_receipt_items stay attached (no cascade).
        const incomingIds = new Set(
          cleaned.map((c) => c.id).filter((v): v is string => typeof v === "string"),
        );

        // Guard: a line that already has receipts can't be dropped here.
        for (const row of existingItemRows) {
          if (row.qty_received > 0 && !incomingIds.has(row.id)) {
            throw new Error(
              "A line with received stock can't be removed. Reduce it in the receiving panel first.",
            );
          }
        }

        for (let li = 0; li < cleaned.length; li++) {
          const line = cleaned[li];
          const received = line.id ? receivedById.get(line.id) : undefined;
          if (line.id && received !== undefined) {
            // Existing row — update in place, preserving its id and qty_received.
            if (line.qty < received) {
              throw new Error(
                `A line's quantity (${line.qty}) can't be below what's already received (${received}).`,
              );
            }
            const { error: updErr } = await supabase
              .from("purchase_order_items")
              .update(toRow(line, landed[li]))
              .eq("id", line.id);
            if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
          } else {
            // New line (or an id we no longer recognize) — insert fresh.
            const { error: insErr } = await supabase
              .from("purchase_order_items")
              .insert({ purchase_order_id: id, ...toRow(line, landed[li]) });
            if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
          }
        }

        // Delete rows the admin removed (guaranteed qty_received === 0 above).
        const staleIds = existingItemRows.filter((r) => !incomingIds.has(r.id)).map((r) => r.id);
        if (staleIds.length > 0) {
          const { error: delErr } = await supabase
            .from("purchase_order_items")
            .delete()
            .in("id", staleIds);
          if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
        }
      } else {
        // No receipts at risk — the simplest correct path is a full replace.
        await supabase.from("purchase_order_items").delete().eq("purchase_order_id", id);
        const toInsert = cleaned.map((c, i) => ({ purchase_order_id: id, ...toRow(c, landed[i]) }));
        if (toInsert.length > 0) {
          const { error: insErr } = await supabase.from("purchase_order_items").insert(toInsert);
          if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
        }
      }

      nextSubtotal = subtotalNext;
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "Invalid items" }, { status: 400 });
    }
  }

  // Recompute totals when items, tax, shipping or discount change
  const needsRecalc =
    nextSubtotal !== null ||
    patch.tax_type !== undefined ||
    patch.tax_value !== undefined ||
    patch.shipping_fee !== undefined ||
    patch.discount_type !== undefined ||
    patch.discount_value !== undefined;
  if (needsRecalc) {
    // When items weren't resubmitted, we still need their qty/unit_price to
    // re-derive landed cost if shipping or discount changed on this PATCH.
    let existingLines: { id: string; qty: number; unit_price: number; line_total: number }[] = [];
    let subtotal = nextSubtotal;
    if (subtotal === null) {
      const { data: items } = await supabase
        .from("purchase_order_items")
        .select("id, qty, unit_price, line_total")
        .eq("purchase_order_id", id);
      existingLines = (items ?? []).map((i: any) => ({
        id: i.id,
        qty: Number(i.qty),
        unit_price: Number(i.unit_price),
        line_total: Number(i.line_total),
      }));
      subtotal = existingLines.reduce((s, i) => s + i.line_total, 0);
    }
    const taxType = patch.tax_type ?? existing.tax_type;
    const taxValue = patch.tax_value ?? Number(existing.tax_value);
    const shippingFee = patch.shipping_fee ?? Number(existing.shipping_fee ?? 0);
    const discountType = patch.discount_type ?? existing.discount_type ?? "fixed";
    const discountValue = patch.discount_value ?? Number(existing.discount_value ?? 0);
    // Discount can be a flat amount or a percentage of the product subtotal.
    const discountAmount =
      discountType === "percentage"
        ? Number((subtotal * (discountValue / 100)).toFixed(2))
        : Number(discountValue.toFixed(2));

    // Items weren't resubmitted (their landed cost wasn't rewritten above), but
    // shipping/discount may have moved — re-allocate over the existing lines so
    // each line's stored cost basis stays correct.
    if (nextSubtotal === null && existingLines.length > 0) {
      const landed = computeLandedCosts({ lines: existingLines, shippingFee, discountAmount });
      for (let li = 0; li < existingLines.length; li++) {
        const { error: landedErr } = await supabase
          .from("purchase_order_items")
          .update({
            landed_unit_cost: round4(landed[li].landedUnitCost),
            landed_line_total: round2(landed[li].landedLineTotal),
          })
          .eq("id", existingLines[li].id);
        if (landedErr) return NextResponse.json({ error: landedErr.message }, { status: 500 });
      }
    }

    // Order: subtotal -> shipping fee -> discount -> tax. Percentage tax is
    // applied to the running total (subtotal + shipping - discount).
    const taxableBase = subtotal + shippingFee - discountAmount;
    const taxTotal =
      taxType === "percentage"
        ? Number((taxableBase * (taxValue / 100)).toFixed(2))
        : Number(taxValue.toFixed(2));
    patch.subtotal = Number(subtotal.toFixed(2));
    patch.discount = Number(discountAmount.toFixed(2));
    patch.tax_total = taxTotal;
    patch.total = Number((subtotal + shippingFee - discountAmount + taxTotal).toFixed(2));
  }

  if (Object.keys(patch).length > 0) {
    const { error: upErr } = await supabase.from("purchase_orders").update(patch).eq("id", id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const { data: fresh } = await supabase
    .from("purchase_orders")
    .select(`*, supplier:suppliers (*), items:purchase_order_items (*)`)
    .eq("id", id)
    .single();

  await recordAudit({
    supabase,
    actorId: userId,
    action: "purchase_order.update",
    entityType: "purchase_order",
    entityId: id,
    payload: {
      fields: Object.keys(patch),
      ...(patch.status !== undefined
        ? { from_status: existing.status, to_status: patch.status }
        : {}),
    },
  });

  return NextResponse.json({ purchase_order: fresh });
}

// DELETE /api/admin/purchase-orders/:id
// Removes the purchase order along with its line items and receipt records
// (both cascade via foreign keys). Note this does not reverse any inventory
// that was already applied from receiving.
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { authorized, role, userId } = await verifyAdminRole(request, true);
  // Deleting is a stronger action than create/edit — restrict it to admins.
  if (!authorized || role !== "admin") {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }

  const { id } = await ctx.params;

  // Capture a little context before the PO (and its items/receipts) cascade away.
  const { data: existing } = await supabase
    .from("purchase_orders")
    .select("po_number, status, supplier_id, total")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordAudit({
    supabase,
    actorId: userId,
    action: "purchase_order.delete",
    entityType: "purchase_order",
    entityId: id,
    payload: {
      po_number: existing?.po_number ?? null,
      status: existing?.status ?? null,
      supplier_id: existing?.supplier_id ?? null,
      total: existing?.total ?? null,
    },
  });

  return NextResponse.json({ success: true });
}
