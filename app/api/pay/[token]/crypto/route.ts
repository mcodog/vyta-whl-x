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
} from '@/lib/payments/invoice-payment';

/**
 * POST /api/pay/:token/crypto — body `{ wallet_id, reference }`
 *
 * The customer tells us they've sent the crypto, and gives the transaction hash
 * / reference. This does NOT mark the invoice paid: an admin verifies the
 * transfer on-chain and records the payment. The declaration is stored so the
 * invoice screen can show "customer says they paid, here's the reference".
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`pay-crypto:${ip}`, RATE_LIMITS.orders);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${rl.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  const { token } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const reference = typeof body?.reference === 'string' ? body.reference.trim() : '';
  const walletId = typeof body?.wallet_id === 'string' ? body.wallet_id.trim() : '';
  if (!reference) {
    return NextResponse.json(
      { error: 'Enter the transaction hash or reference so we can find your payment.' },
      { status: 400 },
    );
  }
  if (reference.length > 200) {
    return NextResponse.json({ error: 'That reference is too long.' }, { status: 400 });
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

  // Only accept a wallet we actually offer, so the recorded "sent to" can't be
  // an address the customer made up.
  const settings = await readPaymentPageSettings(db);
  const wallet = settings.wallets.find((w) => w.id === walletId) ?? null;
  if (walletId && !wallet) {
    return NextResponse.json({ error: 'Unknown wallet.' }, { status: 400 });
  }

  const { error } = await db
    .from('invoices')
    .update({
      payment_method_selected: 'crypto',
      payment_method_selected_at:
        invoice.payment_method_selected === 'crypto'
          ? invoice.payment_method_selected_at
          : new Date().toISOString(),
      crypto_wallet_id: wallet?.id ?? null,
      crypto_payment_reference: reference,
      crypto_payment_declared_at: new Date().toISOString(),
    })
    .eq('id', invoice.id);
  if (error) {
    return NextResponse.json({ error: 'Could not save your reference.' }, { status: 500 });
  }

  await logInvoicePaymentEvent(db, invoice.id, 'crypto_declared', {
    method: 'crypto',
    detail: {
      reference,
      wallet_id: wallet?.id ?? null,
      wallet_label: wallet?.label ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}
