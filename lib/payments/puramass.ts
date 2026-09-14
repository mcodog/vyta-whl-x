/**
 * PuraMass hosted-checkout API client (Stealth Health partner API).
 *
 * SERVER-ONLY. This module reads the partner credentials from the environment
 * and must never be imported into client/browser code — doing so would leak the
 * live API key. It is used by the checkout hand-off route
 * (`/api/checkout/puramass`) and the admin SKU-sync endpoint.
 *
 * Flow: the storefront backend POSTs the cart's SKUs to `POST
 * /partner/store/orders`; the API responds with a `payment_link` on the
 * PuraMass patient-portal domain, and the customer is redirected there to pay.
 * PuraMass owns payment, fulfilment, and order emails from that point.
 *
 * Pricing: by default PuraMass re-reads prices from its own catalog. A caller
 * may instead name the amounts for a single order — a per-line
 * `unit_price_cents` and an order-level `shipping_total_cents` — and those are
 * the amounts charged (see `PuramassCreateOrderInput`). We use that for invoice
 * payment links, so the customer is charged what their invoice says; the
 * storefront cart hand-off still lets PuraMass price the order.
 *
 * @see docs — PURAMASS_HOSTED_CHECKOUT.md
 */

import { createHmac, timingSafeEqual } from 'crypto';

const DEFAULT_BASE_URL = 'https://api.stealth.health';
const DEFAULT_PARTNER_ID = 'ptr_puramass';
const REQUEST_TIMEOUT_MS = 20_000;

export function puramassBaseUrl(): string {
  return (process.env.PURAMASS_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export function puramassPartnerId(): string {
  return process.env.PURAMASS_PARTNER_ID || DEFAULT_PARTNER_ID;
}

function puramassApiKey(): string {
  return (process.env.PURAMASS_API_KEY || '').trim();
}

function puramassWebhookSecret(): string {
  return (process.env.PURAMASS_WEBHOOK_SECRET || '').trim();
}

/** Whether the server can verify incoming PuraMass webhook signatures. */
export function isPuramassWebhookConfigured(): boolean {
  return Boolean(puramassWebhookSecret());
}

/**
 * Whether the server has the credentials needed to talk to PuraMass. The
 * admin toggle (`site_settings.puramass_checkout_enabled`) can be on, but the
 * hosted checkout only actually works when this is also true.
 */
export function isPuramassConfigured(): boolean {
  return Boolean(puramassApiKey() && puramassPartnerId());
}

function authHeaders(): Record<string, string> {
  return {
    'X-Partner-ID': puramassPartnerId(),
    'X-Api-Key': puramassApiKey(),
  };
}

/**
 * The API's machine-readable rejection codes for the price-override fields.
 * `STORE_PRICE_BELOW_WHOLESALE` means a `unit_price_cents` was under the
 * wholesale price PuraMass invoices us for that SKU (the message names the SKU
 * and its floor); `STORE_PRICE_OVERRIDE_INVALID` means a malformed amount —
 * negative, fractional, or above the ceiling below.
 */
export const PURAMASS_PRICE_BELOW_WHOLESALE = 'STORE_PRICE_BELOW_WHOLESALE';
export const PURAMASS_PRICE_OVERRIDE_INVALID = 'STORE_PRICE_OVERRIDE_INVALID';

/** The largest amount the API accepts for a price override: $100,000.00. */
export const PURAMASS_MAX_PRICE_CENTS = 10_000_000;

/** An API/transport failure. Never carries credentials in its message. */
export class PuramassApiError extends Error {
  status: number;
  detail?: unknown;
  /** The API's error code when it sent one, e.g. `STORE_PRICE_BELOW_WHOLESALE`. */
  code?: string;
  constructor(message: string, status: number, detail?: unknown, code?: string) {
    super(message);
    this.name = 'PuramassApiError';
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

/**
 * Whether an error is the API refusing our prices rather than a transport or
 * catalog problem. Callers use it to keep the wholesale floor (and the SKU it
 * names) out of a customer-facing message.
 */
export function isPuramassPriceRejection(err: unknown): boolean {
  return (
    err instanceof PuramassApiError &&
    (err.code === PURAMASS_PRICE_BELOW_WHOLESALE ||
      err.code === PURAMASS_PRICE_OVERRIDE_INVALID)
  );
}

/** The error code an API response carries, if any. */
function errorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const raw = (body as any).code ?? (body as any).error_code ?? (body as any).error?.code;
  return typeof raw === 'string' && raw ? raw : undefined;
}

/**
 * Validate an amount we are about to send as an override. A price we cannot
 * send is never silently dropped: dropping it would hand the customer
 * PuraMass's catalog price instead of the one we meant to charge, so this
 * throws and the caller refuses the hand-off.
 */
function priceCentsOrThrow(
  label: string,
  value: number | null | undefined,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > PURAMASS_MAX_PRICE_CENTS) {
    throw new PuramassApiError(
      `${label} must be a whole number of cents between 0 and ${PURAMASS_MAX_PRICE_CENTS} (got ${value})`,
      400,
      undefined,
      PURAMASS_PRICE_OVERRIDE_INVALID,
    );
  }
  return value;
}

async function puramassFetch(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${puramassBaseUrl()}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers || {}) },
      signal: controller.signal,
      // Never cache credentialed partner calls.
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new PuramassApiError('PuraMass request timed out', 504);
    }
    throw new PuramassApiError('Could not reach PuraMass', 502);
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface PuramassCatalogProduct {
  sku: string;
  name: string;
  /** Price in dollars, when the API returns a decimal `price`. */
  price?: number;
  /** Price in cents, when the API returns an integer `price_cents`. */
  price_cents?: number;
  image?: string | null;
}

/**
 * `GET /partner/store/products` — the live SKU source of truth.
 * Returns the catalog products (sku, name, price, image). Tolerant of the two
 * plausible response envelopes (`{ products: [...] }` or a bare array) and of
 * either `price` (dollars) or `price_cents`.
 */
export async function fetchPuramassCatalog(): Promise<PuramassCatalogProduct[]> {
  const res = await puramassFetch('/partner/store/products', { method: 'GET' });
  if (!res.ok) {
    throw new PuramassApiError(
      `PuraMass catalog request failed (${res.status})`,
      res.status,
      await safeBody(res),
    );
  }
  const body = await res.json().catch(() => null);
  const list: unknown = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as any).products)
      ? (body as any).products
      : body && typeof body === 'object' && Array.isArray((body as any).data)
        ? (body as any).data
        : [];
  return (list as any[])
    .filter((p) => p && typeof p.sku === 'string')
    .map((p) => ({
      sku: String(p.sku),
      name: String(p.name ?? ''),
      price: typeof p.price === 'number' ? p.price : undefined,
      price_cents: typeof p.price_cents === 'number' ? p.price_cents : undefined,
      image: p.image ?? p.image_url ?? null,
    }));
}

// ---------------------------------------------------------------------------
// Orders (checkout hand-off)
// ---------------------------------------------------------------------------

export interface PuramassOrderLine {
  sku: string;
  /** Number of catalog units (each PuraMass SKU is a 10-pack). Clamped 1–99. */
  quantity: number;
  /**
   * What this SKU costs the customer on THIS order, in whole cents. Optional —
   * omit it and PuraMass charges its own catalog price. It applies to this
   * order only and is not saved as a new default, so the same SKU can be a
   * different price next time. `0` is a real value, not "unset".
   *
   * Floor: it may not go below the wholesale price PuraMass invoices us for the
   * SKU — that is owed regardless of what we charge our own customer — or the
   * order is rejected with `STORE_PRICE_BELOW_WHOLESALE`.
   */
  unit_price_cents?: number;
}

export interface PuramassCustomer {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

/** The currencies the partner API prices an order in. Sent lower-case. */
export type PuramassCurrency = 'cad' | 'usd';

/**
 * Normalise a currency to what the API expects (lower-case `cad` / `usd`).
 * Anything unrecognised falls back to `cad`, the store's base currency.
 */
export function toPuramassCurrency(value: unknown): PuramassCurrency {
  return String(value ?? '').trim().toLowerCase() === 'usd' ? 'usd' : 'cad';
}

export interface PuramassCreateOrderInput {
  items: PuramassOrderLine[];
  customer: PuramassCustomer;
  /** Up to 120 chars, echoed back — our internal reference for reconciliation. */
  partnerReference: string;
  /**
   * The currency every amount on this order is expressed in — the customer's
   * own billing currency. Omit it and PuraMass uses its account default (USD).
   * Send it whenever any amount is named, so `unit_price_cents: 15600` can't be
   * read as 156.00 in the wrong currency.
   */
  currency?: PuramassCurrency;
  /**
   * Shipping for the whole order, in whole cents. Omit it and PuraMass applies
   * its own default rate ($35.00); send `0` for free shipping. Unlike a line
   * price this has no floor and may be zero. This order only — nothing is saved
   * as a new default.
   */
  shippingTotalCents?: number;
}

export interface PuramassOrderItem {
  sku?: string;
  quantity?: number;
  [key: string]: unknown;
}

export interface PuramassOrder {
  status: string;
  transaction_id: string;
  payment_link: string;
  subtotal_cents: number;
  /** Shipping the API settled on — our override when we sent one. */
  shipping_total_cents?: number;
  /** The order's grand total, when the API reports one. */
  total_cents?: number;
  items: PuramassOrderItem[];
}

/**
 * `POST /partner/store/orders` — create a hosted-checkout order for the cart.
 * Returns the order with the `payment_link` to redirect the customer to.
 *
 * Prices are optional. Send SKU + quantity alone and PuraMass prices the order
 * from its catalog (the storefront cart path). Send `unit_price_cents` on a
 * line and/or `shippingTotalCents` on the order and those amounts are what the
 * customer is charged, on the hosted link and in the totals that come back —
 * in the `currency` named on the order.
 *
 * No shipping address is sent — PuraMass collects it on the hosted page. When
 * we collect it ourselves (the signed-in customer checkout) it is used for the
 * Easyship shipment on our side, not sent here.
 */
export async function createPuramassOrder(
  input: PuramassCreateOrderInput,
): Promise<PuramassOrder> {
  const shippingTotalCents = priceCentsOrThrow(
    'shipping_total_cents',
    input.shippingTotalCents,
  );
  const payload = {
    items: input.items.map((i) => {
      const unit = priceCentsOrThrow(`unit_price_cents for ${i.sku}`, i.unit_price_cents);
      return {
        sku: i.sku,
        quantity: i.quantity,
        // Only present when we mean to name the price — `0` is a real value, so
        // the test is for undefined, not falsiness.
        ...(unit === undefined ? {} : { unit_price_cents: unit }),
      };
    }),
    customer: {
      email: input.customer.email,
      ...(input.customer.first_name ? { first_name: input.customer.first_name } : {}),
      ...(input.customer.last_name ? { last_name: input.customer.last_name } : {}),
      ...(input.customer.phone ? { phone: input.customer.phone } : {}),
    },
    payment: { mode: 'customer' as const },
    partner_reference: input.partnerReference,
    ...(input.currency ? { currency: input.currency } : {}),
    ...(shippingTotalCents === undefined
      ? {}
      : { shipping_total_cents: shippingTotalCents }),
  };

  const res = await puramassFetch('/partner/store/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && typeof (body as any).error === 'string'
        ? (body as any).error
        : null) ||
      (body && typeof body === 'object' && typeof (body as any).message === 'string'
        ? (body as any).message
        : null) ||
      `PuraMass order request failed (${res.status})`;
    throw new PuramassApiError(message, res.status, body, errorCode(body));
  }

  const order = body && typeof body === 'object' ? (body as any).order ?? body : null;
  if (!order || typeof order.payment_link !== 'string' || typeof order.transaction_id !== 'string') {
    throw new PuramassApiError('PuraMass returned an unexpected order response', 502, body);
  }

  return {
    status: String(order.status ?? 'payment_pending'),
    transaction_id: String(order.transaction_id),
    payment_link: String(order.payment_link),
    subtotal_cents: Number.isFinite(Number(order.subtotal_cents))
      ? Number(order.subtotal_cents)
      : 0,
    shipping_total_cents: centsOrUndefined(order.shipping_total_cents),
    total_cents: centsOrUndefined(order.total_cents ?? order.amount_total_cents),
    items: Array.isArray(order.items) ? order.items : [],
  };
}

/** A numeric cents field from a response, or undefined when absent/garbage. */
function centsOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * What an order actually costs, in cents, from a create response, a status
 * read, or a webhook payload — whichever total that source happens to carry.
 *
 * The shapes differ and only some carry shipping: prefer an explicit grand
 * total, fall back to subtotal + the shipping the same payload reports, and
 * only then to the bare subtotal. Returns null when the source names no amount
 * at all, which the caller must not read as "free".
 */
export function puramassChargedCents(source: unknown): number | null {
  if (!source || typeof source !== 'object') return null;
  const s = source as Record<string, unknown>;
  const total = centsOrUndefined(s.total_cents ?? s.amount_total_cents ?? s.amount_cents);
  if (total !== undefined) return total;
  const subtotal = centsOrUndefined(s.subtotal_cents);
  if (subtotal === undefined) return null;
  const shipping = centsOrUndefined(s.shipping_total_cents ?? s.shipping_cents);
  return subtotal + (shipping ?? 0);
}

// ---------------------------------------------------------------------------
// Order status (polling) — GET /partner/store/orders/{transaction_id}
// ---------------------------------------------------------------------------

export interface PuramassOrderStatus {
  transaction_id: string;
  /** payment_pending | paid | expired | cancelled */
  status: string;
  partner_reference?: string;
  payment_mode?: string;
  currency?: string;
  subtotal_cents?: number;
  shipping_total_cents?: number;
  total_cents?: number;
  payment_link?: string;
  created_at?: string;
  paid_at?: string | null;
  expires_at?: string;
  items?: PuramassOrderItem[];
}

/**
 * `GET /partner/store/orders/{transaction_id}` — current status of a hosted
 * order. Used to poll/refresh a hand-off (and to backfill events that fired
 * before the webhook URL was registered).
 */
export async function fetchPuramassOrderStatus(
  transactionId: string,
): Promise<PuramassOrderStatus> {
  const res = await puramassFetch(
    `/partner/store/orders/${encodeURIComponent(transactionId)}`,
    { method: 'GET' },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new PuramassApiError(
      `PuraMass order status request failed (${res.status})`,
      res.status,
      body,
    );
  }
  const order = body && typeof body === 'object' ? (body as any).order ?? body : null;
  if (!order || typeof order.status !== 'string') {
    throw new PuramassApiError('PuraMass returned an unexpected status response', 502, body);
  }
  return {
    transaction_id: String(order.transaction_id ?? transactionId),
    status: String(order.status),
    partner_reference: order.partner_reference ?? undefined,
    payment_mode: order.payment_mode ?? undefined,
    currency: order.currency ?? undefined,
    subtotal_cents: centsOrUndefined(order.subtotal_cents),
    shipping_total_cents: centsOrUndefined(order.shipping_total_cents),
    total_cents: centsOrUndefined(order.total_cents ?? order.amount_total_cents),
    payment_link: order.payment_link ?? undefined,
    created_at: order.created_at ?? undefined,
    paid_at: order.paid_at ?? null,
    expires_at: order.expires_at ?? undefined,
    items: Array.isArray(order.items) ? order.items : undefined,
  };
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Verify an incoming PuraMass webhook. The `X-Stealth-Signature` header is
 * `sha256=<hex>` where the hex is an HMAC-SHA256 of the RAW request body signed
 * with PURAMASS_WEBHOOK_SECRET. Always compute over the raw bytes (never a
 * re-serialized JSON object). Constant-time compare; false on any mismatch,
 * missing header, or missing secret.
 */
export function verifyPuramassSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
): boolean {
  const secret = puramassWebhookSecret();
  if (!secret || !signatureHeader) return false;
  const expected =
    'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch — guard first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Read a response body for error context without throwing. */
async function safeBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    try {
      return await res.text();
    } catch {
      return undefined;
    }
  }
}
