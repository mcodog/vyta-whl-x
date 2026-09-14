/**
 * The Easyship shipment behind a paid PuraMass hosted-checkout order.
 *
 * SERVER-ONLY. The customer chooses their courier at our checkout, but the
 * shipment is created only once PuraMass confirms payment — an abandoned
 * checkout would otherwise leave a draft shipment in Easyship for an order that
 * never happened. The address and courier chosen at hand-off are held on the
 * ledger row (`puramass_orders`) until then.
 *
 * The shipment is then carried onto the invoice the same way an in-house order
 * carries one: an `orders` row holds the address, the Easyship shipment id and
 * the tracking, and the fulfillment invoice points at it. That is what makes
 * the shipment show up on the invoice, in the warehouse queue, and in the
 * label/tracking tooling — all of which read an invoice's linked order.
 *
 * Everything here is best-effort and idempotent: a shipment failure is recorded
 * on the ledger row and never fails the webhook (PuraMass would retry the
 * payment event forever), and a retried event re-uses the shipment and order it
 * already created rather than making a second one.
 *
 * The customer's shipping charge was fixed at hand-off, from a rate Easyship
 * quoted then — but they may pay minutes or days later, and the service they
 * chose can stop being offered for their address in between. Because shipments
 * are locked to their courier (`allow_fallback: false`, so Easyship can never
 * substitute a cost nobody agreed to), that would otherwise leave a *paid*
 * order with no shipment at all. So a locked-courier failure is retried once
 * against a freshly quoted alternative, and the substitution is logged for the
 * admin dashboard — the customer is then getting a service they didn't pay for,
 * which is somebody's call to make, not something to swallow.
 */

import {
  createEasyshipShipment,
  getEasyshipRates,
  PURAMASS_CHECKOUT_COURIERS,
} from '@/lib/shipping/easyship';

type Db = { from: (table: string) => any };

/** The ledger row's shipping fields, as stored at hand-off. */
export interface LedgerShipping {
  shipping_address?: Record<string, any> | null;
  shipping_courier_id?: string | null;
  shipping_courier?: string | null;
  easyship_shipment_id?: string | null;
  order_id?: string | null;
  shipping_total_cents?: number | null;
}

export interface ShipmentAttachment {
  /** The order row carrying the shipment; the invoice links to it. */
  orderId: string | null;
  easyshipShipmentId: string | null;
  trackingNumber: string | null;
  courier: string | null;
  /** Why no shipment exists, when one was expected. */
  error: string | null;
}

/** An 8-character order number in the store's existing `AMC-XXXXXXXX` form. */
function generateOrderNumber(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `AMC-${code}`;
}

/**
 * Create the Easyship shipment for a paid order and the order row that carries
 * it, so the fulfillment invoice can be linked to both.
 *
 * Returns what to attach to the invoice. A null `orderId` means no order row
 * could be created; the invoice is still created (unlinked) rather than lost.
 */
export async function attachShipmentForPaidOrder(
  db: Db,
  ledger: LedgerShipping & { id: string; customer_id: string | null; customer_email: string | null },
  items: Array<{ name?: string; quantity?: number; unit_price?: number }>,
): Promise<ShipmentAttachment> {
  const address = ledger.shipping_address ?? null;

  // Already handled by an earlier delivery of the same payment event.
  if (ledger.order_id) {
    return {
      orderId: ledger.order_id,
      easyshipShipmentId: ledger.easyship_shipment_id ?? null,
      trackingNumber: null,
      courier: ledger.shipping_courier ?? null,
      error: null,
    };
  }

  // No address means this hand-off let PuraMass collect it on its own page —
  // there is nothing to ship from here, and that is not an error.
  if (!address || !(address.address || address.line_1)) {
    return {
      orderId: null,
      easyshipShipmentId: null,
      trackingNumber: null,
      courier: null,
      error: null,
    };
  }

  const orderNumber = generateOrderNumber();
  let shipmentId: string | null = null;
  let trackingNumber: string | null = null;
  let trackingUrl: string | null = null;
  let courier: string | null = ledger.shipping_courier ?? null;
  let error: string | null = null;

  const parcelItems = items.map((i) => ({
    quantity: Number(i.quantity) || 1,
    price: Number(i.unit_price) || 0,
  }));
  const paidCourierId = ledger.shipping_courier_id?.trim() || null;
  const create = (courierId: string | null) =>
    createEasyshipShipment({
      order_number: orderNumber,
      email: ledger.customer_email,
      shipping_address: address,
      items: parcelItems,
      // Lock the shipment to the courier the customer paid for. Without this
      // Easyship would pick per the account's own defaults, which could be a
      // courier — and a cost — the customer never agreed to.
      courierId,
    });

  /** Set when the paid courier could not be used and another was substituted. */
  let substitution: string | null = null;

  try {
    let result = await create(paidCourierId);

    // The paid service is no longer accepted for this address. Try once more
    // with whatever Easyship will quote now rather than leaving a paid order
    // unshipped — see the file header.
    if (!result.shipment && paidCourierId) {
      const alternative = await alternativeCourierId(address, parcelItems, paidCourierId);
      if (alternative) {
        const firstError = result.error ?? 'Easyship returned no shipment';
        const retry = await create(alternative.courierId);
        if (retry.shipment) {
          substitution = `The courier the customer paid for could not be used (${firstError}); shipped with ${retry.shipment.courier || alternative.courier} instead. Check the shipping charged against the label cost.`;
          result = retry;
        }
      }
    }

    if (result.shipment) {
      shipmentId = result.shipment.shipmentId;
      trackingNumber = result.shipment.trackingNumber ?? null;
      trackingUrl = result.shipment.trackingUrl ?? null;
      courier = result.shipment.courier ?? courier;
    } else {
      error = result.error ?? 'Easyship returned no shipment';
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  if (error) {
    console.error('PuraMass paid-order shipment failed:', error);
  }

  // The order row: the address and shipment live here, which is where every
  // existing invoice/warehouse/label screen looks for them.
  const orderId = await createOrderRow(db, {
    orderNumber,
    customerId: ledger.customer_id,
    email: ledger.customer_email,
    address,
    items,
    shipmentId,
    trackingNumber,
    trackingUrl,
    courier,
  });

  // Put anything that needs a human onto the dashboard's auto-shipment feed —
  // a paid order with no shipment, or one shipped with a courier the customer
  // did not pay for. Writing it only to the ledger left it invisible: nothing
  // reads `puramass_orders.shipment_error`.
  if (error || substitution) {
    try {
      await db.from('shipment_auto_logs').insert({
        order_id: orderId,
        order_number: orderNumber,
        stage: 'shipment',
        ok: false,
        courier,
        error: error ?? substitution,
      });
    } catch (err) {
      console.error('Failed to log the PuraMass shipment outcome:', err);
    }
  }

  // Record the outcome on the ledger so a retry doesn't ship twice and an admin
  // can see why a label is missing.
  try {
    await db
      .from('puramass_orders')
      .update({
        order_id: orderId,
        easyship_shipment_id: shipmentId,
        tracking_number: trackingNumber,
        tracking_url: trackingUrl,
        shipping_courier: courier,
        // A substitution isn't a failure, but it is why the courier on the
        // order no longer matches what the customer picked — say so here too.
        shipment_error: error ?? substitution,
      })
      .eq('id', ledger.id);
  } catch (err) {
    console.error('Failed to record PuraMass shipment on the ledger:', err);
  }

  return { orderId, easyshipShipmentId: shipmentId, trackingNumber, courier, error };
}

/**
 * The best courier still on offer for this destination, other than the one that
 * just failed. Scoped to the same UPS / FedEx / Canada Post set the checkout
 * quotes from, cheapest first, so a substitution can never land on a courier
 * the store doesn't ship with.
 */
async function alternativeCourierId(
  address: Record<string, any>,
  items: Array<{ quantity: number; price: number }>,
  failedCourierId: string,
): Promise<{ courierId: string; courier: string } | null> {
  try {
    const rates = await getEasyshipRates(
      {
        address: address.address || address.line_1,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode || address.postal_code,
        country: address.country || address.country_alpha2,
      },
      items.map((i) => ({
        quantity: i.quantity,
        declaredValue: i.price * i.quantity || 0,
      })),
      undefined,
      PURAMASS_CHECKOUT_COURIERS,
    );
    const next = rates.find((r) => r.courierId && r.courierId !== failedCourierId);
    return next ? { courierId: next.courierId, courier: next.courier } : null;
  } catch (err) {
    console.error('Could not re-quote a courier for a paid order:', err);
    return null;
  }
}

/**
 * Insert the order row for a paid hosted-checkout order. Retries on an order
 * number collision; returns null if it still can't be written (the invoice is
 * then created without a link rather than being dropped).
 */
async function createOrderRow(
  db: Db,
  input: {
    orderNumber: string;
    customerId: string | null;
    email: string | null;
    address: Record<string, any> | null;
    items: Array<{ name?: string; quantity?: number; unit_price?: number }>;
    shipmentId: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    courier: string | null;
  },
): Promise<string | null> {
  const orderItems = input.items.map((i) => ({
    name: i.name ?? '',
    quantity: Number(i.quantity) || 1,
    price: Number(i.unit_price) || 0,
  }));
  const total = orderItems.reduce((s, i) => s + i.price * i.quantity, 0);

  // Columns from optional migrations (tracking/label/source) are written in a
  // second pass so their absence can't lose the order row itself.
  const base: Record<string, unknown> = {
    customer_id: input.customerId,
    items: orderItems,
    total: Number(total.toFixed(2)),
    email: input.email,
    shipping_address: input.address,
    // `crypto` is NOT NULL on orders and predates non-crypto payment; the
    // in-house invoice flow stores "invoice" here, so a card-paid hosted order
    // stores "card".
    crypto: 'card',
    status: 'processing',
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    const orderNumber = attempt === 0 ? input.orderNumber : generateOrderNumber();
    const { data, error } = await db
      .from('orders')
      .insert({ ...base, order_number: orderNumber })
      .select('id')
      .single();
    if (error?.code === '23505') continue; // order number clash — try another
    if (error || !data) {
      console.error('PuraMass paid-order: could not create order row:', error);
      return null;
    }

    // Best-effort extras. Each is behind its own migration, so they're applied
    // separately and a missing column just means that field isn't shown.
    await tryUpdate(db, 'orders', data.id, {
      easyship_shipment_id: input.shipmentId,
      tracking_number: input.trackingNumber,
      tracking_url: input.trackingUrl,
      carrier: input.courier,
      label_state: input.shipmentId ? 'pending' : null,
      fulfillment_type: 'shipment',
      source: 'stealth_health',
    });
    await tryInsertOrderItems(db, data.id, orderItems);
    return data.id as string;
  }
  return null;
}

/** Apply an update, dropping fields the database doesn't have. Never throws. */
async function tryUpdate(
  db: Db,
  table: string,
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  try {
    const { error } = await db
      .from(table)
      .update(Object.fromEntries(entries))
      .eq('id', id);
    if (!error) return;
    // A column from an unrun migration fails the whole update — retry one field
    // at a time so the ones that do exist are still written.
    for (const [key, value] of entries) {
      try {
        await db.from(table).update({ [key]: value }).eq('id', id);
      } catch {
        /* skip this field */
      }
    }
  } catch {
    /* best-effort */
  }
}

/** Populate `order_items`, which the order detail page reads instead of the JSONB. */
async function tryInsertOrderItems(
  db: Db,
  orderId: string,
  items: Array<{ name: string; quantity: number; price: number }>,
): Promise<void> {
  if (!items.length) return;
  try {
    await db.from('order_items').insert(
      items.map((i) => ({
        order_id: orderId,
        product_name: i.name || 'Item',
        product_id: null,
        quantity: i.quantity,
        price_at_time: i.price,
        strength: null,
      })),
    );
  } catch (err) {
    console.error('PuraMass paid-order: order_items insert failed:', err);
  }
}
