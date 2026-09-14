import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import {
  loadInvoiceByPaymentToken,
  logInvoicePaymentEvent,
  readPaymentPageSettings,
  invoiceIsPayable,
  assessInvoiceSkuLock,
  SKU_LOCK_CUSTOMER_MESSAGE,
  type InvoicePaymentMethod,
} from '@/lib/payments/invoice-payment';

/**
 * POST /api/pay/:token/method  — body `{ method: 'crypto' | 'card' }`
 *
 * Record which way the customer chose to pay, so the admin invoices screens can
 * show it even before any money moves. Choosing is not paying: the crypto path
 * still needs the customer to send funds, and the card path still needs the
 * PuraMass checkout (POST …/checkout) to complete.
 *
 * Re-choosing is allowed — a customer who opens the card checkout and comes
 * back to pay in crypto instead just overwrites the selection.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`pay-method:${ip}`, RATE_LIMITS.general);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${rl.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  const { token } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const method = body?.method as InvoicePaymentMethod;
  if (method !== 'crypto' && method !== 'card') {
    return NextResponse.json({ error: 'Unknown payment method.' }, { status: 400 });
  }

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

  // Never record a method the store has switched off.
  const settings = await readPaymentPageSettings(db);
  if (method === 'crypto' && !settings.cryptoEnabled) {
    return NextResponse.json({ error: 'Crypto payment is unavailable.' }, { status: 409 });
  }
  if (method === 'card' && !settings.cardEnabled) {
    return NextResponse.json({ error: 'Card payment is unavailable.' }, { status: 409 });
  }

  const { error } = await db
    .from('invoices')
    .update({
      payment_method_selected: method,
      payment_method_selected_at: new Date().toISOString(),
    })
    .eq('id', invoice.id);
  if (error) {
    return NextResponse.json({ error: 'Could not save your choice.' }, { status: 500 });
  }

  await logInvoicePaymentEvent(db, invoice.id, 'method_selected', { method });

  return NextResponse.json({ ok: true, method });
}
