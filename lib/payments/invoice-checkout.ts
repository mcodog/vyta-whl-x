/**
 * Invoice → Stealth Health (PuraMass) hosted-checkout hand-offs.
 *
 * SERVER-ONLY: every function here takes a service-role Supabase client and
 * talks to the credentialed PuraMass client.
 *
 * A hand-off is one row in `puramass_orders` with `origin = 'invoice'` and
 * `invoice_id` set — it ties the `payment_link` the customer was sent to back
 * to the invoice, which is how the webhook knows to record a payment against
 * that invoice rather than creating a fulfillment invoice.
 *
 * Two callers share this:
 *   - `POST /api/pay/:token/checkout` — the customer picking "card" on the
 *     payment page. Reuses an in-flight hand-off when it still matches.
 *   - `POST /api/admin/invoices/:id/checkout-link` — an admin minting a fresh
 *     link and superseding the pending one.
 */
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPuramassOrder, type PuramassOrderLine } from '@/lib/payments/puramass';

/**
 * The status a pending hand-off is parked at once a newer one replaces it.
 *
 * Deliberately not one of PuraMass's own statuses: their order is untouched
 * (the partner API has no cancel), so this says "we no longer hand this link
 * out", not "PuraMass killed it". A superseded link that gets paid anyway still
 * settles the invoice — the webhook matches on `transaction_id`, which this
 * does not change.
 */
export const SUPERSEDED_HANDOFF_STATUS = 'superseded';

/** The hand-off statuses that still count as in flight. */
export const PENDING_HANDOFF_STATUSES = ['payment_pending'] as const;

export interface PendingInvoiceHandOff {
  id: string;
  payment_link: string | null;
  transaction_id: string | null;
  status: string;
  created_at?: string | null;
  items: unknown;
  shipping_total_cents?: number | null;
}

const HANDOFF_COLS = 'id, payment_link, transaction_id, status, created_at, items';

/**
 * The newest unpaid hand-off for this invoice, or null.
 *
 * `shipping_total_cents` arrived with a later migration, so a database that
 * hasn't run it falls back to the columns that have always been there — losing
 * the shipping comparison, not the row.
 */
export async function loadPendingInvoiceHandOff(
  db: SupabaseClient,
  invoiceId: string,
): Promise<PendingInvoiceHandOff | null> {
  const run = (cols: string) =>
    db
      .from('puramass_orders')
      .select(cols)
      .eq('invoice_id', invoiceId)
      .eq('origin', 'invoice')
      .in('status', PENDING_HANDOFF_STATUSES as unknown as string[])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
  const first = await run(`${HANDOFF_COLS}, shipping_total_cents`);
  const row = first.error ? (await run(HANDOFF_COLS)).data : first.data;
  return (row ?? null) as unknown as PendingInvoiceHandOff | null;
}

/** The parts of a hand-off line that decide whether it is still current. */
interface HandOffLine {
  sku?: unknown;
  quantity?: unknown;
  unit_price_cents?: unknown;
}

/**
 * Whether a pending hand-off would still charge what this invoice now says.
 *
 * The link bakes in the amounts we sent, so an invoice edited since it was
 * minted — a line added, a quantity or price changed, different shipping —
 * needs a fresh hand-off rather than a link that charges the old total. A
 * hand-off recorded without a shipping amount (pre-migration, or minted before
 * we sent prices at all) can't be compared on shipping; its items still have to
 * match, and those carry the prices.
 */
export function handOffMatchesInvoice(
  row: Pick<PendingInvoiceHandOff, 'items' | 'shipping_total_cents'>,
  lines: PuramassOrderLine[],
  shippingTotalCents: number,
): boolean {
  const stored = Array.isArray(row.items) ? (row.items as HandOffLine[]) : null;
  if (!stored || stored.length !== lines.length) return false;
  const key = (i: HandOffLine) => `${i.sku}|${i.quantity}|${i.unit_price_cents ?? ''}`;
  const was = stored.map(key).sort();
  const now = lines.map(key).sort();
  if (was.some((v, i) => v !== now[i])) return false;
  // A null/absent shipping figure is "not recorded", not "free" — there is
  // nothing to compare, so the items alone decide.
  const shipping = row.shipping_total_cents;
  if (shipping === null || shipping === undefined) return true;
  return Number(shipping) === shippingTotalCents;
}

/**
 * Park every in-flight hand-off for this invoice at `superseded`, so the
 * payment page stops handing out its link and the admin panel stops showing it
 * as the live one. Returns the rows it changed.
 *
 * Best-effort by design: a database that hasn't run the payment-request
 * migration has no `origin` column, and failing to retire an old row must not
 * cost the admin the new link they just minted.
 */
export async function supersedePendingInvoiceHandOffs(
  db: SupabaseClient,
  invoiceId: string,
  opts: { exceptId?: string } = {},
): Promise<PendingInvoiceHandOff[]> {
  const run = (withOrigin: boolean) => {
    let q = db
      .from('puramass_orders')
      .update({ status: SUPERSEDED_HANDOFF_STATUS })
      .eq('invoice_id', invoiceId)
      .in('status', PENDING_HANDOFF_STATUSES as unknown as string[]);
    if (withOrigin) q = q.eq('origin', 'invoice');
    if (opts.exceptId) q = q.neq('id', opts.exceptId);
    return q.select(HANDOFF_COLS);
  };
  try {
    const first = await run(true);
    const { data, error } = first.error ? await run(false) : first;
    if (error) {
      console.error('Could not supersede invoice hand-offs:', error);
      return [];
    }
    return (data ?? []) as unknown as PendingInvoiceHandOff[];
  } catch (err) {
    console.error('Could not supersede invoice hand-offs:', err);
    return [];
  }
}

export interface CreateInvoiceHandOffInput {
  invoiceId: string;
  customerId: string | null;
  customerEmail: string;
  customerName: string | null;
  lines: PuramassOrderLine[];
  shippingTotalCents: number;
}

export interface CreatedInvoiceHandOff {
  partnerReference: string;
  transactionId: string;
  paymentLink: string;
  subtotalCents: number;
  /** The ledger row's id, or null when recording it failed (see `ledgerError`). */
  ledgerId: string | null;
  /** Why the ledger row could not be written, if it could not. */
  ledgerError: string | null;
}

/**
 * Create a PuraMass hosted-checkout order for an invoice and record the
 * hand-off.
 *
 * Throws whatever `createPuramassOrder` throws — the caller decides what to
 * tell a customer versus an admin. A failure to write the ledger row does NOT
 * throw: the link is already live and the customer must be able to use it. It
 * is reported instead, because without that row the webhook cannot tie the
 * payment back to the invoice.
 */
export async function createInvoiceCardHandOff(
  db: SupabaseClient,
  input: CreateInvoiceHandOffInput,
): Promise<CreatedInvoiceHandOff> {
  const [firstName, ...restName] = (input.customerName ?? '').split(' ').filter(Boolean);
  const partnerReference = `amcinv_${randomUUID()}`;

  const order = await createPuramassOrder({
    items: input.lines,
    customer: {
      email: input.customerEmail,
      ...(firstName ? { first_name: firstName } : {}),
      ...(restName.length ? { last_name: restName.join(' ') } : {}),
    },
    partnerReference,
    shippingTotalCents: input.shippingTotalCents,
  });

  const ledgerRow = {
    partner_reference: partnerReference,
    transaction_id: order.transaction_id,
    payment_link: order.payment_link,
    status: order.status,
    subtotal_cents: order.subtotal_cents,
    customer_id: input.customerId,
    customer_email: input.customerEmail,
    items: input.lines,
    invoice_id: input.invoiceId,
    origin: 'invoice',
  };
  let { data, error } = await db
    .from('puramass_orders')
    .insert({ ...ledgerRow, shipping_total_cents: input.shippingTotalCents })
    .select('id')
    .maybeSingle();
  if (error) {
    // `shipping_total_cents` comes from a later migration; a database that
    // hasn't run it must still get its ledger row, since that is what ties the
    // payment webhook back to this invoice.
    ({ data, error } = await db
      .from('puramass_orders')
      .insert(ledgerRow)
      .select('id')
      .maybeSingle());
  }
  if (error) {
    console.error('Failed to record invoice PuraMass hand-off:', error);
  }

  return {
    partnerReference,
    transactionId: order.transaction_id,
    paymentLink: order.payment_link,
    subtotalCents: order.subtotal_cents,
    ledgerId: (data?.id as string | undefined) ?? null,
    ledgerError: error ? (error.message ?? String(error)) : null,
  };
}
