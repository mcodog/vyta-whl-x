import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import {
  loadInvoiceByPaymentToken,
  logInvoicePaymentPageView,
  publicInvoiceView,
  readPaymentPageSettings,
  resolveInvoicePuramassLines,
  invoiceIsPayable,
  assessInvoiceSkuLock,
  SKU_LOCK_CUSTOMER_MESSAGE,
} from '@/lib/payments/invoice-payment';

/**
 * GET /api/pay/:token
 *
 * Everything the public payment page needs: a customer-safe view of the
 * invoice, which payment methods are actually available, and the receiving
 * crypto wallets. The token in the URL is the only credential — it is emailed
 * to the customer, who may be a guest with no account.
 *
 * Returns 404 for an unknown token (never "wrong token" vs "no such invoice",
 * so the endpoint can't be used to probe for valid links).
 *
 * A link whose invoice carries a product with no `puramass_sku_vial` comes back
 * `locked`: the page still shows the order, but every payment method is off and
 * the customer is told to contact us. The reason is never sent to the browser —
 * it is a catalog gap on our side, and the admin panel names it instead.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`pay-view:${ip}`, RATE_LIMITS.general);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${rl.retryAfter} seconds.` },
      { status: 429 },
    );
  }

  const { token } = await ctx.params;
  const db = getSupabase();
  const invoice = await loadInvoiceByPaymentToken(db, token);
  if (!invoice) {
    return NextResponse.json({ error: 'This payment link is not valid.' }, { status: 404 });
  }

  const settings = await readPaymentPageSettings(db);

  // The card option runs through the PuraMass hosted checkout, which needs
  // every line item mapped to a catalog SKU. An invoice with an unmappable line
  // hides the option rather than sending the customer to a checkout that would
  // be missing items.
  let cardAvailable = settings.cardEnabled;
  if (cardAvailable) {
    const { lines, unmapped } = await resolveInvoicePuramassLines(db, invoice.id);
    cardAvailable = lines.length > 0 && unmapped.length === 0;
  }

  // The hard lock. Unlike the card-only checks above it takes crypto down too,
  // because an invoice built on an uncatalogued product should not be collected
  // on at all until someone has looked at it.
  const { locked } = await assessInvoiceSkuLock(db, invoice.id);

  await logInvoicePaymentPageView(db, invoice.id);

  return NextResponse.json({
    invoice: publicInvoiceView(invoice),
    locked,
    locked_message: locked ? SKU_LOCK_CUSTOMER_MESSAGE : null,
    methods: {
      crypto: !locked && settings.cryptoEnabled && invoiceIsPayable(invoice),
      card: !locked && cardAvailable && invoiceIsPayable(invoice),
    },
    wallets: settings.cryptoEnabled ? settings.wallets : [],
    crypto_instructions: settings.instructions,
  });
}
