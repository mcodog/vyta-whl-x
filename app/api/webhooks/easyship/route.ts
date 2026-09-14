import { NextResponse, after } from 'next/server';
import crypto from 'crypto';
import { getSupabase } from '@/lib/supabase';
import { extractLabelInfo } from '@/lib/shipping/easyship';
import { sendShippingNotification } from '@/lib/email';

/**
 * Easyship webhook receiver for shipment tracking updates.
 *
 * Configure the endpoint URL `<base>/api/webhooks/easyship` in the Easyship
 * dashboard. Set `EASYSHIP_WEBHOOK_SECRET` to enable verification:
 *  - HMAC-SHA256 of the raw body in `x-easyship-hmac-sha256` (base64 or hex), or
 *  - the shared secret echoed in `x-easyship-webhook-secret`.
 * If no secret is configured, events are accepted (test mode) and logged.
 */

const WEBHOOK_SECRET = process.env.EASYSHIP_WEBHOOK_SECRET;

function verify(rawBody: string, req: Request): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn('Easyship webhook: EASYSHIP_WEBHOOK_SECRET not set — accepting unverified event');
    return true;
  }

  const sharedHeader = req.headers.get('x-easyship-webhook-secret');
  if (sharedHeader && timingSafeEqual(sharedHeader, WEBHOOK_SECRET)) return true;

  const hmacHeader = req.headers.get('x-easyship-hmac-sha256');
  if (hmacHeader) {
    const base64 = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody, 'utf8').digest('base64');
    const hex = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody, 'utf8').digest('hex');
    if (timingSafeEqual(hmacHeader, base64) || timingSafeEqual(hmacHeader, hex)) {
      return true;
    }
  }
  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Pull a field from the top level or common nested envelopes. */
function pick(payload: any, ...keys: string[]): any {
  const sources = [payload, payload?.data, payload?.shipment, payload?.data?.shipment];
  for (const src of sources) {
    if (!src) continue;
    for (const key of keys) {
      if (src[key] != null && src[key] !== '') return src[key];
    }
  }
  return undefined;
}

// Order status progression. Webhook-driven status changes only ever move
// forward along this flow, and never override a terminal/cancelled order.
const ORDER_FLOW = ['pending', 'received', 'confirmed', 'processing', 'shipped', 'delivered'];
const TERMINAL = new Set(['cancelled', 'expired']);

/**
 * Map an Easyship tracking state (and/or event type) to a target order status.
 * Returns 'shipped', 'delivered', or null when no status change applies.
 */
function mapToOrderStatus(state?: string, eventType?: string): 'shipped' | 'delivered' | null {
  const s = (state || '').toLowerCase();
  const e = (eventType || '').toLowerCase();

  // Delivered — but not "out for delivery" or a failed delivery attempt.
  if (s.includes('deliver') && !s.includes('out') && !s.includes('fail') && !s.includes('attempt')) {
    return 'delivered';
  }
  // Genuine in-transit states mean the parcel has actually shipped. A label
  // being *created* does NOT — the parcel is still on the packing bench — so
  // label events only update label_state/url (handled separately) and never
  // move the order to "shipped".
  const shippedHints = [
    'in_transit', 'in transit', 'out_for_delivery', 'out for delivery',
    'info_received', 'info received', 'picked_up', 'pickup', 'dispatched',
  ];
  if (shippedHints.some((h) => s.includes(h))) {
    return 'shipped';
  }
  return null;
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  if (!verify(rawBody, req)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const shipmentId = pick(payload, 'easyship_shipment_id', 'shipment_id');
  const orderNumber = pick(payload, 'platform_order_number', 'order_number');
  const trackingNumber = pick(payload, 'tracking_number');
  const trackingStatus = pick(payload, 'tracking_state', 'tracking_status', 'status');
  const trackingUrl = pick(payload, 'tracking_page_url', 'tracking_url');
  const courier = pick(payload, 'courier_service_name', 'courier_name');
  const eventType = pick(payload, 'event_type', 'type');

  if (!shipmentId && !orderNumber && !trackingNumber) {
    // Nothing to match on — acknowledge so Easyship doesn't retry forever.
    return NextResponse.json({ received: true, matched: false });
  }

  const db = getSupabase();

  // Match the order by shipment id, then platform order number, then tracking.
  let query = db
    .from('orders')
    .select('id, easyship_shipment_id, status, order_number, email, shipping_address, tracking_number');
  if (shipmentId) query = query.eq('easyship_shipment_id', shipmentId);
  else if (orderNumber) query = query.eq('order_number', orderNumber);
  else query = query.eq('tracking_number', trackingNumber);

  const { data: order } = await query.maybeSingle();

  if (!order) {
    return NextResponse.json({ received: true, matched: false });
  }

  const updates: Record<string, unknown> = {};
  if (shipmentId && !order.easyship_shipment_id) updates.easyship_shipment_id = shipmentId;
  if (trackingNumber) updates.tracking_number = trackingNumber;
  if (trackingStatus) updates.tracking_status = trackingStatus;
  if (trackingUrl) updates.tracking_url = trackingUrl;
  if (courier) updates.carrier = courier;

  // Capture label state / PDF url (e.g. from shipment.label.created events).
  const shipmentObj =
    payload?.shipment || payload?.data?.shipment || payload?.data || payload;
  const label = extractLabelInfo(shipmentObj);
  if (label.labelState) updates.label_state = label.labelState;
  if (label.labelUrl) updates.label_url = label.labelUrl;
  if (label.trackingNumber && !updates.tracking_number) {
    updates.tracking_number = label.trackingNumber;
  }

  // Advance the order status forward only — never regress, and never override a
  // cancelled/expired order.
  const target = mapToOrderStatus(trackingStatus, eventType);
  const current = String(order.status || '').toLowerCase();
  if (target && !TERMINAL.has(current)) {
    const currentIdx = ORDER_FLOW.indexOf(current);
    const targetIdx = ORDER_FLOW.indexOf(target);
    if (targetIdx > currentIdx) {
      updates.status = target;
    }
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await db.from('orders').update(updates).eq('id', order.id);
    if (error) {
      console.error('Easyship webhook: order update failed', error);
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
  }

  // Keep the invoice's fulfillment_status in step with the order. The warehouse
  // queue is driven off the invoice, so without this the queue would still show
  // a parcel as unshipped after Easyship reports it in transit. Only advance a
  // shipment invoice that isn't already at a terminal step; best-effort.
  if (updates.status === 'shipped' || updates.status === 'delivered') {
    const nowIso = new Date().toISOString();
    await db
      .from('invoices')
      .update({ fulfillment_status: 'shipped', fulfilled_at: nowIso })
      .eq('order_id', order.id)
      .eq('fulfillment_type', 'shipment')
      .in('fulfillment_status', ['pending', 'packed'])
      .neq('status', 'cancelled')
      .then(undefined, (e: unknown) => console.error('Easyship webhook: invoice sync failed', e));
  }

  // Proactively email the customer their tracking number the first time the
  // order transitions to "shipped". `updates.status` is only set on a genuine
  // forward transition (never on a repeat/label-only event), so this is
  // naturally idempotent without a separate sent flag. Best-effort — a mail
  // failure must never fail the webhook (Easyship would retry the whole event).
  const trackingForEmail =
    (typeof updates.tracking_number === 'string' && updates.tracking_number) ||
    order.tracking_number ||
    '';
  if (updates.status === 'shipped' && order.email && trackingForEmail) {
    const addr = (order.shipping_address as any) || {};
    const customerName =
      [addr.firstName, addr.lastName].filter(Boolean).join(' ') || 'there';
    after(async () => {
      try {
        await sendShippingNotification({
          to: order.email as string,
          customerName,
          orderNumber: (order.order_number as string) || '',
          trackingNumber: trackingForEmail,
        });
      } catch (e) {
        console.error('Easyship webhook: shipping notification failed', e);
      }
    });
  }

  return NextResponse.json({ received: true, matched: true });
}
