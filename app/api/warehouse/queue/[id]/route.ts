import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logAuditServer } from "@/lib/admin/audit";
import { sendPackingList } from "@/lib/admin/send-packing-list";
import { checkLowStockForProducts } from "@/lib/admin/low-stock";
import { verifyWarehouse, QUEUE_SELECT, mapQueueRow } from "../route";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const VALID_STATUSES = ["pending", "packed", "shipped", "picked_up", "dropped_off"] as const;
type FulfillmentStatus = (typeof VALID_STATUSES)[number];

// GET /api/warehouse/queue/:id — a single invoice's fulfillment record, shaped
// exactly like an item from the queue list. Lets the admin invoice page load
// only the fulfillment data it needs (photos, per-line progress, checklist)
// without pulling the whole queue. Warehouse staff and admins only.
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { authorized, role, canSendEmails } = await verifyWarehouse(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const { data, error } = await supabase
    .from("invoices")
    .select(QUEUE_SELECT)
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  return NextResponse.json({
    item: mapQueueRow(data),
    viewer: { role, can_send_emails: canSendEmails },
  });
}

// PATCH /api/warehouse/queue/:id — advance an invoice's fulfillment status.
// Warehouse staff and admins only.
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { authorized, userId } = await verifyWarehouse(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));

  const { data: invoice, error: loadErr } = await supabase
    .from("invoices")
    .select("id, status, order_id, fulfillment_type, fulfillment_status, packed_at, removed_from_queue, ships_to_client, client_id, packing_list_emailed_at, order:orders!order_id (label_state, tracking_number)")
    .eq("id", id)
    .single();
  if (loadErr || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // --- Remove from / restore to the queue ----------------------------------
  if (typeof body?.removed_from_queue === "boolean") {
    const removed = body.removed_from_queue;
    // Optional reason captured by the "Clear from queue" flow. Trimmed and
    // stored only when removing; restoring clears it so a later removal starts
    // clean.
    const note =
      removed && typeof body?.removed_note === "string" && body.removed_note.trim()
        ? body.removed_note.trim()
        : null;
    const { error: rmErr } = await supabase
      .from("invoices")
      .update({
        removed_from_queue: removed,
        removed_at: removed ? new Date().toISOString() : null,
        removed_by: removed ? userId : null,
        removed_note: note,
      })
      .eq("id", id);
    if (rmErr) return NextResponse.json({ error: rmErr.message }, { status: 500 });
    await logAuditServer(supabase, {
      actor_id: userId,
      action: removed ? "invoice.queue_remove" : "invoice.queue_restore",
      entity_type: "invoice",
      entity_id: id,
      payload: note ? { note } : null,
    });
    return NextResponse.json({ ok: true, removed_from_queue: removed });
  }

  // --- Promote a draft so it can be fulfilled ------------------------------
  // Warehouse staff can take a draft out of "draft" status (→ "sent") so it can
  // be packed/shipped, without leaving the queue.
  if (body?.undraft === true) {
    if (invoice.status !== "draft") {
      return NextResponse.json({ ok: true, status: invoice.status });
    }
    const { error: pdErr } = await supabase
      .from("invoices")
      .update({ status: "sent" })
      .eq("id", id);
    if (pdErr) return NextResponse.json({ error: pdErr.message }, { status: 500 });
    await logAuditServer(supabase, {
      actor_id: userId,
      action: "invoice.undraft",
      entity_type: "invoice",
      entity_id: id,
      payload: { from: "draft", to: "sent" },
    });
    return NextResponse.json({ ok: true, status: "sent" });
  }

  // --- Advance fulfillment status ------------------------------------------
  const next = body?.fulfillment_status as FulfillmentStatus | undefined;

  if (!next || !VALID_STATUSES.includes(next)) {
    return NextResponse.json({ error: "Invalid fulfillment_status" }, { status: 400 });
  }

  // Drafts must be marked ready first (send `{ undraft: true }`).
  if (invoice.status === "draft") {
    return NextResponse.json(
      { error: "Draft invoices must be marked ready before they can be fulfilled" },
      { status: 400 },
    );
  }

  // Keep the terminal step consistent with the fulfillment method. Shipped and
  // dropped-off (we handed the parcel to the courier) are both shipment states.
  if ((next === "shipped" || next === "dropped_off") && invoice.fulfillment_type !== "shipment") {
    return NextResponse.json(
      { error: "Only shipments can be marked shipped or dropped off" },
      { status: 400 },
    );
  }
  if (next === "picked_up" && invoice.fulfillment_type !== "pickup") {
    return NextResponse.json(
      { error: "Only pickups can be marked picked up" },
      { status: 400 },
    );
  }

  // Don't let a shipment be marked shipped/dropped-off until a courier label has
  // actually been generated. Without this, staff could flip an order to
  // "shipped" (which flags the linked order shipped and triggers the customer's
  // "your order shipped" email) when nothing was ever handed to a courier.
  // A manual/no-Easyship courier is still supported via an explicit, audited
  // override so ops can record why they shipped without a generated label.
  if (next === "shipped" || next === "dropped_off") {
    const order = Array.isArray((invoice as any).order)
      ? (invoice as any).order[0]
      : (invoice as any).order;
    const hasLabel = order?.label_state === "generated";
    const override = body?.override_no_label === true;
    if (!hasLabel && !override) {
      return NextResponse.json(
        {
          error:
            "No courier label has been generated for this order yet. Buy/generate the shipping label first, or resend with an explicit no-label override.",
          code: "label_not_generated",
          label_state: order?.label_state ?? null,
        },
        { status: 409 },
      );
    }
  }

  // Stamp who did what, when. Packing and the terminal step (shipped/picked up)
  // are attributed so the admin can see exactly when an order shipped and by
  // whom. Only set a stamp the first time a step is reached.
  const update: Record<string, any> = { fulfillment_status: next };
  const nowIso = new Date().toISOString();
  if (next === "packed" && !invoice.packed_at) {
    update.packed_at = nowIso;
    update.packed_by = userId;
  }
  if (next === "shipped" || next === "picked_up" || next === "dropped_off") {
    update.fulfilled_at = nowIso;
    update.fulfilled_by = userId;
  }

  const { error: upErr } = await supabase
    .from("invoices")
    .update(update)
    .eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Decrement product stock the first time an invoice is packed. The DB
  // function is idempotent via the `stock_adjusted` flag, so if the invoice was
  // already paid (payment routes call the same RPC) this is a no-op; if it was
  // packed before it was paid, this is where the stock comes off. Cancelling
  // the invoice runs restore_stock_for_invoice(), which gives the stock back,
  // so no separate undo is needed here.
  if (next === "packed" && !invoice.packed_at) {
    const { error: stockErr } = await supabase.rpc("adjust_stock_for_invoice", { p_invoice_id: id });
    if (stockErr) console.error("Stock adjustment failed for invoice", id, stockErr);
    const { data: liRows } = await supabase
      .from("invoice_line_items")
      .select("product_id")
      .eq("invoice_id", id);
    const productIds = (liRows ?? []).map((r: any) => r.product_id).filter(Boolean);
    await checkLowStockForProducts(supabase, productIds).catch((e) =>
      console.error("low-stock check failed:", e),
    );
  }

  // Reflect the terminal step on the linked order so the rest of the system
  // sees it as shipped/delivered. Best-effort — never fail the request on this.
  if (invoice.order_id && (next === "shipped" || next === "picked_up" || next === "dropped_off")) {
    const orderStatus = next === "picked_up" ? "delivered" : "shipped";
    await supabase
      .from("orders")
      .update({ status: orderStatus })
      .eq("id", invoice.order_id)
      .then(undefined, () => {});
  }

  // When a client shipment is marked shipped, automatically send the Packing
  // List to the client (once). The client only ever receives this document.
  // Runs after the response; best-effort and self-logging.
  if (
    (next === "shipped" || next === "dropped_off") &&
    invoice.ships_to_client &&
    invoice.client_id &&
    !invoice.packing_list_emailed_at
  ) {
    after(() =>
      sendPackingList(supabase, id, { userId, auto: true }).catch((e) =>
        console.error("auto packing-list send failed:", e),
      ),
    );
  }

  const shippedWithoutLabel =
    (next === "shipped" || next === "dropped_off") && body?.override_no_label === true;
  await logAuditServer(supabase, {
    actor_id: userId,
    action: "invoice.fulfillment_update",
    entity_type: "invoice",
    entity_id: id,
    payload: {
      from: invoice.fulfillment_status,
      to: next,
      ...(shippedWithoutLabel ? { no_label_override: true } : {}),
    },
  });

  return NextResponse.json({ ok: true, fulfillment_status: next });
}
