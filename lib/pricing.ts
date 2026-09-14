/**
 * Shared CAD ↔ USD pricing helpers.
 *
 * The CAD `price` column is the base price. A product's USD price is either an
 * explicit `price_usd` override or, when that is null, the CAD price converted
 * with the global `usd_exchange_rate` multiplier from Site Settings. Computing
 * it live means a rate change instantly refreshes every auto USD price.
 */

/** Fallback CAD→USD multiplier when Site Settings hasn't loaded a rate yet. */
export const DEFAULT_USD_RATE = 0.73;

/** Round a money value to cents. */
export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Convert a CAD amount to USD using the given rate. */
export function usdFromCad(cad: number, rate: number): number {
  return round2((Number(cad) || 0) * (Number(rate) || DEFAULT_USD_RATE));
}

/**
 * Convert a USD amount to CAD using the given rate (inverse of usdFromCad).
 * Used when a customer's stored prices are native USD but the invoice is being
 * raised in CAD.
 */
export function cadFromUsd(usd: number, rate: number): number {
  const r = Number(rate) || DEFAULT_USD_RATE;
  return round2((Number(usd) || 0) / (r || DEFAULT_USD_RATE));
}

/**
 * A product's USD box price: an explicit `price_usd` override when set,
 * otherwise the CAD price converted at `rate`.
 *
 * When the product carries a per-customer CAD override (`has_override`), the
 * catalog `price_usd` no longer matches the price the customer sees, so the USD
 * price is derived from the (overridden) CAD price at `rate` instead.
 */
export function productUsdPrice(
  product: { price: number; price_usd?: number | null; has_override?: boolean },
  rate: number,
  /**
   * Whether the customer's prices are converted at all. `false` is the
   * storefront's "bill in USD but show the configured figure as-is" mode (see
   * `customers.convert_storefront_prices`): the catalog `price_usd` is a
   * *converted* price, so it is ignored, and the caller passes `rate: 1` to
   * leave the configured figure untouched. Defaults to `true` so every existing
   * caller — the admin invoice form included — behaves exactly as before.
   */
  convert = true,
): number {
  if (
    convert &&
    !product.has_override &&
    product.price_usd != null &&
    Number(product.price_usd) >= 0
  ) {
    return Number(product.price_usd);
  }
  return usdFromCad(Number(product.price), rate);
}

/** Symbol/label for a currency code. Amounts print as `$X.XX CAD` / `$X.XX USD`. */
export type PriceCurrency = 'CAD' | 'USD';

/** Normalise an arbitrary value to a supported currency code (CAD fallback). */
export function toPriceCurrency(v: unknown): PriceCurrency {
  return v === 'USD' ? 'USD' : 'CAD';
}

/**
 * A CAD base amount expressed in the active display currency: the CAD amount
 * itself for CAD, or converted at `rate` for USD. `usdOverride` lets callers
 * supply an explicit USD amount (e.g. a product's `price_usd`) that should win
 * over the rate conversion.
 */
export function inCurrency(
  cad: number,
  currency: PriceCurrency,
  rate: number,
  usdOverride?: number | null,
  /** See {@link productUsdPrice} — `false` ignores the converted override. */
  convert = true,
): number {
  if (currency !== 'USD') return round2(cad);
  if (convert && usdOverride != null && Number(usdOverride) >= 0) {
    return round2(Number(usdOverride));
  }
  return usdFromCad(cad, rate);
}

/** Format a money amount with a `$` symbol and a trailing currency code. */
export function formatMoney(amount: number, currency: PriceCurrency): string {
  return `$${(Number(amount) || 0).toFixed(2)} ${currency}`;
}

// ---------------------------------------------------------------------------
// Case (box) ⇄ vial pricing
// ---------------------------------------------------------------------------
// `products.price` **is** the case price and `products.stock_quantity` is
// counted in vials. There is no pack discount anywhere in the catalog: a case
// costs exactly `vial price × vials_per_box`, so the two prices convert into
// each other in both directions. `vial_price` is an optional override; when it
// is null the vial price is derived from the case price ("auto").

/**
 * How many vials make up one case. Guards a missing / zero / non-numeric
 * `vials_per_box` with the catalog default of 10.
 */
export function vialsPerBoxOf(v: unknown): number {
  const n = Number(v);
  return n > 0 ? n : 10;
}

/** The case price implied by a per-vial price. No pack discount. */
export function casePriceFromVial(vial: number, per: unknown): number {
  return round2((Number(vial) || 0) * vialsPerBoxOf(per));
}

/** The per-vial price implied by a case price when no override is stored. */
export function fallbackVialPrice(box: number, per: unknown): number {
  return round2((Number(box) || 0) / vialsPerBoxOf(per));
}

/**
 * A product's per-vial price: the explicit `vial_price` override when one is
 * set, otherwise the case price divided by vials-per-box.
 *
 * The override only counts when it is greater than zero — a stored 0 sitting
 * next to a real case price is legacy noise, not "this vial is free". A
 * genuinely free product (`price` 0, no override) still resolves to 0.
 */
export function vialPriceFor(product: {
  price: number;
  vial_price?: number | null;
  vials_per_box?: number | null;
}): number {
  const override = Number(product.vial_price);
  if (product.vial_price != null && Number.isFinite(override) && override > 0) {
    return round2(override);
  }
  return fallbackVialPrice(Number(product.price), product.vials_per_box);
}

/**
 * Money formatted with a bare `$` and no trailing currency code — for dense
 * numeric surfaces (the products cell-edit grid) where a column header already
 * names the currency and `formatMoney`'s `$12.00 CAD` would be noise.
 */
const NARROW_MONEY: Partial<Record<PriceCurrency, Intl.NumberFormat>> = {};
export function formatMoneyNarrow(amount: number, currency: PriceCurrency): string {
  let fmt = NARROW_MONEY[currency];
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    });
    NARROW_MONEY[currency] = fmt;
  }
  return fmt.format(Number(amount) || 0);
}
