/**
 * Invoice payment requests — server-side helpers shared by the admin
 * payment-email endpoint, the public /api/pay/[token] routes and the PuraMass
 * webhook.
 *
 * SERVER-ONLY: every function here takes a service-role Supabase client and
 * reads/writes tables the browser has no access to.
 *
 * The flow this supports:
 *   admin sends the payment email  →  invoice gets a `payment_token`
 *   customer opens /pay/<token>    →  sees their order, picks a method
 *     crypto  → instructions page, they send funds and declare a reference
 *     card    → PuraMass hosted checkout, paid status arrives by webhook
 */
import { randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  activeReceivingWallets,
  type ReceivingWallet,
} from '@/lib/payments/receiving-wallets';
import { isPuramassConfigured } from '@/lib/payments/puramass';
import { puramassCheckoutEnabledByConfig } from '@/puramass.config';

export type InvoicePaymentMethod = 'crypto' | 'card';

export const PAYMENT_METHOD_LABELS: Record<InvoicePaymentMethod, string> = {
  crypto: 'Crypto',
  card: 'Visa / Mastercard',
};

/** The event types written to `invoice_payment_events`. */
export type InvoicePaymentEventType =
  | 'link_created'
  | 'email_sent'
  | 'page_viewed'
  | 'method_selected'
  | 'checkout_created'
  | 'crypto_declared'
  | 'paid'
  | 'failed';

/* -------------------------------------------------------------------------- */
/* Token                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Mint a payment-page token. 32 random bytes of URL-safe base64 — long enough
 * that the link is the only credential the page needs (it is emailed to the
 * customer, who has no account in the guest case).
 */
export function mintPaymentToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Return the invoice's payment token, minting and persisting one on first use.
 * Resends reuse the existing token so a link already in someone's inbox keeps
 * working.
 */
export async function ensureInvoicePaymentToken(
  db: SupabaseClient,
  invoice: { id: string; payment_token?: string | null },
): Promise<string> {
  const existing = invoice.payment_token?.trim();
  if (existing) return existing;
  const token = mintPaymentToken();
  const { error } = await db
    .from('invoices')
    .update({ payment_token: token, payment_token_created_at: new Date().toISOString() })
    .eq('id', invoice.id);
  if (error) throw new Error(`Could not create a payment link: ${error.message}`);
  return token;
}

/* -------------------------------------------------------------------------- */
/* Event log                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Append to the payment timeline. Best-effort by design — swallows its own
 * errors (including the table not existing pre-migration) so bookkeeping never
 * breaks a customer's payment or an admin's send.
 */
export async function logInvoicePaymentEvent(
  db: SupabaseClient,
  invoiceId: string,
  eventType: InvoicePaymentEventType,
  opts: { method?: string | null; detail?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await db.from('invoice_payment_events').insert({
      invoice_id: invoiceId,
      event_type: eventType,
      method: opts.method ?? null,
      detail: opts.detail ?? {},
    });
  } catch (err) {
    console.error('invoice payment event log failed:', err);
  }
}

/**
 * Record that the customer opened the payment page, but only once per visit
 * rather than once per request. The page and its crypto sub-page each fetch the
 * same endpoint, and a refresh re-fetches it — logging every hit would bury the
 * events that matter (method chosen, checkout created, paid) under a wall of
 * views. A repeat view within the window below is treated as the same visit.
 */
const PAGE_VIEW_DEDUPE_MS = 30 * 60 * 1000;

export async function logInvoicePaymentPageView(
  db: SupabaseClient,
  invoiceId: string,
): Promise<void> {
  try {
    const { data: recent } = await db
      .from('invoice_payment_events')
      .select('event_type, created_at')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      recent?.event_type === 'page_viewed' &&
      Date.now() - new Date(recent.created_at as string).getTime() < PAGE_VIEW_DEDUPE_MS
    ) {
      return;
    }
  } catch {
    // Fall through and log — a failed dedupe read is not a reason to lose the
    // event entirely.
  }
  await logInvoicePaymentEvent(db, invoiceId, 'page_viewed');
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export interface PaymentPageSettings {
  /** Crypto is offered when enabled AND at least one wallet is configured. */
  cryptoEnabled: boolean;
  /** Card is offered when enabled AND PuraMass is credentialed + not killed. */
  cardEnabled: boolean;
  wallets: ReceivingWallet[];
  instructions: string;
  /** Why card is unavailable, for the admin UI (never shown to customers). */
  cardUnavailableReason: string | null;
}

/**
 * Read the payment-page configuration from site_settings. Defensive: a
 * pre-migration database (no columns) reads as "crypto off, card as configured"
 * rather than throwing, so the page degrades instead of 500ing.
 */
export async function readPaymentPageSettings(
  db: SupabaseClient,
): Promise<PaymentPageSettings> {
  let row: Record<string, unknown> | null = null;
  const { data, error } = await db
    .from('site_settings')
    .select(
      'crypto_wallets, crypto_payment_instructions, payment_crypto_enabled, payment_card_enabled',
    )
    .single();
  if (!error) row = data as Record<string, unknown>;

  const wallets = activeReceivingWallets(row?.crypto_wallets);
  const cryptoToggle = row?.payment_crypto_enabled ?? false;
  const cardToggle = row?.payment_card_enabled ?? true;

  // Card payments run through the PuraMass hosted checkout, so they need the
  // same credentials + config switch the storefront hand-off does.
  let cardUnavailableReason: string | null = null;
  if (!cardToggle) cardUnavailableReason = 'Turned off in Settings → Payment Emails.';
  else if (!puramassCheckoutEnabledByConfig())
    cardUnavailableReason = 'Disabled by the config switch in puramass.config.ts.';
  else if (!isPuramassConfigured())
    cardUnavailableReason = 'No PuraMass API credentials on the server (PURAMASS_API_KEY).';

  return {
    cryptoEnabled: Boolean(cryptoToggle) && wallets.length > 0,
    cardEnabled: cardUnavailableReason === null,
    wallets,
    instructions:
      typeof row?.crypto_payment_instructions === 'string'
        ? (row.crypto_payment_instructions as string)
        : '',
    cardUnavailableReason,
  };
}

/* -------------------------------------------------------------------------- */
/* Invoice lookup + public projection                                         */
/* -------------------------------------------------------------------------- */

/** The columns the payment page and its actions need. */
const PAYABLE_INVOICE_SELECT = `
  id, invoice_number, status, currency, total, subtotal, tax_total, tax_rate,
  shipping_cost, processing_fee, show_processing_fee, issue_date, due_date,
  customer_id, customer_name, customer_email, non_payable,
  payment_token, payment_method_selected, payment_method_selected_at,
  crypto_wallet_id, crypto_payment_reference, crypto_payment_declared_at,
  line_items:invoice_line_items (id, description, qty, unit_price, line_total, price_type, product_id),
  payments (amount)
`;

/**
 * Columns from later migrations, asked for separately so a database that hasn't
 * run one still serves the invoice — losing the flag (which reads as its
 * default), not the row.
 */
const PAYABLE_INVOICE_OPTIONAL_COLS = 'charge_shipping_on_checkout';

export interface PayableInvoice {
  id: string;
  invoice_number: string;
  status: string;
  currency: string;
  total: number;
  amount_paid: number;
  amount_due: number;
  non_payable: boolean;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  payment_token: string | null;
  payment_method_selected: InvoicePaymentMethod | null;
  payment_method_selected_at: string | null;
  crypto_wallet_id: string | null;
  crypto_payment_reference: string | null;
  crypto_payment_declared_at: string | null;
  raw: Record<string, any>;
}

/** Load an invoice by its public payment token. Null when no invoice matches. */
export async function loadInvoiceByPaymentToken(
  db: SupabaseClient,
  token: string,
): Promise<PayableInvoice | null> {
  if (!token || token.length < 8 || token.length > 128) return null;
  const run = (cols: string) =>
    db.from('invoices').select(cols).eq('payment_token', token).maybeSingle();
  const first = await run(`${PAYABLE_INVOICE_SELECT}, ${PAYABLE_INVOICE_OPTIONAL_COLS}`);
  const row = first.error ? (await run(PAYABLE_INVOICE_SELECT)).data : first.data;
  if (!row) return null;
  return toPayableInvoice(row as unknown as Record<string, any>);
}

export function toPayableInvoice(row: Record<string, any>): PayableInvoice {
  const amountPaid = (row.payments ?? []).reduce(
    (s: number, p: { amount: number }) => s + Number(p.amount),
    0,
  );
  const total = Number(row.total) || 0;
  return {
    id: row.id,
    invoice_number: row.invoice_number,
    status: row.status,
    currency: row.currency === 'USD' ? 'USD' : 'CAD',
    total,
    amount_paid: Number(amountPaid.toFixed(2)),
    amount_due: Number(Math.max(0, total - amountPaid).toFixed(2)),
    non_payable: Boolean(row.non_payable),
    customer_id: row.customer_id ?? null,
    customer_name: row.customer_name ?? null,
    customer_email: row.customer_email ?? null,
    payment_token: row.payment_token ?? null,
    payment_method_selected: (row.payment_method_selected ?? null) as InvoicePaymentMethod | null,
    payment_method_selected_at: row.payment_method_selected_at ?? null,
    crypto_wallet_id: row.crypto_wallet_id ?? null,
    crypto_payment_reference: row.crypto_payment_reference ?? null,
    crypto_payment_declared_at: row.crypto_payment_declared_at ?? null,
    raw: row,
  };
}

/**
 * Whether this invoice can still be paid from the payment page. Cancelled,
 * non-payable (warehouse backorder placeholders) and fully-settled invoices
 * are read-only — the page shows their state instead of payment options.
 */
export function invoiceIsPayable(inv: PayableInvoice): boolean {
  if (inv.non_payable) return false;
  if (inv.status === 'cancelled' || inv.status === 'paid') return false;
  return inv.amount_due > 0.005;
}

/**
 * The customer-safe projection sent to the payment page. Deliberately narrow:
 * line items, money and the invoice number only — no internal ids, notes,
 * costs, sales-person or customer records.
 */
export function publicInvoiceView(inv: PayableInvoice) {
  const items = Array.isArray(inv.raw.line_items) ? inv.raw.line_items : [];
  return {
    invoice_number: inv.invoice_number,
    status: inv.status,
    currency: inv.currency,
    issue_date: inv.raw.issue_date ?? null,
    due_date: inv.raw.due_date ?? null,
    customer_name: inv.customer_name,
    subtotal: Number(inv.raw.subtotal) || 0,
    tax_total: Number(inv.raw.tax_total) || 0,
    shipping_cost: Number(inv.raw.shipping_cost) || 0,
    processing_fee: inv.raw.show_processing_fee ? Number(inv.raw.processing_fee) || 0 : 0,
    total: inv.total,
    amount_paid: inv.amount_paid,
    amount_due: inv.amount_due,
    payable: invoiceIsPayable(inv),
    selected_method: inv.payment_method_selected,
    crypto_wallet_id: inv.crypto_wallet_id,
    crypto_payment_reference: inv.crypto_payment_reference,
    crypto_payment_declared_at: inv.crypto_payment_declared_at,
    items: items.map((li: any) => ({
      description: li.description ?? '',
      qty: Number(li.qty) || 0,
      unit_price: Number(li.unit_price) || 0,
      line_total: Number(li.line_total) || 0,
      price_type: li.price_type ?? null,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Recording a payment                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Record a payment against an invoice and roll the invoice's status forward.
 * Used by the PuraMass webhook when a card payment lands; mirrors what
 * `POST /api/admin/invoices/:id/payments` does when an admin records one by
 * hand, including the stock decrement on the paid transition.
 *
 * Idempotent on `reference_note`: a webhook redelivery carrying the same
 * transaction reference is a no-op rather than a double payment.
 */
export async function recordInvoicePaymentFromGateway(
  db: SupabaseClient,
  invoiceId: string,
  input: {
    /** What the gateway says it captured, or null to settle the full balance. */
    amount: number | null;
    method: 'card' | 'crypto';
    reference: string;
    paidAt?: string | null;
  },
): Promise<{ recorded: boolean; reason?: string }> {
  const { data: invoice } = await db
    .from('invoices')
    .select('id, total, status, payments (amount, reference_note)')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!invoice) return { recorded: false, reason: 'Invoice not found' };

  const existing = (invoice.payments ?? []) as { amount: number; reference_note: string | null }[];
  if (input.reference && existing.some((p) => p.reference_note === input.reference)) {
    return { recorded: false, reason: 'Already recorded' };
  }

  const paidSoFar = existing.reduce((s, p) => s + Number(p.amount), 0);
  const due = Number(invoice.total) - paidSoFar;
  if (due <= 0.005) return { recorded: false, reason: 'Nothing outstanding' };

  // Never let a gateway amount overpay the invoice — clamp to what's due and
  // leave the discrepancy for an admin to reconcile. A null amount (the gateway
  // didn't report one) settles the balance in full.
  const amount = Number(
    (input.amount === null ? due : Math.min(input.amount, due)).toFixed(2),
  );
  if (!(amount > 0)) return { recorded: false, reason: 'Non-positive amount' };

  const { error: payErr } = await db.from('payments').insert({
    invoice_id: invoiceId,
    amount,
    method: input.method,
    reference_note: input.reference,
    paid_at: input.paidAt || new Date().toISOString(),
  });
  if (payErr) {
    console.error('gateway payment insert failed:', payErr);
    return { recorded: false, reason: payErr.message };
  }

  const newPaidTotal = paidSoFar + amount;
  let nextStatus = invoice.status as string;
  if (newPaidTotal + 0.001 >= Number(invoice.total)) nextStatus = 'paid';
  else if (newPaidTotal > 0) nextStatus = 'partial';
  if (nextStatus !== invoice.status) {
    await db.from('invoices').update({ status: nextStatus }).eq('id', invoiceId);
  }

  // The DB function is idempotent, so this is safe even if the invoice was
  // already flipped to paid by another path.
  if (nextStatus === 'paid') {
    const { error: stockErr } = await db.rpc('adjust_stock_for_invoice', {
      p_invoice_id: invoiceId,
    });
    if (stockErr) console.error('stock adjustment failed for invoice', invoiceId, stockErr);
  }

  return { recorded: true };
}

/* -------------------------------------------------------------------------- */
/* Card path: mapping invoice lines to PuraMass SKUs                          */
/* -------------------------------------------------------------------------- */

export interface PuramassLineResolution {
  /** [{ sku, quantity, unit_price_cents }] ready to hand to createPuramassOrder. */
  lines: { sku: string; quantity: number; unit_price_cents: number }[];
  /** Line descriptions we could not map to a PuraMass SKU. */
  unmapped: string[];
  /** The same lines with *why* they could not be mapped, for the admin UI. */
  unmappedDetails: UnmappedInvoiceLine[];
}

/** Why a line item has no PuraMass SKU — shown to admins, never to customers. */
export type UnmappedLineReason =
  | 'no_product'
  | 'missing_sku'
  | 'invalid_sku';

export interface UnmappedInvoiceLine {
  /** The line's description (or the product name), as the admin sees it. */
  label: string;
  reason: UnmappedLineReason;
  /** Which product column was consulted — `puramass_sku_vial` for vial lines. */
  field: 'puramass_sku' | 'puramass_sku_vial';
}

export const UNMAPPED_LINE_REASON_LABELS: Record<UnmappedLineReason, string> = {
  no_product: 'not linked to a product',
  missing_sku: 'the product has no Stealth Health SKU',
  invalid_sku: 'the product\u2019s Stealth Health SKU is not a recognised catalog SKU',
};

/**
 * What the customer is billed for one invoice line, in whole cents.
 *
 * `line_total` is the number the invoice itself shows, so it is the number to
 * charge — it already carries any per-line `discount_pct`. Rows written before
 * a total was persisted (or a zeroed one) fall back to the unit price with the
 * discount applied.
 */
function lineTotalCents(row: {
  qty?: unknown;
  unit_price?: unknown;
  discount_pct?: unknown;
  line_total?: unknown;
}): number {
  const total = Number(row.line_total);
  if (Number.isFinite(total) && total > 0) return Math.round(total * 100);
  const unit = Number(row.unit_price);
  if (!Number.isFinite(unit) || unit <= 0) return 0;
  const discount = Math.min(100, Math.max(0, Number(row.discount_pct) || 0));
  const units = Math.max(1, Math.round(Number(row.qty) || 1));
  return Math.round(unit * (1 - discount / 100) * 100) * units;
}

/**
 * Convert a dollar amount off an invoice (shipping, a fee) into the whole cents
 * the partner API takes. Negative and unparseable amounts read as 0 — the API
 * rejects anything else, and 0 is a real value there (free shipping).
 */
export function invoiceAmountCents(amount: unknown): number {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/**
 * The `shipping_total_cents` to send with this invoice's hosted-checkout
 * hand-off.
 *
 * Zero unless the invoice itself opted in: shipping is frequently already
 * settled elsewhere (collected up front, waived, billed on another invoice),
 * so a payment link that silently added it would charge the customer twice.
 * `charge_shipping_on_checkout` is the per-invoice tick — off by default and
 * absent on a database that hasn't run the migration, both of which read as
 * "don't charge it".
 *
 * `0` is a real value at the partner API rather than "no opinion": it is how a
 * hand-off switches off PuraMass's own default rate, which is exactly what
 * "shipping not charged here" has to mean.
 */
export function checkoutShippingTotalCents(row: {
  shipping_cost?: unknown;
  charge_shipping_on_checkout?: unknown;
}): number {
  return row.charge_shipping_on_checkout === true ? invoiceAmountCents(row.shipping_cost) : 0;
}

/**
 * Map an invoice's line items onto PuraMass catalog SKUs, the same way the
 * storefront hand-off maps a cart: a per-vial line uses `puramass_sku_vial`, a
 * box/pack line uses `puramass_sku`, and only SKUs of the expected shape are
 * trusted so we never hand PuraMass something it won't recognise.
 *
 * Each line also carries `unit_price_cents` — what the invoice charges for one
 * catalog unit — so the hosted checkout bills the invoice's own price instead
 * of PuraMass's catalog price. Two lines that collapse onto one SKU (a box line
 * split across two prices, say) are merged at the price their quantities imply.
 *
 * Any line without a usable mapping is reported in `unmapped` — the payment
 * page uses that to hide the card option rather than sending the customer to a
 * checkout that would be missing items.
 */
export async function resolveInvoicePuramassLines(
  db: SupabaseClient,
  invoiceId: string,
): Promise<PuramassLineResolution> {
  const { data: items } = await db
    .from('invoice_line_items')
    .select('description, qty, price_type, product_id, unit_price, discount_pct, line_total')
    .eq('invoice_id', invoiceId);

  const rows = items ?? [];
  const productIds = rows
    .map((r: any) => r.product_id)
    .filter((v: unknown): v is string => typeof v === 'string');

  const byId = new Map<string, { name: string; box: string | null; vial: string | null }>();
  if (productIds.length) {
    const { data: products } = await db
      .from('products')
      .select('id, name, puramass_sku, puramass_sku_vial')
      .in('id', productIds);
    for (const p of products ?? []) {
      byId.set(p.id as string, {
        name: (p.name as string) ?? '',
        box: (p.puramass_sku as string | null) ?? null,
        vial: (p.puramass_sku_vial as string | null) ?? null,
      });
    }
  }

  // Per SKU: the catalog units we're sending, and the cents they add up to.
  const bySku = new Map<string, { quantity: number; cents: number }>();
  const unmappedDetails: UnmappedInvoiceLine[] = [];
  for (const row of rows as any[]) {
    const isVial = row.price_type === 'vial';
    const prod = row.product_id ? byId.get(row.product_id) : undefined;
    const raw = (isVial ? prod?.vial : prod?.box)?.trim();
    const okForm = isVial ? raw?.endsWith('-vial') : raw?.endsWith('-case');
    const sku = raw && raw.startsWith('puramass-') && okForm ? raw : undefined;
    const label = row.description || prod?.name || 'Item';
    if (!sku) {
      // Separate the three ways a line ends up unmappable so the admin warning
      // can say what to fix: link the line to a product, fill the product's
      // `puramass_sku` / `puramass_sku_vial`, or correct a malformed one.
      const reason: UnmappedLineReason = !prod
        ? 'no_product'
        : !raw
          ? 'missing_sku'
          : 'invalid_sku';
      unmappedDetails.push({
        label: isVial ? `${label} (single vial)` : label,
        reason,
        field: isVial ? 'puramass_sku_vial' : 'puramass_sku',
      });
      continue;
    }
    // The invoice's qty is already in catalog units for its price_type (vials
    // for a vial line, packs for a box line). Clamp to the API's 1–99 range.
    const qty = Math.max(1, Math.min(99, Math.round(Number(row.qty) || 1)));
    // Price per catalog unit, off the line's own total and its own (unclamped)
    // quantity, so a clamp changes how many we send and never the unit price.
    const units = Math.max(1, Math.round(Number(row.qty) || 1));
    const unitCents = Math.round(lineTotalCents(row) / units);
    const prev = bySku.get(sku) ?? { quantity: 0, cents: 0 };
    const quantity = Math.min(99, prev.quantity + qty);
    bySku.set(sku, {
      quantity,
      // Only count the units the clamp actually let through.
      cents: prev.cents + unitCents * (quantity - prev.quantity),
    });
  }

  return {
    lines: Array.from(bySku.entries()).map(([sku, { quantity, cents }]) => ({
      sku,
      quantity,
      unit_price_cents: quantity > 0 ? Math.round(cents / quantity) : 0,
    })),
    unmapped: unmappedDetails.map((u) => u.label),
    unmappedDetails,
  };
}

/* -------------------------------------------------------------------------- */
/* SKU lock                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The hard lock on payment links: every line item that names a product must
 * have the PuraMass SKU *that line* needs — `puramass_sku` for a box/pack line,
 * `puramass_sku_vial` for a per-vial line.
 *
 * It is checked per line, not per product, because the two columns are not a
 * matched pair. Plenty of catalog products only ever exist one way: the general
 * range (VIVI Cap, Omeva, DHEA, Red Yeast Rice, …) has no single-vial SKU at
 * all, and a good two dozen peptides (the Retatrutide pens, Vitamin C/E/T,
 * HCG 2000 IU, …) have no case SKU. Demanding both would lock invoices over a
 * column that can never be filled in, so each line is judged on the one it
 * actually uses.
 *
 * This is stricter than the mapping in `resolveInvoicePuramassLines`, which
 * asks the same question but only ever hides the card option. A missing SKU is
 * a catalog gap only a developer can close, and shipping a payment link built
 * on one has burned us — so the link is refused at creation, and refuses to
 * serve if one already exists, for *both* payment methods.
 *
 * Only line items linked to a product are checked: ad-hoc lines (a manual
 * charge, a note line) have no product to catalogue and never lock an invoice.
 * A malformed-but-present SKU is left to the existing overridable warning —
 * this lock is about the column being empty.
 */

/** The blocker/error code every locked response carries. */
export const SKU_LOCK_CODE = 'missing_puramass_sku';

/**
 * What a customer holding a locked link is told. Deliberately says nothing
 * about SKUs or products — the gap is ours, and there is exactly one useful
 * action on their side.
 */
export const SKU_LOCK_CUSTOMER_MESSAGE =
  'This payment link is locked and cannot be used right now. Please contact admin.';

/** Why one product locks the invoice. */
export type SkuLockReason = 'missing_sku' | 'product_missing' | 'lookup_failed';

export interface SkuLockProduct {
  /** The product's id, or null when the products lookup itself failed. */
  productId: string | null;
  /** The product name, falling back to the line description. */
  label: string;
  reason: SkuLockReason;
  /** The column this product's line needs and hasn't got. Null when unknown. */
  field: 'puramass_sku' | 'puramass_sku_vial' | null;
}

export interface InvoiceSkuLock {
  locked: boolean;
  /** What caused the lock — admin-facing, never sent to a customer. */
  products: SkuLockProduct[];
}

export const SKU_LOCK_FIELD_LABELS: Record<'puramass_sku' | 'puramass_sku_vial', string> = {
  puramass_sku: 'box SKU (puramass_sku)',
  puramass_sku_vial: 'single-vial SKU (puramass_sku_vial)',
};

/**
 * Is this invoice's payment link locked? Fails closed: a products lookup that
 * errors locks the link rather than letting a link out on an unverified
 * catalog.
 */
export async function assessInvoiceSkuLock(
  db: SupabaseClient,
  invoiceId: string,
): Promise<InvoiceSkuLock> {
  const { data: items } = await db
    .from('invoice_line_items')
    .select('description, price_type, product_id')
    .eq('invoice_id', invoiceId);

  const rows = (items ?? []) as {
    description?: string | null;
    price_type?: string | null;
    product_id?: string | null;
  }[];
  const linked = rows.filter(
    (r): r is typeof r & { product_id: string } =>
      typeof r.product_id === 'string' && !!r.product_id,
  );
  // Nothing on this invoice is a catalogued product, so there is no SKU to be
  // missing.
  if (!linked.length) return { locked: false, products: [] };

  const productIds = Array.from(new Set(linked.map((r) => r.product_id)));
  const { data: products, error } = await db
    .from('products')
    .select('id, name, puramass_sku, puramass_sku_vial')
    .in('id', productIds);
  if (error) {
    return {
      locked: true,
      products: [
        {
          productId: null,
          label: 'This invoice\u2019s products',
          reason: 'lookup_failed',
          field: null,
        },
      ],
    };
  }

  const byId = new Map<string, { name: string; box: string | null; vial: string | null }>();
  for (const p of (products ?? []) as Record<string, any>[]) {
    byId.set(p.id as string, {
      name: ((p.name as string) ?? '').trim(),
      box: (p.puramass_sku as string | null) ?? null,
      vial: (p.puramass_sku_vial as string | null) ?? null,
    });
  }

  // Keyed by product + column, so a product that appears as both a box line and
  // a vial line is judged on each column it is actually sold under, and is
  // still only reported once per column.
  const offenders = new Map<string, SkuLockProduct>();
  for (const row of linked) {
    const isVial = row.price_type === 'vial';
    const field = isVial ? 'puramass_sku_vial' : 'puramass_sku';
    const key = `${row.product_id}:${field}`;
    if (offenders.has(key)) continue;
    const prod = byId.get(row.product_id);
    const label = prod?.name || (row.description ?? '').trim() || 'Item';
    if (!prod) {
      // One entry per missing product, whichever column its line wanted.
      if (!offenders.has(`${row.product_id}:missing`)) {
        offenders.set(`${row.product_id}:missing`, {
          productId: row.product_id,
          label,
          reason: 'product_missing',
          field: null,
        });
      }
      continue;
    }
    const value = isVial ? prod.vial : prod.box;
    if (!(value ?? '').trim()) {
      offenders.set(key, {
        productId: row.product_id,
        label: isVial ? `${label} (single vial)` : label,
        reason: 'missing_sku',
        field,
      });
    }
  }

  return { locked: offenders.size > 0, products: Array.from(offenders.values()) };
}

/**
 * The admin-facing explanation of a lock. Names each product and the column it
 * is missing, so whoever reads it can hand the developer the exact gap to fill.
 */
export function skuLockAdminMessage(products: SkuLockProduct[]): string {
  const lookupFailed = products.some((p) => p.reason === 'lookup_failed');
  if (lookupFailed || products.length === 0) {
    return (
      'Payment links are locked for this invoice: its products could not be checked for a ' +
      'Stealth Health SKU. Please contact developer.'
    );
  }
  const n = products.length;
  const labels = joinLabels(
    products.map((p) =>
      p.reason === 'missing_sku' && p.field
        ? `${p.label} — no ${SKU_LOCK_FIELD_LABELS[p.field]}`
        : `${p.label} — the linked product no longer exists`,
    ),
  );
  return (
    `Payment links are locked for this invoice: ${n} line item${n === 1 ? '' : 's'} ` +
    `${n === 1 ? 'has' : 'have'} no Stealth Health SKU on the column ` +
    `${n === 1 ? 'it needs' : 'they need'} — ${labels}. Neither card nor crypto can be ` +
    'offered until that is filled in. Please contact developer.'
  );
}

/* -------------------------------------------------------------------------- */
/* Pre-flight: is this invoice fit to send a payment request for?             */
/* -------------------------------------------------------------------------- */

/**
 * The email shape the payment flow needs. Deliberately the same permissive
 * regex the other send endpoints use — the mail server is the real validator.
 */
export const PAYMENT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PaymentRequestIssue {
  code: string;
  message: string;
}

export interface PaymentRequestReadiness {
  /** Hard stops. The send / link-mint is refused while any of these stand. */
  blockers: PaymentRequestIssue[];
  /** Soft problems. The admin may proceed by acknowledging them. */
  warnings: PaymentRequestIssue[];
  /** The address the payment flow would use, once valid. */
  customerEmail: string | null;
  /** Whether the invoice already carries an email (vs. one being supplied now). */
  invoiceHasEmail: boolean;
  /** Lines with no PuraMass SKU, with the reason for each. */
  unmapped: UnmappedInvoiceLine[];
  /** The hard SKU lock — when locked, nothing about this invoice is sendable. */
  skuLock: InvoiceSkuLock;
  cardAvailable: boolean;
  cryptoAvailable: boolean;
}

/** The warning code the admin UI overrides by acknowledging it. */
export const UNMAPPED_SKUS_WARNING = 'unmapped_puramass_skus';

function joinLabels(labels: string[], max = 4): string {
  const shown = labels.slice(0, max);
  const rest = labels.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
}

/**
 * Decide whether a payment request for this invoice is worth sending, and why
 * not when it isn't.
 *
 * Two failure modes have bitten us in production, and they are not the same
 * kind of problem:
 *
 *   - **No customer email.** The PuraMass hand-off requires one, so the card
 *     path dead-ends at `/api/pay/:token/checkout`. Nothing the customer can do
 *     about it. This is a *blocker*.
 *   - **A line item whose own SKU column is empty** — `puramass_sku` on a box
 *     line, `puramass_sku_vial` on a vial line. That is a catalog gap only a
 *     developer can close, so it is a *blocker*, and it locks the link on the
 *     customer's side too (see `assessInvoiceSkuLock`).
 *   - **A line item with a null `puramass_sku` / `puramass_sku_vial`.** The
 *     payment page simply hides the card option, so the customer can still pay
 *     by crypto. Sometimes that is exactly what the admin wants (a crypto-only
 *     invoice, a one-off line). This is an overridable *warning*.
 *
 * `opts.recipient` is the address the admin is about to send to — it satisfies
 * the email requirement even when the invoice itself has none, because the
 * callers persist it onto the invoice before handing out the link.
 */
export async function assessPaymentRequestReadiness(
  db: SupabaseClient,
  invoice: { id: string; customer_email?: string | null },
  opts: { recipient?: string | null } = {},
): Promise<PaymentRequestReadiness> {
  const blockers: PaymentRequestIssue[] = [];
  const warnings: PaymentRequestIssue[] = [];

  // First, because it is the one failure no amount of admin input can work
  // around and it dominates every other message on the panel.
  const skuLock = await assessInvoiceSkuLock(db, invoice.id);
  if (skuLock.locked) {
    blockers.push({
      code: SKU_LOCK_CODE,
      message: skuLockAdminMessage(skuLock.products),
    });
  }

  const onInvoice = (invoice.customer_email ?? '').trim();
  const supplied = (opts.recipient ?? '').trim();
  const candidate = supplied || onInvoice;
  const customerEmail = candidate && PAYMENT_EMAIL_RE.test(candidate) ? candidate : null;

  if (!candidate) {
    blockers.push({
      code: 'missing_email',
      message:
        'This invoice has no customer email. Card payments hand off to Stealth Health, ' +
        'which requires one — add an email before sending the payment link.',
    });
  } else if (!customerEmail) {
    blockers.push({
      code: 'invalid_email',
      message: `“${candidate}” is not a valid email address.`,
    });
  }

  const settings = await readPaymentPageSettings(db);
  // A locked invoice offers nothing at all — not even crypto.
  const cryptoAvailable = settings.cryptoEnabled && !skuLock.locked;

  let unmapped: UnmappedInvoiceLine[] = [];
  let cardAvailable = settings.cardEnabled && !skuLock.locked;
  let hasLines = true;
  if (settings.cardEnabled) {
    const resolution = await resolveInvoicePuramassLines(db, invoice.id);
    unmapped = resolution.unmappedDetails;
    hasLines = resolution.lines.length > 0 || unmapped.length > 0;
    cardAvailable =
      resolution.lines.length > 0 && unmapped.length === 0 && !skuLock.locked;
  }

  // The lock already refuses the send outright, so the softer "card will be
  // hidden" warning would only muddy what the admin has to act on.
  if (!skuLock.locked && settings.cardEnabled && !cardAvailable && hasLines) {
    const n = unmapped.length;
    const detail = n
      ? `${n} item${n === 1 ? '' : 's'} on this invoice ${n === 1 ? 'is' : 'are'} ` +
        `not mapped to a Stealth Health SKU (${joinLabels(unmapped.map((u) => u.label))}).`
      : 'This invoice has no line items that map to a Stealth Health SKU.';
    warnings.push({
      code: UNMAPPED_SKUS_WARNING,
      message:
        `${detail} The Visa/Mastercard option will be hidden on the payment page` +
        (cryptoAvailable
          ? ', so the customer can only pay by crypto.'
          : ' — and crypto is turned off, so the customer will have no way to pay at all.'),
    });
  }

  return {
    blockers,
    warnings,
    customerEmail,
    invoiceHasEmail: Boolean(onInvoice),
    unmapped,
    skuLock,
    cardAvailable,
    cryptoAvailable,
  };
}
