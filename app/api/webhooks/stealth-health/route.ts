import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import {
  verifyPuramassSignature,
  isPuramassWebhookConfigured,
  puramassChargedCents,
} from '@/lib/payments/puramass';
import {
  createStealthHealthFulfillmentInvoice,
  markPuramassInvoicePaid,
} from '@/lib/admin/invoices';
import { attachShipmentForPaidOrder } from '@/lib/payments/puramass-shipment';
import {
  logInvoicePaymentEvent,
  recordInvoicePaymentFromGateway,
} from '@/lib/payments/invoice-payment';

/**
 * POST /api/webhooks/stealth-health
 *
 * Receiver for PuraMass hosted-checkout webhooks (e.g.
 * `store_order.payment_complete`) delivered by the Stealth Health partner API.
 * Verifies the `X-Stealth-Signature` HMAC over the RAW body, then updates the
 * matching `puramass_orders` row's status/paid_at so the admin ledger reflects
 * live payment status.
 *
 * Register this URL with PuraMass: `<base>/api/webhooks/stealth-health`.
 *
 * Delivery is at-least-once: we dedupe on `event_id` and updates are idempotent.
 * We always ACK authentic events with 2xx (even unmatched/unknown) so PuraMass
 * doesn't retry them forever; only a signature failure (401), missing secret
 * (500), or a DB write failure (500) is a non-2xx that triggers their retry.
 */

// Ensure the Node.js runtime (Buffer/crypto + raw-body access).
export const runtime = 'nodejs';

type Db = ReturnType<typeof getSupabase>;

/**
 * Append a row to the raw webhook-event log. Best-effort: swallows its own
 * errors (incl. the table not existing pre-migration) so logging never affects
 * order processing or the webhook ACK.
 */
async function logWebhookEvent(
  db: Db,
  rawBody: string,
  signature: string | null,
  event: any,
  fields: {
    signature_valid: boolean;
    outcome: string;
    http_status: number;
    matched?: boolean | null;
    puramass_order_id?: string | null;
    error?: string | null;
  },
) {
  try {
    const data = event?.data ?? {};
    await db.from('puramass_webhook_events').insert({
      event_id: event?.event_id ?? null,
      event_type: event?.event_type ?? null,
      transaction_id: data.transaction_id ?? data.order_id ?? null,
      partner_reference: event?.partner_reference ?? null,
      status: typeof data.status === 'string' ? data.status : null,
      signature_valid: fields.signature_valid,
      matched: fields.matched ?? null,
      outcome: fields.outcome,
      http_status: fields.http_status,
      puramass_order_id: fields.puramass_order_id ?? null,
      payload: event && typeof event === 'object' ? event : null,
      // Truncate the raw body so a huge/garbage POST can't bloat a log row.
      raw_body: typeof rawBody === 'string' ? rawBody.slice(0, 20000) : null,
      signature: signature ?? null,
      error: fields.error ?? null,
    });
  } catch (err) {
    console.error('Failed to log PuraMass webhook event:', err);
  }
}

/**
 * The parcel contents for the Easyship shipment: name, quantity and unit price
 * per line. Prefers the webhook's paid items (the exact SKUs and amounts the
 * customer paid) and falls back to what was sent at hand-off. The price is the
 * declared value for customs, so a line without one contributes 0 rather than
 * blocking the shipment.
 */
function invoiceItemsFor(
  paidItems: Array<Record<string, any>> | undefined,
  ledgerItems: unknown,
): Array<{ name?: string; quantity?: number; unit_price?: number }> {
  const source =
    paidItems?.length ? paidItems : Array.isArray(ledgerItems) ? (ledgerItems as any[]) : [];
  return source.map((i) => ({
    name: typeof i?.name === 'string' ? i.name : (i?.sku ?? ''),
    quantity: Math.max(1, Math.round(Number(i?.quantity) || 1)),
    unit_price: Number.isFinite(Number(i?.unit_price_cents))
      ? Number(i.unit_price_cents) / 100
      : 0,
  }));
}

export async function POST(req: NextRequest) {
  const db = getSupabase();
  // Read the RAW bytes once — used for both signature verification and logging.
  const rawBody = await req.text();
  const signature = req.headers.get('x-stealth-signature');
  let event: any = null;
  try {
    event = JSON.parse(rawBody);
  } catch {
    /* leave event null; logged as invalid_json below */
  }

  if (!isPuramassWebhookConfigured()) {
    console.error('PuraMass webhook received but PURAMASS_WEBHOOK_SECRET is not set');
    await logWebhookEvent(db, rawBody, signature, event, {
      signature_valid: false,
      outcome: 'not_configured',
      http_status: 500,
    });
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  // Verify over the RAW bytes — never a re-serialized object.
  const signatureValid = verifyPuramassSignature(rawBody, signature);
  if (!signatureValid) {
    await logWebhookEvent(db, rawBody, signature, event, {
      signature_valid: false,
      outcome: 'invalid_signature',
      http_status: 401,
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  if (!event || typeof event !== 'object') {
    await logWebhookEvent(db, rawBody, signature, event, {
      signature_valid: true,
      outcome: 'invalid_json',
      http_status: 400,
    });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const data = event?.data ?? {};
  const eventId: string | null = event?.event_id ?? null;
  const transactionId: string | null = data.transaction_id ?? data.order_id ?? null;
  const partnerReference: string | null = event?.partner_reference ?? null;
  const status: string | null = typeof data.status === 'string' ? data.status : null;

  // Authentic but not actionable (no status or no correlation id) — ACK so it
  // isn't retried, but don't touch anything.
  if (!status || (!transactionId && !partnerReference)) {
    await logWebhookEvent(db, rawBody, signature, event, {
      signature_valid: true,
      outcome: 'ignored',
      http_status: 200,
    });
    return NextResponse.json({ received: true, ignored: true });
  }

  // Locate the hand-off by transaction_id first, then partner_reference.
  // `origin` distinguishes a storefront cart hand-off (a paid order becomes a
  // new fulfillment invoice) from an invoice payment-page hand-off (a paid
  // order records a payment on the invoice it was created for). Read it behind
  // a fallback so a database that hasn't run the payment-request migration
  // still matches its orders instead of reading as "unmatched".
  //
  // The shipping columns (address, courier, the shipment created on payment)
  // come from the signed-in customer checkout and sit behind their own
  // migration, so they are read in the widest column set and dropped first when
  // a database doesn't have them.
  const ROW_COLS_SHIPPING =
    'id, last_event_id, transaction_id, customer_id, customer_email, items, invoice_id, subtotal_cents, origin, currency, shipping_total_cents, shipping_address, shipping_courier_id, shipping_courier, easyship_shipment_id, order_id, fulfillment_type';
  const ROW_COLS =
    'id, last_event_id, transaction_id, customer_id, customer_email, items, invoice_id, subtotal_cents, origin';
  const ROW_COLS_LEGACY =
    'id, last_event_id, transaction_id, customer_id, customer_email, items, invoice_id, subtotal_cents';
  const findOrder = async (column: 'transaction_id' | 'partner_reference', value: string) => {
    for (const cols of [ROW_COLS_SHIPPING, ROW_COLS, ROW_COLS_LEGACY]) {
      const { data, error } = await db
        .from('puramass_orders')
        .select(cols)
        .eq(column, value)
        .maybeSingle();
      if (!error) return data;
    }
    return null;
  };
  let row: any = null;
  if (transactionId) row = await findOrder('transaction_id', transactionId);
  if (!row && partnerReference) row = await findOrder('partner_reference', partnerReference);

  if (!row) {
    // No local record (e.g. a hand-off created outside this app). ACK anyway.
    console.warn('PuraMass webhook: no matching order', { transactionId, partnerReference, eventId });
    await logWebhookEvent(db, rawBody, signature, event, {
      signature_valid: true,
      outcome: 'unmatched',
      http_status: 200,
      matched: false,
    });
    return NextResponse.json({ received: true, matched: false });
  }

  // Idempotency: same event already applied.
  if (eventId && row.last_event_id === eventId) {
    await logWebhookEvent(db, rawBody, signature, event, {
      signature_valid: true,
      outcome: 'duplicate',
      http_status: 200,
      matched: true,
      puramass_order_id: row.id,
    });
    return NextResponse.json({ received: true, duplicate: true });
  }

  const update: Record<string, unknown> = { status };
  if (eventId) update.last_event_id = eventId;
  if (typeof data.currency === 'string') update.currency = data.currency;
  if (transactionId) update.transaction_id = transactionId; // fill it if we matched by reference
  if (status === 'paid') {
    update.paid_at = data.occurred_at || event?.created_at || null;
  }

  const { error } = await db.from('puramass_orders').update(update).eq('id', row.id);
  if (error) {
    // Let PuraMass retry.
    console.error('PuraMass webhook: failed to update order', error);
    await logWebhookEvent(db, rawBody, signature, event, {
      signature_valid: true,
      outcome: 'error',
      http_status: 500,
      matched: true,
      puramass_order_id: row.id,
      error: error.message ?? String(error),
    });
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  // On payment there are two shapes of hand-off to settle. Both are
  // best-effort + idempotent — a failure here must not fail the webhook ACK
  // (PuraMass would retry forever).
  if (status === 'paid') {
    if (row.origin === 'invoice' && row.invoice_id) {
      // Paid from an invoice's payment page: record the money against that
      // invoice (which rolls its status forward and decrements stock) rather
      // than creating a second invoice for the same order.
      try {
        // Trust the amount the payload reports — for an invoice hand-off that
        // is the price we named on the order, shipping included, so prefer a
        // grand total over a bare subtotal. Falling back to the ledger's
        // subtotal keeps older/partial payloads working, and a payload naming
        // no amount at all settles the balance in full rather than reading as
        // free. recordInvoicePaymentFromGateway clamps to the balance due,
        // leaving any shortfall visible as a partially paid invoice.
        const cents = puramassChargedCents(data) ?? Number(row.subtotal_cents);
        const amount = Number.isFinite(cents) && cents > 0 ? cents / 100 : null;
        const result = await recordInvoicePaymentFromGateway(db, row.invoice_id, {
          amount,
          method: 'card',
          reference: (row.transaction_id ?? transactionId ?? row.id) as string,
          paidAt: data.occurred_at || event?.created_at || null,
        });
        await logInvoicePaymentEvent(db, row.invoice_id, 'paid', {
          method: 'card',
          detail: {
            transaction_id: row.transaction_id ?? transactionId,
            amount,
            recorded: result.recorded,
            reason: result.reason ?? null,
          },
        });
      } catch (err) {
        console.error('Invoice payment from Stealth Health failed:', err);
      }
    } else {
      // Storefront cart hand-off: create a fulfillment invoice so the items land
      // in the warehouse queue (marked as a Stealth Health order).
      try {
        const paidItems = Array.isArray(data.items) ? data.items : undefined;
        // When the customer chose their courier at our checkout, create the
        // Easyship shipment now that the order is really paid, and the order row
        // that carries it onto the invoice. Best-effort: a shipment failure is
        // recorded on the ledger and the invoice is still created.
        const attachment = await attachShipmentForPaidOrder(
          db,
          {
            id: row.id,
            customer_id: row.customer_id ?? null,
            customer_email: row.customer_email ?? null,
            shipping_address: row.shipping_address ?? null,
            shipping_courier_id: row.shipping_courier_id ?? null,
            shipping_courier: row.shipping_courier ?? null,
            easyship_shipment_id: row.easyship_shipment_id ?? null,
            order_id: row.order_id ?? null,
          },
          invoiceItemsFor(paidItems, row.items),
        );

        const ship = (row.shipping_address ?? {}) as Record<string, any>;
        const recipientName =
          [ship.firstName, ship.lastName].filter(Boolean).join(' ').trim() || null;

        if (row.invoice_id) {
          // The invoice already exists — raised in `pending_payment` when the
          // customer was handed off. Flip it to paid and link the order row
          // carrying the shipment, rather than creating a second invoice for
          // the same order.
          const result = await markPuramassInvoicePaid(db, row.invoice_id, {
            orderId: attachment.orderId,
            courier: attachment.courier,
          });
          if (!result.updated && result.reason) {
            console.warn(
              `Stealth Health invoice ${row.invoice_id} not marked paid: ${result.reason}`,
            );
          }
        } else {
          // No invoice yet: either the customer checkout is off (PuraMass priced
          // the order, so this webhook is the first thing that knows the
          // amounts) or the hand-off failed to raise one. Create it as paid.
          await createStealthHealthFulfillmentInvoice(
            db,
            {
              id: row.id,
              transaction_id: row.transaction_id ?? transactionId,
              customer_id: row.customer_id ?? null,
              customer_email: row.customer_email ?? null,
              items: row.items,
              invoice_id: null,
            },
            paidItems,
            {
              orderId: attachment.orderId,
              shippingCents: row.shipping_total_cents ?? null,
              currency: row.currency ?? data.currency ?? null,
              recipient: { name: recipientName, phone: ship.phone ?? null },
              courier: attachment.courier,
              status: 'paid',
              // A pickup hand-off carries no address and no courier; the
              // invoice has to say so, or the warehouse packs a parcel for an
              // order the customer is coming to collect.
              fulfillmentType: row.fulfillment_type === 'pickup' ? 'pickup' : 'shipment',
            },
          );
        }
      } catch (err) {
        console.error('Stealth Health fulfillment invoice failed:', err);
      }
    }
  }

  await logWebhookEvent(db, rawBody, signature, event, {
    signature_valid: true,
    outcome: 'processed',
    http_status: 200,
    matched: true,
    puramass_order_id: row.id,
  });
  return NextResponse.json({ received: true });
}
