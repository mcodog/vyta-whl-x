import { getSupabase } from '@/lib/supabase';
import { sendCustomerInvoiceSMTP } from '@/lib/email-smtp';
import { toPriceCurrency } from '@/lib/pricing';
import { findBitcoinWallet } from '@/lib/payments/receiving-wallets';

type Db = ReturnType<typeof getSupabase>;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The stored-order fields needed to (re)build the customer's checkout invoice
 * email. A subset of the `orders` row — the same values the order API has in
 * scope right after checkout, and the same it stores for a later send.
 */
export interface StoredOrderForEmail {
  id: string;
  order_number: string;
  email: string | null;
  items: unknown;
  total: number | string;
  discount_amount?: number | string | null;
  shipping_address: unknown;
  referral_code?: string | null;
  fulfillment_type?: string | null;
  notes?: string | null;
  /** Billing currency of the order (CAD default). */
  currency?: string | null;
  /**
   * The `orders.crypto` column, which doubles as the payment-method indicator:
   * 'email'/'etransfer' for Interac, 'btc' for a Bitcoin order. Anything else
   * (a legacy chain, an absent value) is emailed as e-Transfer, which is what
   * every order that predates the checkout's payment choice was.
   */
  crypto?: string | null;
}

/** Whether an order was placed to be paid in Bitcoin. */
export function isBitcoinOrder(order: Pick<StoredOrderForEmail, 'crypto'>): boolean {
  return String(order.crypto ?? '').toLowerCase() === 'btc';
}

/**
 * Reconstruct the `sendCustomerInvoiceSMTP` arguments from a stored order row.
 * Totals are recovered the same way the order API derived them at checkout:
 * subtotal = items after the affiliate discount, shipping = total − that
 * subtotal. Kept in one place so the instant send and the delayed cron send
 * produce byte-for-byte the same email.
 *
 * `btcAddress` is the configured receiving address, passed in by the caller
 * (this stays a pure function); it is only used for a Bitcoin order.
 */
export function buildCustomerInvoiceArgs(
  order: StoredOrderForEmail,
  btcAddress?: string | null,
) {
  const items = Array.isArray(order.items) ? (order.items as any[]) : [];
  const rawSubtotal = items.reduce(
    (sum, it) => sum + Number(it.price) * Number(it.quantity),
    0,
  );
  const discount = Number(order.discount_amount) || 0;
  const discountedSubtotal = round2(rawSubtotal - discount);
  const total = Number(order.total) || 0;
  const shippingCost = round2(total - discountedSubtotal);
  const isPickup =
    order.fulfillment_type === 'pickup' || order.notes === 'PICKUP';
  const sa =
    order.shipping_address && typeof order.shipping_address === 'object'
      ? (order.shipping_address as Record<string, unknown>)
      : {};
  const customerName =
    `${sa.firstName ?? ''} ${sa.lastName ?? ''}`.trim() ||
    (order.email ? order.email.split('@')[0] : 'Customer');

  return {
    to: order.email as string,
    customerName,
    orderNumber: order.order_number,
    items: items.map((it) => ({
      name: it.name,
      quantity: it.quantity,
      price: Number(it.price),
      strength: it.strength,
    })),
    subtotal: discountedSubtotal,
    shipping: shippingCost,
    total,
    shippingAddress: {
      address: String(sa.address ?? ''),
      city: String(sa.city ?? ''),
      state: String(sa.state ?? ''),
      postalCode: String(sa.postalCode ?? ''),
      country: String(sa.country ?? ''),
    },
    fulfillmentType: isPickup ? ('pickup' as const) : ('shipping' as const),
    paymentMethod: isBitcoinOrder(order) ? ('btc' as const) : ('etransfer' as const),
    btcAddress: isBitcoinOrder(order) ? (btcAddress ?? undefined) : undefined,
    referralCode: order.referral_code || undefined,
    currency: toPriceCurrency(order.currency),
  };
}

export type EtransferSendResult = 'sent' | 'skipped' | 'failed';

/**
 * The Bitcoin deposit address to print on a BTC order's invoice email, read
 * from the wallets configured in Settings → Crypto Payments.
 *
 * Best-effort: a pre-migration database (no column), no configured wallet, or a
 * read failure returns null, and the email then says the address will follow —
 * never a wrong or invented one.
 */
async function bitcoinDepositAddress(db: Db): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('site_settings')
      .select('crypto_wallets')
      .maybeSingle();
    if (error || !data) return null;
    return findBitcoinWallet(data.crypto_wallets)?.address ?? null;
  } catch {
    return null;
  }
}

/**
 * Send the customer's checkout invoice email for an order exactly once — the
 * Interac e-Transfer wording, or the Bitcoin deposit instructions when that is
 * how they chose to pay.
 *
 * Optimistically claims the send by stamping `etransfer_email_sent_at` only
 * where it is still NULL, so two overlapping runs (e.g. the instant path and
 * the cron flush) can never both send. If the email then fails, the claim is
 * released so a later run retries it.
 */
export async function claimAndSendEtransferEmail(
  db: Db,
  order: StoredOrderForEmail,
): Promise<EtransferSendResult> {
  if (!order.email) return 'skipped';

  // Read once, before the claim, so both send paths below print the same
  // address. Only a Bitcoin order needs it.
  const btcAddress = isBitcoinOrder(order) ? await bitcoinDepositAddress(db) : null;

  const { data: claimed, error: claimErr } = await db
    .from('orders')
    .update({ etransfer_email_sent_at: new Date().toISOString() })
    .eq('id', order.id)
    .is('etransfer_email_sent_at', null)
    .select('id');

  // Pre-migration database: the etransfer_email_sent_at column doesn't exist
  // yet (etransfer-email-automation-migration.sql hasn't been applied). Fall
  // back to sending without the once-only claim. There's no double-send risk
  // here because the cron flush relies on the same missing columns and can't
  // run, so the order API's instant path is the only sender.
  const claimColumnMissing =
    claimErr?.code === 'PGRST204' &&
    /etransfer_email_sent_at/.test(claimErr.message ?? '');
  if (claimColumnMissing) {
    console.warn(
      'e-transfer email: sent-marker column missing for order',
      order.id,
      '(run etransfer-email-automation-migration.sql); sending without idempotency claim.',
    );
    const result = await sendCustomerInvoiceSMTP(
      buildCustomerInvoiceArgs(order, btcAddress),
    );
    if (!result.success) {
      console.error(
        'checkout invoice email send failed for order',
        order.id,
        result.error,
      );
      return 'failed';
    }
    return 'sent';
  }

  if (claimErr) {
    console.error('e-transfer email claim failed for order', order.id, claimErr);
    return 'failed';
  }
  // No row claimed → another run already sent it.
  if (!claimed || claimed.length === 0) return 'skipped';

  const result = await sendCustomerInvoiceSMTP(
    buildCustomerInvoiceArgs(order, btcAddress),
  );
  if (!result.success) {
    // Release the claim so the cron retries on a later run.
    await db
      .from('orders')
      .update({ etransfer_email_sent_at: null })
      .eq('id', order.id);
    console.error(
      'checkout invoice email send failed for order',
      order.id,
      result.error,
    );
    return 'failed';
  }
  return 'sent';
}
