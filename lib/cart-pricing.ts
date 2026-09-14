/**
 * What a cart line actually costs the customer looking at it.
 *
 * SERVER-ONLY. A cart line carries the price that was on screen when the item
 * was added, and that snapshot goes stale: a guest adds at catalog prices and
 * then signs in, an admin edits the customer's overrides, the customer signs in
 * as somebody else. The browser keeps the cart in localStorage, so the stale
 * figure survives every reload.
 *
 * This module re-derives the prices from the database for a *verified*
 * customer, and is the single source both users of it agree on:
 *
 *   - `POST /api/cart/prices` — the storefront cart re-prices itself against
 *     this as soon as the customer resolves, so the cart never shows an amount
 *     the customer would not be charged.
 *   - `POST /api/orders-email` — the order is billed from this rather than from
 *     the prices the browser sent up.
 *
 * The arithmetic deliberately mirrors `components/AddToCartModal.tsx` (the
 * screen the price was quoted on) and `lib/payments/puramass-pricing.ts` (the
 * hosted checkout's copy of the same rules): a single vial uses the explicit
 * vial price when one is set, a vial inside a pack of ten is the case price
 * split ten ways, and the USD figures honour a product's `price_usd` override
 * unless this customer's prices are billed as-is (see
 * `customers.convert_storefront_prices`). Change one and all three have to move
 * together or the cart will quote a different number than the tile did.
 */

import {
  DEFAULT_USD_RATE,
  productUsdPrice,
  round2,
  toPriceCurrency,
  usdFromCad,
  type PriceCurrency,
} from '@/lib/pricing';

/** Vials in a pack. Matches the storefront's own constant. */
const PACK_OF_TEN = 10;

type Db = { from: (table: string) => any };

/** A cart line as it reaches the server: which product, in which form. */
export interface CartPriceLine {
  /** `products.id`. */
  id: string;
  /** 1 for a single vial, 10 for a pack. Anything else normalises to 10. */
  packSize: number;
}

/** Why a line can no longer be bought by this customer. */
export type CartLineBlock = 'unknown' | 'inactive' | 'hidden';

/** One line's authoritative price, or the reason it can't be sold. */
export interface CartPricedLine {
  id: string;
  packSize: number;
  /** Product name as the catalog spells it, for the "removed from cart" notice. */
  name: string;
  /** Per-vial CAD price — the cart's base figure. */
  price: number;
  /** Per-vial price in the customer's billing currency. */
  priceUsd: number;
  /** False when this customer can't buy it; `block` says why. */
  available: boolean;
  block?: CartLineBlock;
}

export interface CartPricing {
  /** The customer's billing currency (CAD for a guest). */
  currency: PriceCurrency;
  /**
   * The multiplier already folded the way `CurrencyContext` folds it: the store
   * rate when this customer's prices convert, and 1 when they don't, so a
   * configured 156 is billed as 156 USD rather than converted down.
   */
  rate: number;
  /** Whether the configured figures convert — see `productUsdPrice`. */
  convert: boolean;
  lines: CartPricedLine[];
}

/** Normalise a requested pack size to the two forms the storefront sells. */
function normalizePackSize(value: unknown): number {
  return Number(value) === 1 ? 1 : PACK_OF_TEN;
}

/**
 * The customer's currency tag and conversion switch, read from the database
 * rather than the request. A guest (or a row from a database whose migration
 * hasn't run) bills in CAD and does not convert.
 */
async function getCustomerMoney(
  db: Db,
  customerId: string | null,
): Promise<{ currency: PriceCurrency; convert: boolean }> {
  if (!customerId) return { currency: 'CAD', convert: false };
  try {
    const { data, error } = await db
      .from('customers')
      .select('price_currency, convert_storefront_prices')
      .eq('id', customerId)
      .maybeSingle();
    if (error || !data) return { currency: 'CAD', convert: false };
    return {
      currency: toPriceCurrency(data.price_currency),
      convert: data.convert_storefront_prices === true,
    };
  } catch {
    return { currency: 'CAD', convert: false };
  }
}

/** The store's CAD→USD multiplier, falling back to the shared default. */
async function getStoreRate(db: Db): Promise<number> {
  try {
    const { data } = await db
      .from('site_settings')
      .select('usd_exchange_rate')
      .maybeSingle();
    const n = Number(data?.usd_exchange_rate);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_RATE;
  } catch {
    return DEFAULT_USD_RATE;
  }
}

/**
 * Price every cart line for `customerId` (null = guest, catalog prices).
 *
 * Lines are returned in the order they were asked for, one per request line,
 * including duplicates — the caller matches them back by `id` + `packSize`.
 */
export async function resolveCartPrices(
  db: Db,
  customerId: string | null,
  lines: CartPriceLine[],
): Promise<CartPricing> {
  const [{ currency, convert }, storeRate] = await Promise.all([
    getCustomerMoney(db, customerId),
    getStoreRate(db),
  ]);
  // Mirrors CurrencyContext: a USD customer whose prices don't convert leaves
  // every configured figure untouched, so callers can always just multiply.
  const rate = currency === 'USD' && !convert ? 1 : storeRate;

  const wanted = lines
    .filter((l) => l && typeof l.id === 'string' && l.id)
    .map((l) => ({ id: l.id, packSize: normalizePackSize(l.packSize) }));
  if (!wanted.length) return { currency, rate, convert, lines: [] };

  const ids = [...new Set(wanted.map((l) => l.id))];

  const { data: productRows } = await db
    .from('products')
    .select('id, name, price, vial_price, price_usd, active')
    .in('id', ids);
  const products = new Map<string, any>((productRows ?? []).map((p: any) => [p.id, p]));

  // Per-customer overrides, exactly as /api/products layers them: a $0 box
  // price or an explicit visibility of false means "this customer can't see it".
  const overrides = new Map<string, any>();
  if (customerId) {
    const { data: overrideRows } = await db
      .from('customer_price_overrides')
      .select('product_id, override_price, vial_override_price, is_visible')
      .eq('customer_id', customerId)
      .in('product_id', ids);
    for (const o of overrideRows ?? []) overrides.set(o.product_id, o);
  }

  const priced = wanted.map<CartPricedLine>(({ id, packSize }) => {
    const blocked = (name: string, block: CartLineBlock): CartPricedLine => ({
      id,
      packSize,
      name,
      price: 0,
      priceUsd: 0,
      available: false,
      block,
    });

    const product = products.get(id);
    if (!product) return blocked('', 'unknown');
    if (product.active === false) return blocked(product.name ?? '', 'inactive');

    const override = overrides.get(id);
    const boxOverride =
      override?.override_price != null ? Number(override.override_price) : null;
    const vialOverride =
      override?.vial_override_price != null ? Number(override.vial_override_price) : null;
    if (override?.is_visible === false || boxOverride === 0) {
      return blocked(product.name ?? '', 'hidden');
    }

    // The figures this customer is quoted: their overrides where set, the
    // catalog otherwise.
    const boxPrice = boxOverride != null ? boxOverride : Number(product.price) || 0;
    const vialPrice = vialOverride != null ? vialOverride : Number(product.vial_price);
    const hasOverride = boxOverride != null || vialOverride != null;

    const boxPerVial = boxPrice / PACK_OF_TEN;
    const singleVial =
      Number.isFinite(vialPrice) && vialPrice > 0 ? vialPrice : boxPerVial;

    // USD per-vial equivalents. A product's own `price_usd` is a *converted*
    // figure, so it only applies to the case price and only when this customer
    // converts — `productUsdPrice` enforces both.
    const boxPerVialUsd =
      productUsdPrice(
        { price: boxPrice, price_usd: product.price_usd, has_override: hasOverride },
        rate,
        convert,
      ) / PACK_OF_TEN;
    const singleVialUsd =
      Number.isFinite(vialPrice) && vialPrice > 0
        ? usdFromCad(vialPrice, rate)
        : boxPerVialUsd;

    return {
      id,
      packSize,
      name: product.name ?? '',
      price: round2(packSize === 1 ? singleVial : boxPerVial),
      priceUsd: round2(packSize === 1 ? singleVialUsd : boxPerVialUsd),
      available: true,
    };
  });

  return { currency, rate, convert, lines: priced };
}

/** Key a line by product + form, the way the cart itself identifies one. */
export function cartPriceKey(id: string, packSize: unknown): string {
  return `${id}__${normalizePackSize(packSize)}`;
}

/** The priced lines as a lookup keyed by {@link cartPriceKey}. */
export function cartPriceMap(pricing: CartPricing): Map<string, CartPricedLine> {
  return new Map(pricing.lines.map((l) => [cartPriceKey(l.id, l.packSize), l]));
}
