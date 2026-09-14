/**
 * What a signed-in customer is charged at the PuraMass hosted checkout.
 *
 * SERVER-ONLY. The hosted checkout used to hand PuraMass bare SKUs and let it
 * price the order from its own USD catalog, which meant a customer's own
 * pricing — their price-list overrides and their billing currency — was thrown
 * away at the redirect. This module resolves, server-side, the same per-unit
 * amounts the storefront showed them, so the hosted page charges what they saw.
 *
 * The prices are re-derived from the database on every hand-off. A price sent
 * by the browser is never trusted: the cart is client state, and the amounts
 * here are what the customer actually pays.
 *
 * The arithmetic deliberately mirrors `components/AddToCartModal.tsx` (the
 * screen the price was quoted on) line for line — a single vial uses the
 * explicit `vial_price` when one is set, a vial inside a pack of ten is the
 * case price split ten ways, and the USD figures honour a product's `price_usd`
 * override unless the customer has a CAD override of their own. If that screen
 * ever changes, this has to change with it or the hosted page will quote a
 * different number than the tile did.
 *
 * That includes the per-customer conversion switch
 * (`customers.convert_storefront_prices`, default off): with it off the
 * configured figure is charged as-is and merely denominated in the customer's
 * currency, so a list configured at 156 is charged as 156 USD rather than
 * converted down to ~113. The storefront reads the same switch through
 * `CurrencyContext`.
 */

import {
  DEFAULT_USD_RATE,
  productUsdPrice,
  usdFromCad,
  type PriceCurrency,
} from '@/lib/pricing';
import { toPuramassCurrency, type PuramassCurrency } from '@/lib/payments/puramass';

/** Vials in a pack. Matches the storefront's own constant. */
const PACK_OF_TEN = 10;

type Db = {
  from: (table: string) => any;
};

/** One cart line as it reaches the server: a product, a form, a quantity. */
export interface CheckoutLine {
  /** Product id (`products.id`). */
  id: string;
  /** 1 for a single-vial line, 10 for a pack. */
  packSize: number;
  /** Total vials on this line (always a multiple of `packSize`). */
  quantity: number;
}

/** A line priced for the hand-off: a PuraMass SKU, a count, and an amount. */
export interface PricedLine {
  sku: string;
  /** Units of that SKU: vials for a vial SKU, packs for a case SKU. */
  quantity: number;
  /** What one unit of that SKU costs this customer, in whole cents. */
  unitPriceCents: number;
  /** Product name, for error messages and the ledger. */
  name: string;
}

export interface CustomerPricing {
  /** The customer's billing currency, as the partner API wants it. */
  currency: PuramassCurrency;
  /**
   * The store's real CAD→USD multiplier. Note this is the *store* rate, not
   * necessarily the one the line prices used: when {@link convert} is false the
   * configured figures are sent untouched. Callers still need the real rate for
   * amounts that are genuine CAD costs — the courier rate, customs values.
   */
  rate: number;
  /**
   * Whether this customer's configured prices were converted into `currency`.
   * False (the default) means the line amounts below ARE the configured
   * figures, merely denominated in `currency` — so a caller converting an
   * amount back to CAD must not divide by `rate`.
   */
  convert: boolean;
  lines: PricedLine[];
  /** Products with no usable PuraMass SKU for the form that was ordered. */
  unmapped: string[];
}

/**
 * A PuraMass mapping is usable only when it points at a real SKU of the right
 * form: a case ends `-case`, a single vial ends `-vial`. Legacy values (a bare
 * `bacteriostatic-water-10ml`, a stale `-10-pack`) are treated as unmapped
 * rather than handed to an API that would reject them.
 */
function usableSku(raw: unknown, isVial: boolean): string | null {
  const sku = typeof raw === 'string' ? raw.trim() : '';
  if (!sku.startsWith('puramass-')) return null;
  if (isVial ? !sku.endsWith('-vial') : !sku.endsWith('-case')) return null;
  return sku;
}

/** Round a money amount to whole cents. */
function cents(amount: number): number {
  return Math.round((Number(amount) || 0) * 100);
}

/**
 * The customer's billing currency and the exchange rate to reach it.
 *
 * Currency is the customer's own `price_currency` tag — the same one the
 * storefront reads to decide which figure to print on every tile — so an
 * anonymous/guest checkout falls back to CAD, the store's base currency.
 */
export async function getCustomerCurrency(
  db: Db,
  customerId: string | null,
): Promise<{ currency: PuramassCurrency; rate: number; convert: boolean }> {
  let currency: PriceCurrency = 'CAD';
  // Whether this customer's configured prices are converted into their billing
  // currency, or shown and charged as-is in it. Default (and the value read
  // from a database whose migration hasn't run) is as-is — see
  // customer-storefront-price-conversion-migration.sql.
  let convert = false;
  if (customerId) {
    try {
      const { data, error } = await db
        .from('customers')
        .select('price_currency, convert_storefront_prices')
        .eq('id', customerId)
        .maybeSingle();
      if (!error) {
        if (data?.price_currency === 'USD') currency = 'USD';
        convert = data?.convert_storefront_prices === true;
      } else {
        // Column missing — read the currency on its own so billing currency
        // still works, and leave conversion off.
        const { data: legacy } = await db
          .from('customers')
          .select('price_currency')
          .eq('id', customerId)
          .maybeSingle();
        if (legacy?.price_currency === 'USD') currency = 'USD';
      }
    } catch {
      /* keep CAD, no conversion */
    }
  }

  let rate = DEFAULT_USD_RATE;
  try {
    const { data } = await db
      .from('site_settings')
      .select('usd_exchange_rate')
      .maybeSingle();
    const n = Number(data?.usd_exchange_rate);
    if (Number.isFinite(n) && n > 0) rate = n;
  } catch {
    /* keep the default rate */
  }

  return { currency: toPuramassCurrency(currency), rate, convert };
}

/**
 * Price every cart line for this customer and map it to its PuraMass SKU.
 *
 * Lines that resolve to the same SKU are merged (a customer can reach the same
 * SKU twice); their quantity is summed and clamped to the API's 1–99 per-line
 * range. A product whose needed mapping is missing is reported in `unmapped`
 * rather than silently dropped — dropping it would ship a short order.
 *
 * Every amount comes out in `currency`, so it can be sent alongside the order's
 * `currency` field without a second conversion downstream.
 */
export async function priceCheckoutLines(
  db: Db,
  customerId: string | null,
  lines: CheckoutLine[],
): Promise<CustomerPricing> {
  const { currency, rate, convert } = await getCustomerCurrency(db, customerId);
  // The multiplier actually applied to a configured figure. 1 when this
  // customer's prices don't convert: their list is already denominated in their
  // billing currency, so 156 is charged as 156 — converting would quietly
  // discount every line.
  const priceRate = currency === 'usd' && !convert ? 1 : rate;
  const ids = Array.from(new Set(lines.map((l) => l.id)));

  // Catalog rows. Read the vial-SKU column behind a fallback so a database that
  // hasn't run `puramass-vial-sku-migration.sql` still checks out packs.
  const COLS = 'id, name, price, price_usd, vial_price, puramass_sku, puramass_sku_vial';
  const LEGACY_COLS = 'id, name, price, price_usd, vial_price, puramass_sku';
  let products: any[] = [];
  {
    const full = await db.from('products').select(COLS).in('id', ids);
    if (full.error) {
      const base = await db.from('products').select(LEGACY_COLS).in('id', ids);
      if (base.error) throw new Error('Could not load products');
      products = base.data ?? [];
    } else {
      products = full.data ?? [];
    }
  }

  // The customer's own price list, layered over the catalog exactly as
  // `/api/products?customer_id=` does for the storefront.
  const overrides = new Map<string, { price: number | null; vial: number | null }>();
  if (customerId) {
    try {
      const { data } = await db
        .from('customer_price_overrides')
        .select('product_id, override_price, vial_override_price')
        .eq('customer_id', customerId);
      for (const o of data ?? []) {
        overrides.set(o.product_id as string, {
          price: o.override_price != null ? Number(o.override_price) : null,
          vial: o.vial_override_price != null ? Number(o.vial_override_price) : null,
        });
      }
    } catch {
      // No override table/row — the catalog price stands, which is the same
      // price the storefront would have shown without overrides.
    }
  }

  const byId = new Map<string, any>();
  for (const p of products) byId.set(p.id as string, p);

  const bySku = new Map<string, PricedLine>();
  const unmapped: string[] = [];

  for (const line of lines) {
    const product = byId.get(line.id);
    const isVial = line.packSize === 1;
    const label = product?.name || line.id;
    const sku = usableSku(
      isVial ? product?.puramass_sku_vial : product?.puramass_sku,
      isVial,
    );
    if (!product || !sku) {
      unmapped.push(isVial ? `${label} (single vial)` : label);
      continue;
    }

    // The effective product for this customer: their override wins over the
    // catalog figure, and `hasOverride` tells the USD helper to derive from the
    // (overridden) CAD price rather than a now-stale catalog `price_usd`.
    const ovr = overrides.get(line.id);
    const casePriceCad = ovr?.price != null ? ovr.price : Number(product.price) || 0;
    const rawVialPrice = ovr?.vial != null ? ovr.vial : product.vial_price;
    const vialOverride =
      rawVialPrice != null && Number(rawVialPrice) > 0 ? Number(rawVialPrice) : null;
    const hasOverride = ovr?.price != null || ovr?.vial != null;

    // The case price in the customer's currency, and the per-vial price derived
    // from it — the two amounts the storefront quotes.
    const caseAmount =
      currency === 'usd'
        ? productUsdPrice(
            { price: casePriceCad, price_usd: product.price_usd, has_override: hasOverride },
            priceRate,
            convert,
          )
        : casePriceCad;
    const vialAmount = vialOverride
      ? currency === 'usd'
        ? usdFromCad(vialOverride, priceRate)
        : vialOverride
      : caseAmount / PACK_OF_TEN;

    // A vial line is priced and counted per vial; a case line per pack.
    const units = isVial
      ? Math.round(line.quantity)
      : Math.round(line.quantity / PACK_OF_TEN);
    const unitPriceCents = cents(isVial ? vialAmount : caseAmount);

    const existing = bySku.get(sku);
    const quantity = Math.max(1, Math.min(99, (existing?.quantity ?? 0) + units));
    bySku.set(sku, { sku, quantity, unitPriceCents, name: label });
  }

  return { currency, rate, convert, lines: Array.from(bySku.values()), unmapped };
}

/** The order's item subtotal in cents, for the ledger and the summary. */
export function subtotalCents(lines: PricedLine[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
}

/**
 * The cart restated for Easyship: a quantity and a declared value per line, in
 * the store's base currency (CAD), which is what rates and customs are quoted
 * against.
 *
 * Getting back to CAD depends on how the line was priced. A converted USD
 * amount divides by the rate. An UNCONVERTED one must not: those cents are the
 * configured figure itself, so dividing would understate the parcel's value by
 * the exchange rate — cheap insurance and a wrong customs declaration.
 */
export function declaredValueItems(
  pricing: CustomerPricing,
): Array<{ quantity: number; declaredValue: number }> {
  return pricing.lines.map((l) => {
    const dollars = (l.unitPriceCents * l.quantity) / 100;
    const needsUnconverting =
      pricing.currency === 'usd' && pricing.convert && pricing.rate > 0;
    return {
      quantity: l.quantity,
      declaredValue: needsUnconverting ? dollars / pricing.rate : dollars,
    };
  });
}
