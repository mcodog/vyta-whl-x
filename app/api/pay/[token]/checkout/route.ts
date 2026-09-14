import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import { isPuramassPriceRejection, PuramassApiError } from '@/lib/payments/puramass';
import {
  createInvoiceCardHandOff,
  handOffMatchesInvoice,
  loadPendingInvoiceHandOff,
  supersedePendingInvoiceHandOffs,
} from '@/lib/payments/invoice-checkout';
import {
  checkoutShippingTotalCents,
  loadInvoiceByPaymentToken,
  logInvoicePaymentEvent,
  readPaymentPageSettings,
  resolveInvoicePuramassLines,
  invoiceIsPayable,
  assessInvoiceSkuLock,
  SKU_LOCK_CUSTOMER_MESSAGE,
} from '@/lib/payments/invoice-payment';

/**
 * POST /api/pay/:token/checkout
 *
 * Hand an invoice off to the PuraMass (Stealth Health) hosted checkout for the
 * Visa/Mastercard path, and return the `payment_link` to redirect to. The
 * hand-off is recorded in `puramass_orders` with `origin = 'invoice'` and
 * `invoice_id` set, which is how the webhook knows to record a payment against
 * this invoice rather than creating a new fulfillment invoice.
 *
 * An in-flight hand-off is reused: re-opening the payment page returns the same
 * link instead of creating a second PuraMass order for the same invoice — but
 * only while it still matches the invoice. If the invoice has been edited since
 * (an item, a quantity, a price, the shipping), the stale link would charge the
 * old amount, so a fresh hand-off is created and the old one is superseded.
 *
 * Pricing: the hand-off names its own amounts — each line's `unit_price_cents`
 * and the order's `shipping_total_cents` — so the hosted page charges what the
 * invoice says rather than PuraMass's catalog price. No shipping address is
 * sent; PuraMass collects it on its own page.
 *
 * Shipping is NOT charged here unless the invoice says to: an invoice carrying
 * `charge_shipping_on_checkout` wires its `shipping_cost` into
 * `shipping_total_cents`, and every other invoice sends `0` (which is also what
 * switches off PuraMass's own default rate). Shipping is usually settled
 * elsewhere, so adding it by default billed it twice.
 *
 * NOTE: the amount charged is therefore the lines, plus shipping only when it
 * was opted in. Tax and the processing fee are not expressible on the partner
 * order, so an invoice carrying either is charged less than its total; the
 * webhook records what actually landed (clamped to the balance due), leaving
 * the shortfall visible as a partially paid invoice for an admin to
 * reconcile.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`pay-checkout:${ip}`, RATE_LIMITS.orders);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${rl.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  const { token } = await ctx.params;
  const db = getSupabase();
  const invoice = await loadInvoiceByPaymentToken(db, token);
  if (!invoice) {
    return NextResponse.json({ error: 'This payment link is not valid.' }, { status: 404 });
  }
  if (!invoiceIsPayable(invoice)) {
    return NextResponse.json(
      { error: 'This invoice is no longer awaiting payment.' },
      { status: 409 },
    );
  }

  // Locked: a line on this invoice has no PuraMass SKU on the column it
  // needs (`puramass_sku` for a box line, `puramass_sku_vial` for a vial). Refuse the
  // action outright rather than let a half-catalogued order through.
  const { locked } = await assessInvoiceSkuLock(db, invoice.id);
  if (locked) {
    return NextResponse.json({ error: SKU_LOCK_CUSTOMER_MESSAGE }, { status: 423 });
  }

  const settings = await readPaymentPageSettings(db);
  if (!settings.cardEnabled) {
    return NextResponse.json(
      { error: 'Card payment is currently unavailable. Please pay by crypto or contact us.' },
      { status: 503 },
    );
  }

  const { lines, unmapped } = await resolveInvoicePuramassLines(db, invoice.id);
  if (!lines.length || unmapped.length) {
    return NextResponse.json(
      {
        error:
          'Some items on this invoice cannot be paid by card. Please pay by crypto or contact us.',
      },
      { status: 409 },
    );
  }
  // Shipping for the whole order — `0` unless this invoice ticked "charge
  // shipping on the payment link". `0` is a real value the API needs: it is how
  // a hand-off switches off PuraMass's default $35.00 rate.
  const shippingTotalCents = checkoutShippingTotalCents(invoice.raw);

  // Reuse an unpaid hand-off for this invoice rather than creating a second
  // PuraMass order every time the customer clicks through — unless the invoice
  // has changed under it, in which case the old link's amounts are wrong.
  const existing = await loadPendingInvoiceHandOff(db, invoice.id);
  if (existing?.payment_link && handOffMatchesInvoice(existing, lines, shippingTotalCents)) {
    await db
      .from('invoices')
      .update({
        payment_method_selected: 'card',
        payment_method_selected_at: new Date().toISOString(),
      })
      .eq('id', invoice.id);
    return NextResponse.json({
      payment_link: existing.payment_link,
      transaction_id: existing.transaction_id,
      reused: true,
    });
  }

  const email = invoice.customer_email?.trim();
  if (!email) {
    return NextResponse.json(
      { error: 'This invoice has no email on file. Please contact us to pay by card.' },
      { status: 409 },
    );
  }

  let handOff;
  try {
    handOff = await createInvoiceCardHandOff(db, {
      invoiceId: invoice.id,
      customerId: invoice.customer_id,
      customerEmail: email,
      customerName: invoice.customer_name,
      lines,
      shippingTotalCents,
    });
  } catch (err) {
    // A rejected price names the SKU and the wholesale floor under it — that is
    // our cost, not the customer's business. Keep it to the admin timeline and
    // send the customer to the other payment method.
    const priceRejected = isPuramassPriceRejection(err);
    const detail = err instanceof PuramassApiError ? err.message : String(err);
    const message = priceRejected
      ? 'Card payment is unavailable for this invoice. Please pay by crypto or contact us.'
      : err instanceof PuramassApiError
        ? err.message || 'The card checkout could not be started.'
        : 'The card checkout could not be started. Please try again.';
    console.error('Invoice PuraMass checkout error:', err);
    await logInvoicePaymentEvent(db, invoice.id, 'failed', {
      method: 'card',
      detail: {
        stage: 'checkout_create',
        error: detail,
        ...(priceRejected
          ? {
              code: (err as PuramassApiError).code ?? null,
              items: lines,
              shipping_total_cents: shippingTotalCents,
            }
          : {}),
      },
    });
    return NextResponse.json({ error: message }, { status: priceRejected ? 409 : 502 });
  }

  // The link we just minted is the one to hand out from here on, so retire the
  // stale one rather than leaving two hand-offs reading as in flight. Its
  // PuraMass order is untouched — if it is paid anyway the webhook still
  // settles this invoice.
  const superseded = await supersedePendingInvoiceHandOffs(db, invoice.id, {
    exceptId: handOff.ledgerId ?? undefined,
  });

  await db
    .from('invoices')
    .update({
      payment_method_selected: 'card',
      payment_method_selected_at: new Date().toISOString(),
    })
    .eq('id', invoice.id);

  await logInvoicePaymentEvent(db, invoice.id, 'checkout_created', {
    method: 'card',
    detail: {
      transaction_id: handOff.transactionId,
      payment_link: handOff.paymentLink,
      subtotal_cents: handOff.subtotalCents,
      shipping_total_cents: shippingTotalCents,
      items: lines,
      ...(superseded.length
        ? { superseded_transaction_ids: superseded.map((h) => h.transaction_id) }
        : {}),
    },
  });

  return NextResponse.json({
    payment_link: handOff.paymentLink,
    transaction_id: handOff.transactionId,
    reused: false,
  });
}
