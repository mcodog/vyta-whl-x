import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { canDelete } from "@/lib/permissions";
import { logAuditServer } from "@/lib/admin/audit";
import { effectiveStatus } from "@/lib/admin/invoice-status";
import { affiliateCanAccessInvoice, affiliateCustomerIds, bindCustomerToSalesPersonAffiliate } from "@/lib/admin/invoice-access";
import { syncInvoiceBackorder, clearOpenInvoiceBackorder } from "@/lib/admin/backorder-sync";
import { enforceAffiliateLinePrices, clampDiscount } from "@/lib/admin/affiliate-pricing";
import { checkLowStockForProducts } from "@/lib/admin/low-stock";
import { autoBuyLabelForPaidInvoice, createShipmentForInvoiceOrder } from "@/lib/shipping/auto-shipment";
import { syncOrderFromInvoice } from "@/lib/admin/order-sync";
import {
  assignmentsFromBody,
  existingInvoiceAssignments,
  loadInvoiceRosters,
  primaryInvoiceColumns,
  resolveAssignments,
  syncInvoiceCommissions,
  writeInvoiceRoster,
} from "@/lib/admin/sales-attribution";

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
  return {
    role: (customer?.role || "customer") as "customer" | "affiliate" | "assistant" | "admin",
    userId: user.id,
  };
}

/**
 * This invoice's commission roster, primary first. Read separately rather than
 * embedded in the select above so a database that hasn't run the migration yet
 * still serves the invoice — it just falls back to the primary columns.
 */
async function rosterFor(invoiceId: string): Promise<any[]> {
  const rosters = await loadInvoiceRosters(supabase, [invoiceId], { full: true });
  return rosters.get(invoiceId) ?? [];
}

// True if the invoice belongs to the affiliate (their sales person or one of
// their bound customers).
async function affiliateOwnsInvoice(userId: string, invoice: any): Promise<boolean> {
  const { data: sp } = await supabase
    .from("sales_persons")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (sp?.id && invoice.sales_person_id === sp.id) return true;
  // Credited on the roster without being the primary.
  if (sp?.id && invoice.id) {
    const { data: seat } = await supabase
      .from("invoice_sales_persons")
      .select("id")
      .eq("invoice_id", invoice.id)
      .eq("sales_person_id", sp.id)
      .maybeSingle();
    if (seat) return true;
  }
  if (invoice.customer_id) {
    const { data: cust } = await supabase
      .from("customers")
      .select("affiliate_id")
      .eq("id", invoice.customer_id)
      .maybeSingle();
    if (cust?.affiliate_id === userId) return true;
  }
  return false;
}

// GET /api/admin/invoices/:id
// admin/assistant: any invoice. affiliate: only their own customers' invoices.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { role, userId } = await getAuth(request);
  if (role !== "admin" && role !== "assistant" && role !== "affiliate") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id } = await ctx.params;

  if (role === "affiliate" && !(await affiliateCanAccessInvoice(supabase, userId!, id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("invoices")
    .select(`
      *,
      customer:customers!customer_id (*),
      client:customer_clients!client_id (*),
      sales_person:sales_persons (*),
      order:orders!order_id (
        id, order_number, status, tracking_number, tracking_status, tracking_url,
        carrier, easyship_shipment_id, label_state, shipping_address, notes,
        fulfillment_type,
        order_items ( id, product_name, product_id, quantity, price_at_time, strength, price_type )
      ),
      line_items:invoice_line_items (*, product:products (sku, vials_per_box)),
      payments (*)
    `)
    .eq("id", id)
    .single();
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Affiliates may only view their own invoices.
  if (role === "affiliate" && (!userId || !(await affiliateOwnsInvoice(userId, data)))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const amount_paid = (data.payments ?? []).reduce(
    (s: number, p: any) => s + Number(p.amount),
    0,
  );
  const status_effective = effectiveStatus(data.status, data.due_date);

  // Resolve the Packing List sender (stored as a customers.id) to an email for
  // display — the column predates denormalised sender emails, so look it up.
  let packing_list_emailed_by_email: string | null = null;
  if (data.packing_list_emailed_by) {
    const { data: sender } = await supabase
      .from("customers")
      .select("email")
      .eq("id", data.packing_list_emailed_by)
      .maybeSingle();
    packing_list_emailed_by_email = sender?.email ?? null;
  }

  // The Stealth Health hand-offs created from this invoice's payment page, so
  // the Payment Request panel can show the payment link (for resending) and the
  // date it was created. Read behind a try/catch: a database that hasn't run the
  // payment-request migration has no `origin` column, and a missing panel must
  // never 404 the invoice itself.
  let payment_handoffs: unknown[] = [];
  try {
    const { data: handoffs } = await supabase
      .from("puramass_orders")
      .select(
        "id, transaction_id, payment_link, status, subtotal_cents, currency, paid_at, created_at",
      )
      .eq("invoice_id", id)
      .eq("origin", "invoice")
      .order("created_at", { ascending: false });
    payment_handoffs = handoffs ?? [];
  } catch {
    payment_handoffs = [];
  }

  // The customer-facing payment timeline (method chosen, checkout created,
  // crypto declared, paid). Best-effort for the same reason.
  let payment_events: unknown[] = [];
  try {
    const { data: events } = await supabase
      .from("invoice_payment_events")
      .select("id, event_type, method, detail, created_at")
      .eq("invoice_id", id)
      .order("created_at", { ascending: false })
      .limit(25);
    payment_events = events ?? [];
  } catch {
    payment_events = [];
  }

  return NextResponse.json({
    invoice: {
      ...data,
      sales_people: await rosterFor(id),
      amount_paid,
      amount_due: Math.max(0, Number(data.total) - amount_paid),
      status_effective,
      packing_list_emailed_by_email,
      payment_handoffs,
      payment_events,
    },
  });
}

// PATCH /api/admin/invoices/:id — admin, or affiliate over their own
// customers' invoices.
/**
 * Whether a write failed only because `invoices.charge_shipping_on_checkout`
 * doesn't exist yet — PostgREST reports an unknown column either from Postgres
 * (42703) or from its own schema cache (PGRST204).
 */
function isMissingCheckoutShippingColumn(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "42703" ||
    err.code === "PGRST204" ||
    /charge_shipping_on_checkout/i.test(err.message ?? "")
  );
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { role, userId } = await getAuth(request);
  if (role !== "admin" && role !== "affiliate") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id } = await ctx.params;

  if (role === "affiliate" && !(await affiliateCanAccessInvoice(supabase, userId!, id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { data: existing } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .single();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));

  // An affiliate may not reassign an invoice to a customer they don't own.
  if (role === "affiliate" && body.customer_id !== undefined && body.customer_id !== null) {
    const ids = await affiliateCustomerIds(supabase, userId!);
    if (!ids.includes(body.customer_id)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  }

  const patch: Record<string, any> = {};

  // sales_person_id is deliberately absent: attribution is written from the
  // resolved roster below, never copied straight through.
  for (const key of [
    "customer_id", "customer_name", "customer_email", "customer_phone",
    "issue_date", "due_date", "status", "fulfillment_type", "notes",
  ]) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  // Prepaid vs standard — normalise so only valid values reach the DB.
  if (body.invoice_type !== undefined) {
    patch.invoice_type = body.invoice_type === "prepaid" ? "prepaid" : "standard";
  }
  // Invoice markings: normalise so only valid values reach the DB.
  if (body.currency !== undefined) patch.currency = body.currency === "USD" ? "USD" : "CAD";
  if (body.with_labels !== undefined) patch.with_labels = body.with_labels !== false;
  // Whether this invoice's hosted-checkout payment link charges shipping. Off
  // unless explicitly ticked — the link otherwise sends `shipping_total_cents:
  // 0`, since shipping is usually settled outside it.
  if (body.charge_shipping_on_checkout !== undefined) {
    patch.charge_shipping_on_checkout = body.charge_shipping_on_checkout === true;
  }

  // Client shipment: create a new client (with address) if supplied, else use
  // the selected id. Requires a linked customer + shipment fulfillment.
  const nextCustomerId =
    body.customer_id !== undefined ? body.customer_id : existing.customer_id;
  const nextFulfillmentType =
    body.fulfillment_type !== undefined ? body.fulfillment_type : existing.fulfillment_type;
  if (body.ships_to_client !== undefined) {
    const shipsToClient =
      body.ships_to_client === true && nextFulfillmentType === "shipment" && !!nextCustomerId;
    if (shipsToClient) {
      let clientId: string | null = null;
      if (body.client && typeof body.client === "object" && String(body.client.address ?? "").trim()) {
        const { data: created, error: clientErr } = await supabase
          .from("customer_clients")
          .insert({
            customer_id: nextCustomerId,
            first_name: body.client.first_name ?? null,
            last_name: body.client.last_name ?? null,
            address: String(body.client.address).trim(),
            city: body.client.city ?? null,
            state: body.client.state ?? null,
            postal_code: body.client.postal_code ?? null,
            country: body.client.country ?? "CA",
            phone: body.client.phone ?? null,
            email: body.client.email ?? null,
          })
          .select("id")
          .single();
        if (clientErr || !created) {
          return NextResponse.json({ error: clientErr?.message ?? "Could not create client" }, { status: 500 });
        }
        clientId = created.id;
      } else if (typeof body.client_id === "string" && body.client_id) {
        clientId = body.client_id;
      } else {
        clientId = existing.client_id ?? null;
      }
      patch.ships_to_client = true;
      patch.client_id = clientId;
    } else {
      patch.ships_to_client = false;
      patch.client_id = null;
    }
  }

  // Replace line items if supplied
  let nextSubtotal: number | null = null;
  if (Array.isArray(body.line_items)) {
    try {
      const cleaned = body.line_items.map((li: any) => {
        const qty = Number(li.qty);
        const unit = Number(li.unit_price);
        // Clamp to 0–100% so a negative discount can't inflate the line total.
        const disc = clampDiscount(li.discount_pct);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error("Invalid line qty");
        if (!Number.isFinite(unit) || unit < 0) throw new Error("Invalid line unit_price");
        return {
          invoice_id: id,
          product_id: li.product_id ?? null,
          description: String(li.description ?? "").trim() || "Item",
          qty,
          unit_price: unit,
          discount_pct: disc,
          line_total: Number((qty * unit * (1 - disc / 100)).toFixed(2)),
          price_type: li.price_type === "vial" ? "vial" : "box",
          preferred_supplier_id: li.preferred_supplier_id ?? null,
        };
      });
      // Affiliates never set their own prices: re-derive every line from the
      // price list assigned to them and drop any discount, ignoring the
      // unit_price/discount_pct the client sent. The next currency/labels are the
      // patched values when supplied, else the invoice's current ones.
      const nextCurrency: "CAD" | "USD" =
        body.currency !== undefined
          ? body.currency === "USD" ? "USD" : "CAD"
          : existing.currency === "USD" ? "USD" : "CAD";
      const nextWithLabels =
        body.with_labels !== undefined ? body.with_labels !== false : existing.with_labels !== false;
      const priced =
        role === "affiliate" && userId
          ? await enforceAffiliateLinePrices(supabase, userId, nextCurrency, nextWithLabels, cleaned)
          : cleaned;
      await supabase.from("invoice_line_items").delete().eq("invoice_id", id);
      if (priced.length > 0) {
        const { error: liErr } = await supabase.from("invoice_line_items").insert(priced);
        if (liErr) return NextResponse.json({ error: liErr.message }, { status: 500 });
      }
      nextSubtotal = priced.reduce((s: number, i: any) => s + i.line_total, 0);

      // Recompute the invoice's open backorder from the new line items. Skip
      // backorder invoices: their backorder is created at split time against
      // quantities that intentionally exceed stock, so the stock-comparison
      // sync would wrongly clear it. When the admin overrides the shortfall,
      // clear any open backorder and don't create a new one.
      if (!existing.is_backorder) {
        if (body.override_backorder === true) {
          await clearOpenInvoiceBackorder(supabase, id).catch((e) =>
            console.error("backorder override (update) failed:", e),
          );
        } else {
          await syncInvoiceBackorder(
            supabase,
            id,
            priced.map((li: any) => ({ product_id: li.product_id, description: li.description, qty: li.qty, unit_price: li.unit_price })),
          ).catch((e) => console.error("backorder sync (update) failed:", e));
        }
      }
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "Invalid line items" }, { status: 400 });
    }
  }

  // Recompute totals when items, tax_rate, shipping, or the processing fee change
  const taxRate = body.tax_rate !== undefined ? Number(body.tax_rate) : Number(existing.tax_rate);
  const shipping = body.shipping_cost !== undefined ? Number(body.shipping_cost) : Number(existing.shipping_cost);
  const showProcessingFee =
    body.show_processing_fee !== undefined
      ? body.show_processing_fee !== false
      : existing.show_processing_fee !== false;
  const processingFee =
    body.processing_fee !== undefined
      ? Number(body.processing_fee) || 0
      : Number(existing.processing_fee) || 0;
  const needsRecalc =
    nextSubtotal !== null ||
    body.tax_rate !== undefined ||
    body.shipping_cost !== undefined ||
    body.processing_fee !== undefined ||
    body.show_processing_fee !== undefined;
  let total = Number(existing.total);
  if (needsRecalc) {
    let subtotal = nextSubtotal;
    if (subtotal === null) {
      const { data: items } = await supabase
        .from("invoice_line_items")
        .select("line_total")
        .eq("invoice_id", id);
      subtotal = (items ?? []).reduce((s, i: any) => s + Number(i.line_total), 0);
    }
    const taxTotal = Number((subtotal * (taxRate / 100)).toFixed(2));
    const effectiveFee = showProcessingFee ? processingFee : 0;
    total = Number((subtotal + taxTotal + shipping + effectiveFee).toFixed(2));
    patch.subtotal = Number(subtotal.toFixed(2));
    patch.tax_rate = taxRate;
    patch.tax_total = taxTotal;
    patch.shipping_cost = shipping;
    patch.processing_fee = processingFee;
    patch.show_processing_fee = showProcessingFee;
    patch.total = total;
  }

  // Re-sync attribution when the roster changes — or when the total moves, since
  // every commission is a percentage of it. Affiliates can't re-crew an invoice
  // or change their own rate, so their body's attribution is ignored entirely
  // and the stored roster is simply re-priced against the new total.
  const requestedTeam = role === "affiliate" ? null : assignmentsFromBody(body);
  // A body carrying only a rate (no roster, no sales person) means "re-rate the
  // primary" — the shape the single-person API accepted before rosters existed.
  const bareRateChange =
    role !== "affiliate" &&
    requestedTeam === null &&
    body.sales_person_commission_rate !== undefined;

  if (requestedTeam !== null || bareRateChange || needsRecalc) {
    // Only read the stored roster when the body didn't bring one.
    let team = requestedTeam ?? (await existingInvoiceAssignments(supabase, id, existing));
    if (bareRateChange && team.length > 0) {
      team = team.map((m, i) =>
        i === 0 ? { ...m, commission_rate: Number(body.sales_person_commission_rate) || 0 } : m,
      );
    }
    const resolvedTeam = resolveAssignments(team, total);

    // Legacy single-person columns follow the roster's primary.
    Object.assign(patch, primaryInvoiceColumns(resolvedTeam));

    await writeInvoiceRoster(supabase, id, resolvedTeam);
    // Wipe only PENDING commissions for this invoice — never touch paid ones.
    await syncInvoiceCommissions(supabase, id, resolvedTeam, total);

    // Tie the customer to the primary sales person's affiliate so they surface
    // on that affiliate's dashboard + customer list (independent of amounts).
    await bindCustomerToSalesPersonAffiliate(
      supabase,
      nextCustomerId,
      resolvedTeam[0]?.sales_person_id ?? null,
    );
  }

  // Fulfillment status (packed / shipped / dropped_off / picked_up) — settable
  // from the admin invoice list's Shipping column. Stamps who/when and (below)
  // syncs the linked order for terminal steps, mirroring the warehouse queue.
  const VALID_FULFILLMENT = ["pending", "packed", "shipped", "picked_up", "dropped_off"];
  const nextFulfillment: string | null =
    typeof body.fulfillment_status === "string" && VALID_FULFILLMENT.includes(body.fulfillment_status)
      ? body.fulfillment_status
      : null;
  if (nextFulfillment) {
    patch.fulfillment_status = nextFulfillment;
    const nowIso = new Date().toISOString();
    if (nextFulfillment === "packed" && !existing.packed_at) {
      patch.packed_at = nowIso;
      patch.packed_by = userId;
    }
    if (
      nextFulfillment === "shipped" ||
      nextFulfillment === "picked_up" ||
      nextFulfillment === "dropped_off"
    ) {
      patch.fulfilled_at = nowIso;
      patch.fulfilled_by = userId;
    }
  }

  if (Object.keys(patch).length > 0) {
    let { error: upErr } = await supabase.from("invoices").update(patch).eq("id", id);
    if (isMissingCheckoutShippingColumn(upErr)) {
      // `charge_shipping_on_checkout` comes from a later migration. A database
      // that hasn't run it must still accept the rest of the edit — dropping
      // the flag leaves the payment link at "shipping not charged", its default.
      const { charge_shipping_on_checkout: _flag, ...withoutFlag } = patch;
      ({ error: upErr } = await supabase.from("invoices").update(withoutFlag).eq("id", id));
    }
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Keep the linked order in sync — the invoice is the source of truth. Pushes
  // line items, total, contact, fulfillment method, mapped status, and (for a
  // client shipment) the client's ship-to address down to the order.
  await syncOrderFromInvoice(supabase, id);

  // Reflect a terminal fulfillment step on the linked order AFTER the sync above
  // (so it isn't reset). Shipped/dropped-off → shipped; picked up → delivered.
  if (
    nextFulfillment &&
    existing.order_id &&
    (nextFulfillment === "shipped" ||
      nextFulfillment === "picked_up" ||
      nextFulfillment === "dropped_off")
  ) {
    const orderStatus = nextFulfillment === "picked_up" ? "delivered" : "shipped";
    await supabase
      .from("orders")
      .update({ status: orderStatus })
      .eq("id", existing.order_id)
      .then(undefined, () => {});
  }

  // Optional Easyship opt-in from the edit form: create a shipment record for
  // the linked order once it's in sync. Runs after the response — best-effort,
  // fully server-side, and idempotent (skips when a shipment already exists), so
  // it mirrors the create flow and never blocks the save.
  if (
    body.create_easyship_shipment === true &&
    nextFulfillmentType === "shipment" &&
    existing.order_id
  ) {
    const courierId =
      typeof body.easyship_courier_id === "string" && body.easyship_courier_id.trim()
        ? body.easyship_courier_id.trim()
        : null;
    const buyLabel = body.easyship_buy_label === true;
    const insured = body.easyship_insured === true;
    const handover =
      body.easyship_handover === "pickup" || body.easyship_handover === "dropoff"
        ? body.easyship_handover
        : null;
    after(() =>
      createShipmentForInvoiceOrder(supabase, existing.order_id, {
        courierId,
        buyLabel,
        insured,
        handover,
      }),
    );
  }

  // Decrement product stock the first time an invoice is marked paid
  // (idempotent in the DB regardless of how the status is toggled).
  if (patch.status === "paid" && existing.status !== "paid") {
    const { error: stockErr } = await supabase.rpc("adjust_stock_for_invoice", { p_invoice_id: id });
    if (stockErr) console.error("Stock adjustment failed for invoice", id, stockErr);
    const { data: liRows } = await supabase
      .from("invoice_line_items")
      .select("product_id")
      .eq("invoice_id", id);
    const ids = (liRows ?? []).map((r: any) => r.product_id).filter(Boolean);
    await checkLowStockForProducts(supabase, ids).catch((e) => console.error("low-stock check failed:", e));

    // Auto-buy the Easyship label now that the invoice is paid (when enabled in
    // Settings). Runs after the response; best-effort and self-logging.
    after(() => autoBuyLabelForPaidInvoice(supabase, id));
  }

  // Restore product stock when an invoice is cancelled. The RPC is a no-op
  // unless this invoice previously took stock (stock_adjusted = true), so it's
  // safe regardless of the prior status; it also records an 'invoice_cancel'
  // row in each product's change history.
  if (patch.status === "cancelled" && existing.status !== "cancelled") {
    const { error: restoreErr } = await supabase.rpc("restore_stock_for_invoice", { p_invoice_id: id });
    if (restoreErr) console.error("Stock restore failed for cancelled invoice", id, restoreErr);
  }

  await logAuditServer(supabase, {
    actor_id: userId,
    action: "invoice.update",
    entity_type: "invoice",
    entity_id: id,
    payload: { changes: Object.keys(patch) },
  });

  const { data: fresh } = await supabase
    .from("invoices")
    .select(`
      *,
      customer:customers!customer_id (*),
      client:customer_clients!client_id (*),
      sales_person:sales_persons (*),
      order:orders!order_id (
        id, order_number, status, tracking_number, tracking_status, tracking_url,
        carrier, easyship_shipment_id, label_state, shipping_address, notes,
        fulfillment_type,
        order_items ( id, product_name, product_id, quantity, price_at_time, strength, price_type )
      ),
      line_items:invoice_line_items (*, product:products (sku, vials_per_box)),
      payments (*)
    `)
    .eq("id", id)
    .single();

  if (!fresh) return NextResponse.json({ invoice: null });
  const amount_paid = (fresh.payments ?? []).reduce(
    (s: number, p: any) => s + Number(p.amount),
    0,
  );
  return NextResponse.json({
    invoice: {
      ...fresh,
      sales_people: await rosterFor(id),
      amount_paid,
      amount_due: Math.max(0, Number(fresh.total) - amount_paid),
      status_effective: effectiveStatus(fresh.status, fresh.due_date),
    },
  });
}

// DELETE /api/admin/invoices/:id — admin only
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { role, userId } = await getAuth(request);
  if (!canDelete(role)) {
    return NextResponse.json({ error: "Unauthorized - Admin role required" }, { status: 403 });
  }
  const { id } = await ctx.params;

  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAuditServer(supabase, {
    actor_id: userId,
    action: "invoice.delete",
    entity_type: "invoice",
    entity_id: id,
  });
  return NextResponse.json({ ok: true });
}
