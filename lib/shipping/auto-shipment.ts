/**
 * Auto-shipment orchestration.
 *
 * Drives the optional automatic Easyship flow that runs as orders move through
 * checkout and payment:
 *   1. when an order is placed  → auto-create a draft shipment (no label)
 *   2. when its invoice is paid → auto-buy/confirm the shipping label
 *
 * Both steps are gated by toggles on the site_settings row and pick the
 * preferred courier (UPS / FedEx / cheapest). Everything here is STRICTLY
 * server-side and best-effort: every function swallows its own errors and
 * records them (per-order columns + the shipment_auto_logs feed) so a failure
 * never affects the customer-facing checkout. Callers should run these after
 * the response is sent (e.g. via next/server `after`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import {
  getEasyshipRates,
  createEasyshipShipment,
  buyEasyshipLabel,
  getEasyshipShipmentLabel,
  setEasyshipHandover,
  type HandoverMethod,
} from '@/lib/shipping/easyship';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type CourierPreference = 'cheapest' | 'ups' | 'fedex';

export interface AutoShipmentSettings {
  /** Auto-create a draft shipment when an order is placed. */
  autoCreate: boolean;
  /** Preferred courier for the auto-created shipment. */
  courierPreference: CourierPreference;
  /** Auto-buy the label once the order's invoice is marked paid. */
  autoBuyLabel: boolean;
}

const DEFAULT_SETTINGS: AutoShipmentSettings = {
  autoCreate: false,
  courierPreference: 'cheapest',
  autoBuyLabel: false,
};

/**
 * Read the auto-shipment toggles. Falls back to safe "off" defaults whenever
 * the columns/migration aren't present yet, so existing installs are unaffected
 * until the feature is turned on in Settings.
 */
export async function getAutoShipmentSettings(): Promise<AutoShipmentSettings> {
  try {
    const db = getSupabase();
    const { data, error } = await db
      .from('site_settings')
      .select(
        'easyship_auto_create_shipment, easyship_auto_courier_preference, easyship_auto_buy_label',
      )
      .single();
    if (error || !data) return DEFAULT_SETTINGS;
    const pref = data.easyship_auto_courier_preference;
    return {
      autoCreate: Boolean(data.easyship_auto_create_shipment),
      courierPreference: pref === 'ups' || pref === 'fedex' ? pref : 'cheapest',
      autoBuyLabel: Boolean(data.easyship_auto_buy_label),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Loose order shape accepted by the auto-shipment helpers. */
export interface AutoShipmentOrder {
  id: string;
  order_number: string;
  email?: string | null;
  shipping_address: any;
  items: any[];
  /** Already-created Easyship shipment id, if any. */
  easyship_shipment_id?: string | null;
  /**
   * The Easyship `courier_service` id the customer chose at checkout — the
   * service their shipping charge was quoted from. When set it wins over the
   * site-wide courier preference: they paid for this one.
   */
  courierId?: string | null;
  /** Local-pickup orders never ship — skip them. */
  isPickup?: boolean;
}

function isPickupOrder(order: AutoShipmentOrder): boolean {
  if (order.isPickup) return true;
  const ship = order.shipping_address || {};
  return ship?.fulfillmentType === 'pickup' || ship?.notes === 'PICKUP';
}

function hasPostalCode(order: AutoShipmentOrder): boolean {
  const ship = order.shipping_address || {};
  return Boolean(ship.postalCode || ship.postal_code);
}

/**
 * A destination Easyship can actually deliver to: street line, city, province,
 * and postal code all present. A postal code alone let labels be bought for
 * addresses missing the street line (→ misdelivery + wasted label spend).
 * Returns the list of missing parts so the shipment log can say what's wrong.
 */
function missingAddressParts(order: AutoShipmentOrder): string[] {
  const ship = order.shipping_address || {};
  const missing: string[] = [];
  if (!(ship.address || ship.line_1)) missing.push('street address');
  if (!ship.city) missing.push('city');
  if (!ship.state) missing.push('province');
  if (!(ship.postalCode || ship.postal_code)) missing.push('postal code');
  return missing;
}

/** Map an order's line items to the {quantity, declaredValue} rate shape. */
function toRateItems(items: any[]) {
  return (items || []).map((it: any) => ({
    quantity: Number(it.quantity) || 1,
    declaredValue: Number(it.price) * (Number(it.quantity) || 1) || 0,
  }));
}

/**
 * Resolve the Easyship courier_service id to lock the shipment to, honoring the
 * configured preference. `getEasyshipRates` already returns only UPS/FedEx
 * rates sorted cheapest-first. Returns `null` to let Easyship pick (no live
 * rates, or no match for the preference and no fallback available).
 */
async function resolvePreferredCourierId(
  order: AutoShipmentOrder,
  preference: CourierPreference,
): Promise<string | null> {
  const ship = order.shipping_address || {};
  const rates = await getEasyshipRates(
    {
      address: ship.address || ship.line_1,
      city: ship.city,
      state: ship.state,
      postalCode: ship.postalCode || ship.postal_code,
      country: ship.country || ship.country_alpha2,
    },
    toRateItems(order.items),
  );
  if (!rates.length) return null;
  if (preference === 'cheapest') return rates[0].courierId || null;
  const match = rates.find((r) => r.courier.toLowerCase().includes(preference));
  // Fall back to the cheapest allowed courier when the preferred one isn't
  // offered for this destination.
  return (match ?? rates[0]).courierId || null;
}

/**
 * Append one row to the dashboard feed without touching the order. Used for
 * things an admin needs to see that aren't an outright failure — chiefly a
 * shipment that had to be created with a courier other than the one the
 * customer paid for.
 */
async function logAttempt(
  db: SupabaseClient,
  order: AutoShipmentOrder,
  stage: 'shipment' | 'label',
  ok: boolean,
  opts: { error?: string | null; courier?: string | null } = {},
): Promise<void> {
  try {
    await db.from('shipment_auto_logs').insert({
      order_id: order.id,
      order_number: order.order_number,
      stage,
      ok,
      courier: opts.courier || null,
      error: ok ? null : opts.error || 'Unknown error',
    });
  } catch (e) {
    console.error('auto-shipment: failed to write log', order.id, e);
  }
}

/** Record the latest attempt on the order row + append to the dashboard feed. */
async function record(
  db: SupabaseClient,
  order: AutoShipmentOrder,
  stage: 'shipment' | 'label',
  ok: boolean,
  opts: { error?: string | null; courier?: string | null } = {},
): Promise<void> {
  const status = ok ? 'success' : 'failed';
  try {
    await db
      .from('orders')
      .update({
        auto_shipment_status: status,
        auto_shipment_stage: stage,
        auto_shipment_error: ok ? null : opts.error || 'Unknown error',
        auto_shipment_attempted_at: new Date().toISOString(),
      })
      .eq('id', order.id);
  } catch (e) {
    console.error('auto-shipment: failed to update order record', order.id, e);
  }
  try {
    await db.from('shipment_auto_logs').insert({
      order_id: order.id,
      order_number: order.order_number,
      stage,
      ok,
      courier: opts.courier || null,
      error: ok ? null : opts.error || 'Unknown error',
    });
  } catch (e) {
    console.error('auto-shipment: failed to write log', order.id, e);
  }
}

export interface AutoCreateResult {
  shipmentId: string | null;
  /** True when nothing was attempted (disabled, pickup, already exists). */
  skipped: boolean;
}

/**
 * Auto-create a draft Easyship shipment for a freshly placed order. No label is
 * purchased here. Best-effort; never throws.
 *
 * @param force bypass the `autoCreate` toggle (used when buying a label needs a
 *              shipment to exist first).
 */
export async function autoCreateShipmentForOrder(
  db: SupabaseClient,
  order: AutoShipmentOrder,
  { force = false }: { force?: boolean } = {},
): Promise<AutoCreateResult> {
  try {
    if (order.easyship_shipment_id) {
      return { shipmentId: order.easyship_shipment_id, skipped: true };
    }
    if (isPickupOrder(order)) return { shipmentId: null, skipped: true };

    const settings = await getAutoShipmentSettings();
    if (!settings.autoCreate && !force) return { shipmentId: null, skipped: true };

    const missing = missingAddressParts(order);
    if (missing.length > 0) {
      await record(db, order, 'shipment', false, {
        error: `Incomplete shipping address — missing ${missing.join(', ')}`,
      });
      return { shipmentId: null, skipped: false };
    }

    // The courier the customer chose at checkout is the one their shipping
    // charge was quoted from, so it wins over the site-wide preference. Only an
    // order with no recorded choice (an older order, or a flow that doesn't
    // offer the picker) falls back to UPS / FedEx / cheapest.
    const paidCourierId =
      typeof order.courierId === 'string' ? order.courierId.trim() : '';
    const courierId =
      paidCourierId || (await resolvePreferredCourierId(order, settings.courierPreference));

    const create = (id: string | null) =>
      createEasyshipShipment({
        order_number: order.order_number,
        email: order.email,
        shipping_address: order.shipping_address,
        items: Array.isArray(order.items) ? order.items : [],
        courierId: id,
      });

    let { shipment, error } = await create(courierId);

    // Shipments are created with `allow_fallback: false` so Easyship can never
    // quietly swap in a courier — and a cost — nobody agreed to. The flip side
    // is that a service which has stopped being offered for this destination
    // since the rate was quoted fails the whole creation. Rather than leave the
    // order with no shipment at all, re-resolve a courier and try once more,
    // then tell the dashboard the customer's choice was not honoured.
    let substitution: string | null = null;
    if (!shipment && paidCourierId) {
      const alternative = await resolvePreferredCourierId(
        order,
        settings.courierPreference,
      );
      if (alternative && alternative !== paidCourierId) {
        const retry = await create(alternative);
        if (retry.shipment) {
          shipment = retry.shipment;
          substitution = `Customer paid for a courier Easyship would not accept (${error || 'no longer offered'}); shipped with ${shipment.courier || 'an alternative courier'} instead. Check the shipping charged against the label cost.`;
          error = undefined;
        } else {
          error = retry.error || error;
        }
      }
    }

    if (!shipment) {
      await record(db, order, 'shipment', false, {
        error: error || 'Easyship did not return a shipment',
      });
      return { shipmentId: null, skipped: false };
    }

    await db
      .from('orders')
      .update({
        easyship_shipment_id: shipment.shipmentId,
        tracking_number: shipment.trackingNumber || null,
        tracking_url: shipment.trackingUrl || null,
        carrier: shipment.courier || null,
      })
      .eq('id', order.id);

    await record(db, order, 'shipment', true, { courier: shipment.courier });
    // Surfaced as a feed failure on purpose: the shipment exists, but the
    // customer is getting a service they didn't pay for and somebody should
    // look at the difference.
    if (substitution) {
      await logAttempt(db, order, 'shipment', false, {
        error: substitution,
        courier: shipment.courier,
      });
    }
    return { shipmentId: shipment.shipmentId, skipped: false };
  } catch (e: any) {
    console.error('auto-shipment: create failed for order', order.id, e);
    await record(db, order, 'shipment', false, {
      error: String(e?.message || e),
    });
    return { shipmentId: null, skipped: false };
  }
}

/**
 * Auto-buy/confirm the shipping label for an order whose invoice was just
 * marked paid. Creates the shipment first if one doesn't exist yet. Gated by
 * the `autoBuyLabel` toggle. Best-effort; never throws.
 */
export async function autoBuyLabelForOrder(
  db: SupabaseClient,
  order: AutoShipmentOrder,
): Promise<void> {
  try {
    const settings = await getAutoShipmentSettings();
    if (!settings.autoBuyLabel) return;
    if (isPickupOrder(order)) return;

    let shipmentId = order.easyship_shipment_id || null;
    if (!shipmentId) {
      // Buying a label requires a shipment — create one now (forced) even if the
      // auto-create toggle is off.
      const created = await autoCreateShipmentForOrder(db, order, { force: true });
      shipmentId = created.shipmentId;
      if (!shipmentId) return; // failure already recorded
    }

    const result = await buyEasyshipLabel(shipmentId);
    if (!result.ok) {
      await record(db, order, 'label', false, {
        error: result.error || 'Failed to buy label',
      });
      return;
    }

    // The PDF generates asynchronously — poll briefly for the document URL.
    let label = { ...result };
    for (let i = 0; i < 4 && !label.labelUrl; i++) {
      await sleep(1500);
      const info = await getEasyshipShipmentLabel(shipmentId);
      label = { ...label, ...info };
      if (info.labelState === 'failed') break;
    }

    const updates: Record<string, unknown> = {
      label_state: label.labelState || 'pending',
    };
    if (label.labelUrl) updates.label_url = label.labelUrl;
    if (label.trackingNumber) updates.tracking_number = label.trackingNumber;
    await db.from('orders').update(updates).eq('id', order.id);

    if (label.labelState === 'failed') {
      await record(db, order, 'label', false, { error: 'Label generation failed' });
    } else {
      await record(db, order, 'label', true);
    }
  } catch (e: any) {
    console.error('auto-shipment: buy-label failed for order', order.id, e);
    await record(db, order, 'label', false, { error: String(e?.message || e) });
  }
}

/**
 * Create an Easyship shipment for the order linked to a freshly created invoice.
 *
 * Unlike the `auto*` helpers above this is NOT gated by the site-wide toggles —
 * it runs because an admin explicitly opted in on the invoice form. It honors
 * the courier chosen there (falling back to the cheapest UPS/FedEx rate) and can
 * optionally buy/print the label in the same pass. Best-effort; never throws so
 * a shipping hiccup can't fail the invoice that was already created.
 */
export async function createShipmentForInvoiceOrder(
  db: SupabaseClient,
  orderId: string,
  opts: {
    courierId?: string | null;
    buyLabel?: boolean;
    /** Insure the parcel for its declared value. */
    insured?: boolean;
    /** Courier picks up vs we drop off. Applied best-effort after creation. */
    handover?: HandoverMethod | null;
  } = {},
): Promise<void> {
  try {
    const { data: order } = await db
      .from('orders')
      .select(
        'id, order_number, email, items, shipping_address, easyship_shipment_id, notes, fulfillment_type',
      )
      .eq('id', orderId)
      .single();
    if (!order) return;

    const auto: AutoShipmentOrder = {
      id: order.id,
      order_number: order.order_number,
      email: order.email,
      shipping_address: order.shipping_address,
      items: Array.isArray(order.items) ? order.items : [],
      easyship_shipment_id: order.easyship_shipment_id,
      isPickup: order.notes === 'PICKUP' || order.fulfillment_type === 'pickup',
    };
    if (isPickupOrder(auto)) return;

    let shipmentId = auto.easyship_shipment_id || null;
    if (!shipmentId) {
      const missing = missingAddressParts(auto);
      if (missing.length > 0) {
        await record(db, auto, 'shipment', false, {
          error: `Incomplete shipping address — missing ${missing.join(', ')}`,
        });
        return;
      }
      // Lock to the courier the admin picked on the form; otherwise pick the
      // cheapest allowed (UPS/FedEx) rate for the destination.
      const courierId = opts.courierId || (await resolvePreferredCourierId(auto, 'cheapest'));
      const { shipment, error } = await createEasyshipShipment({
        order_number: auto.order_number,
        email: auto.email,
        shipping_address: auto.shipping_address,
        items: auto.items,
        courierId,
        insured: opts.insured,
      });
      if (!shipment) {
        await record(db, auto, 'shipment', false, {
          error: error || 'Easyship did not return a shipment',
        });
        return;
      }
      await db
        .from('orders')
        .update({
          easyship_shipment_id: shipment.shipmentId,
          tracking_number: shipment.trackingNumber || null,
          tracking_url: shipment.trackingUrl || null,
          carrier: shipment.courier || null,
        })
        .eq('id', auto.id);
      await record(db, auto, 'shipment', true, { courier: shipment.courier });
      shipmentId = shipment.shipmentId;
    }

    // Apply the courier handover choice (pickup vs drop-off) once the shipment
    // exists. Best-effort — a handover hiccup never undoes the shipment/label.
    if (opts.handover && shipmentId) {
      const h = await setEasyshipHandover(shipmentId, opts.handover);
      if (!h.ok) console.error('handover set failed for order', auto.id, h.error);
    }

    if (!opts.buyLabel || !shipmentId) return;

    const result = await buyEasyshipLabel(shipmentId);
    if (!result.ok) {
      await record(db, auto, 'label', false, {
        error: result.error || 'Failed to buy label',
      });
      return;
    }
    // The PDF generates asynchronously — poll briefly for the document URL.
    let label = { ...result };
    for (let i = 0; i < 4 && !label.labelUrl; i++) {
      await sleep(1500);
      const info = await getEasyshipShipmentLabel(shipmentId);
      label = { ...label, ...info };
      if (info.labelState === 'failed') break;
    }
    const updates: Record<string, unknown> = { label_state: label.labelState || 'pending' };
    if (label.labelUrl) updates.label_url = label.labelUrl;
    if (label.trackingNumber) updates.tracking_number = label.trackingNumber;
    await db.from('orders').update(updates).eq('id', auto.id);
    if (label.labelState === 'failed') {
      await record(db, auto, 'label', false, { error: 'Label generation failed' });
    } else {
      await record(db, auto, 'label', true);
    }
  } catch (e: any) {
    console.error('createShipmentForInvoiceOrder failed for order', orderId, e);
  }
}

/**
 * Hook for when an invoice becomes fully paid: resolve the linked order and
 * auto-buy its label (when enabled). Best-effort; never throws.
 */
export async function autoBuyLabelForPaidInvoice(
  db: SupabaseClient,
  invoiceId: string,
): Promise<void> {
  try {
    const settings = await getAutoShipmentSettings();
    if (!settings.autoBuyLabel) return;

    const { data: invoice } = await db
      .from('invoices')
      .select('order_id')
      .eq('id', invoiceId)
      .single();
    if (!invoice?.order_id) return;

    const { data: order } = await db
      .from('orders')
      .select(
        'id, order_number, email, items, shipping_address, easyship_shipment_id, notes, fulfillment_type',
      )
      .eq('id', invoice.order_id)
      .single();
    if (!order) return;

    await autoBuyLabelForOrder(db, {
      id: order.id,
      order_number: order.order_number,
      email: order.email,
      shipping_address: order.shipping_address,
      items: Array.isArray(order.items) ? order.items : [],
      easyship_shipment_id: order.easyship_shipment_id,
      isPickup: order.notes === 'PICKUP' || order.fulfillment_type === 'pickup',
    });
  } catch (e) {
    console.error('auto-shipment: paid-invoice hook failed', invoiceId, e);
  }
}
