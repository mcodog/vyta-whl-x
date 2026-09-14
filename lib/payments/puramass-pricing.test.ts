import { describe, expect, it } from 'vitest';
import { declaredValueItems, priceCheckoutLines, subtotalCents } from './puramass-pricing';

/**
 * What a signed-in customer is charged at the hosted checkout.
 *
 * The whole point of this module is that the hosted page charges what the
 * storefront quoted, so the tests are about agreement with that screen: a
 * customer's price-list override wins over the catalog, a USD customer is
 * billed in USD, a single vial is priced per vial while a pack is priced per
 * case, and a product we can't map is reported rather than quietly dropped from
 * an order the customer thinks they placed.
 */

/** A products/overrides/settings stub with just the query shapes used here. */
function makeDb(opts: {
  products?: any[];
  overrides?: any[];
  currency?: string;
  rate?: number;
  /** `customers.convert_storefront_prices` — default off, as in the database. */
  convert?: boolean;
}) {
  const {
    products = [],
    overrides = [],
    currency = 'CAD',
    rate = 0.75,
    convert = false,
  } = opts;
  return {
    from(table: string) {
      const result = (data: any) => ({ data, error: null });
      if (table === 'products') {
        return { select: () => ({ in: async () => result(products) }) };
      }
      if (table === 'customer_price_overrides') {
        return { select: () => ({ eq: async () => result(overrides) }) };
      }
      if (table === 'customers') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                result({
                  price_currency: currency,
                  convert_storefront_prices: convert,
                }),
            }),
          }),
        };
      }
      if (table === 'site_settings') {
        return {
          select: () => ({ maybeSingle: async () => result({ usd_exchange_rate: rate }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

/** A catalog product: a $150 case of ten, with no explicit vial price. */
const PRODUCT = {
  id: 'p1',
  name: 'Retatrutide 10mg',
  price: 150,
  price_usd: null,
  vial_price: null,
  puramass_sku: 'puramass-retatrutide-10mg-case',
  puramass_sku_vial: 'puramass-retatrutide-10mg-vial',
};

describe('priceCheckoutLines', () => {
  it('prices a pack line per case, in cents', async () => {
    const db = makeDb({ products: [PRODUCT] });
    const out = await priceCheckoutLines(db, null, [
      { id: 'p1', packSize: 10, quantity: 20 },
    ]);

    expect(out.currency).toBe('cad');
    expect(out.lines).toEqual([
      {
        sku: 'puramass-retatrutide-10mg-case',
        // 20 vials = 2 packs.
        quantity: 2,
        unitPriceCents: 15000,
        name: 'Retatrutide 10mg',
      },
    ]);
  });

  it('prices a single-vial line per vial, off the case price', async () => {
    const db = makeDb({ products: [PRODUCT] });
    const out = await priceCheckoutLines(db, null, [
      { id: 'p1', packSize: 1, quantity: 3 },
    ]);

    expect(out.lines[0].sku).toBe('puramass-retatrutide-10mg-vial');
    expect(out.lines[0].quantity).toBe(3);
    expect(out.lines[0].unitPriceCents).toBe(1500);
  });

  it("honours an explicit vial price over the case price split ten ways", async () => {
    const db = makeDb({ products: [{ ...PRODUCT, vial_price: 18 }] });
    const out = await priceCheckoutLines(db, null, [
      { id: 'p1', packSize: 1, quantity: 1 },
    ]);
    expect(out.lines[0].unitPriceCents).toBe(1800);
  });

  it("charges the customer's own override rather than the catalog price", async () => {
    const db = makeDb({
      products: [PRODUCT],
      overrides: [{ product_id: 'p1', override_price: 120, vial_override_price: null }],
    });
    const out = await priceCheckoutLines(db, 'cust-1', [
      { id: 'p1', packSize: 10, quantity: 10 },
    ]);
    expect(out.lines[0].unitPriceCents).toBe(12000);
  });

  it("derives the vial price from the customer's overridden case price", async () => {
    const db = makeDb({
      products: [PRODUCT],
      overrides: [{ product_id: 'p1', override_price: 120, vial_override_price: null }],
    });
    const out = await priceCheckoutLines(db, 'cust-1', [
      { id: 'p1', packSize: 1, quantity: 1 },
    ]);
    expect(out.lines[0].unitPriceCents).toBe(1200);
  });

  it("bills a USD customer in USD at the store's rate", async () => {
    const db = makeDb({ products: [PRODUCT], currency: 'USD', rate: 0.8, convert: true });
    const out = await priceCheckoutLines(db, 'cust-1', [
      { id: 'p1', packSize: 10, quantity: 10 },
    ]);
    expect(out.currency).toBe('usd');
    expect(out.lines[0].unitPriceCents).toBe(12000); // 150 × 0.8
  });

  it("uses a product's explicit USD price when the customer has no override", async () => {
    const db = makeDb({
      products: [{ ...PRODUCT, price_usd: 99 }],
      currency: 'USD',
      rate: 0.8,
      convert: true,
    });
    const out = await priceCheckoutLines(db, 'cust-1', [
      { id: 'p1', packSize: 10, quantity: 10 },
    ]);
    expect(out.lines[0].unitPriceCents).toBe(9900);
  });

  it("ignores a stale catalog USD price once the customer has a CAD override", async () => {
    // The catalog's price_usd was set against the $150 case; this customer pays
    // $120, so their USD price has to come from *their* price, not the stale one.
    const db = makeDb({
      products: [{ ...PRODUCT, price_usd: 99 }],
      overrides: [{ product_id: 'p1', override_price: 120, vial_override_price: null }],
      currency: 'USD',
      rate: 0.8,
      convert: true,
    });
    const out = await priceCheckoutLines(db, 'cust-1', [
      { id: 'p1', packSize: 10, quantity: 10 },
    ]);
    expect(out.lines[0].unitPriceCents).toBe(9600); // 120 × 0.8
  });

  it('reports an unmapped product instead of dropping it from the order', async () => {
    const db = makeDb({ products: [{ ...PRODUCT, puramass_sku: null }] });
    const out = await priceCheckoutLines(db, null, [
      { id: 'p1', packSize: 10, quantity: 10 },
    ]);
    expect(out.lines).toHaveLength(0);
    expect(out.unmapped).toEqual(['Retatrutide 10mg']);
  });

  it('rejects a legacy SKU of the wrong form rather than sending it', async () => {
    // A stale "-10-pack" case SKU is not something the partner API recognises.
    const db = makeDb({
      products: [{ ...PRODUCT, puramass_sku: 'puramass-retatrutide-10mg-10-pack' }],
    });
    const out = await priceCheckoutLines(db, null, [
      { id: 'p1', packSize: 10, quantity: 10 },
    ]);
    expect(out.lines).toHaveLength(0);
    expect(out.unmapped).toEqual(['Retatrutide 10mg']);
  });

  it('tags a missing vial mapping so the customer knows which form failed', async () => {
    const db = makeDb({ products: [{ ...PRODUCT, puramass_sku_vial: null }] });
    const out = await priceCheckoutLines(db, null, [
      { id: 'p1', packSize: 1, quantity: 2 },
    ]);
    expect(out.unmapped).toEqual(['Retatrutide 10mg (single vial)']);
  });

  it('merges two lines that resolve to the same SKU', async () => {
    const db = makeDb({ products: [PRODUCT] });
    const out = await priceCheckoutLines(db, null, [
      { id: 'p1', packSize: 10, quantity: 10 },
      { id: 'p1', packSize: 10, quantity: 20 },
    ]);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].quantity).toBe(3);
  });

  it("clamps a line to the API's 99-per-line ceiling", async () => {
    const db = makeDb({ products: [PRODUCT] });
    const out = await priceCheckoutLines(db, null, [
      { id: 'p1', packSize: 1, quantity: 500 },
    ]);
    expect(out.lines[0].quantity).toBe(99);
  });
});

/**
 * `customers.convert_storefront_prices` — the per-customer switch (default off).
 *
 * A price list negotiated in the customer's own currency is already denominated
 * in it: converting it a second time quietly discounts every line by the
 * exchange rate. With the switch off the configured figure is charged as-is and
 * merely labelled USD, and the declared value Easyship rates against must not
 * be "un-converted" either, or the parcel is under-insured and mis-declared.
 */
describe('priceCheckoutLines — charging configured prices as-is', () => {
  it('charges the configured figure unconverted, denominated in USD', async () => {
    const db = makeDb({ products: [PRODUCT], currency: 'USD', rate: 0.8 });
    const out = await priceCheckoutLines(db, 'cust-1', [
      { id: 'p1', packSize: 10, quantity: 10 },
    ]);

    expect(out.currency).toBe('usd');
    expect(out.convert).toBe(false);
    expect(out.lines[0].unitPriceCents).toBe(15000); // 150, NOT 150 × 0.8
  });

  it("charges the customer's own list figure as-is", async () => {
    const db = makeDb({
      products: [PRODUCT],
      overrides: [{ product_id: 'p1', override_price: 156, vial_override_price: null }],
      currency: 'USD',
      rate: 0.8,
    });
    const out = await priceCheckoutLines(db, 'cust-1', [
      { id: 'p1', packSize: 10, quantity: 10 },
    ]);
    expect(out.lines[0].unitPriceCents).toBe(15600);
  });

  it("ignores a product's catalog USD price, which is itself a converted figure", async () => {
    const db = makeDb({
      products: [{ ...PRODUCT, price_usd: 99 }],
      currency: 'USD',
      rate: 0.8,
    });
    const out = await priceCheckoutLines(db, 'cust-1', [
      { id: 'p1', packSize: 10, quantity: 10 },
    ]);
    expect(out.lines[0].unitPriceCents).toBe(15000);
  });

  it('derives an unconverted vial price the same way', async () => {
    const db = makeDb({
      products: [{ ...PRODUCT, vial_price: 18 }],
      currency: 'USD',
      rate: 0.8,
    });
    const out = await priceCheckoutLines(db, 'cust-1', [
      { id: 'p1', packSize: 1, quantity: 1 },
    ]);
    expect(out.lines[0].unitPriceCents).toBe(1800);
  });

  it('leaves a CAD customer untouched either way', async () => {
    for (const convert of [true, false]) {
      const db = makeDb({ products: [PRODUCT], currency: 'CAD', rate: 0.8, convert });
      const out = await priceCheckoutLines(db, 'cust-1', [
        { id: 'p1', packSize: 10, quantity: 10 },
      ]);
      expect(out.currency).toBe('cad');
      expect(out.lines[0].unitPriceCents).toBe(15000);
    }
  });

  it('does not convert for a guest, who has no customer record at all', async () => {
    const db = makeDb({ products: [PRODUCT], currency: 'USD', rate: 0.8 });
    const out = await priceCheckoutLines(db, null, [
      { id: 'p1', packSize: 10, quantity: 10 },
    ]);
    // No customer id → no currency tag to read → the base currency.
    expect(out.currency).toBe('cad');
    expect(out.convert).toBe(false);
  });
});

describe('declaredValueItems', () => {
  it('un-converts a converted USD amount back to CAD for customs', async () => {
    const db = makeDb({ products: [PRODUCT], currency: 'USD', rate: 0.8, convert: true });
    const pricing = await priceCheckoutLines(db, 'cust-1', [
      { id: 'p1', packSize: 10, quantity: 10 },
    ]);
    // 150 × 0.8 = 120 USD charged; back to CAD that is 150.
    expect(declaredValueItems(pricing)).toEqual([{ quantity: 1, declaredValue: 150 }]);
  });

  it('leaves an unconverted amount alone — those cents are already the CAD figure', async () => {
    const db = makeDb({ products: [PRODUCT], currency: 'USD', rate: 0.8 });
    const pricing = await priceCheckoutLines(db, 'cust-1', [
      { id: 'p1', packSize: 10, quantity: 10 },
    ]);
    // Dividing by 0.8 here would declare 187.50 for a 150 parcel.
    expect(declaredValueItems(pricing)).toEqual([{ quantity: 1, declaredValue: 150 }]);
  });

  it('passes a CAD order straight through', async () => {
    const db = makeDb({ products: [PRODUCT] });
    const pricing = await priceCheckoutLines(db, null, [
      { id: 'p1', packSize: 10, quantity: 20 },
    ]);
    expect(declaredValueItems(pricing)).toEqual([{ quantity: 2, declaredValue: 300 }]);
  });
});

describe('subtotalCents', () => {
  it('sums unit price × quantity across the lines', () => {
    expect(
      subtotalCents([
        { sku: 'a', quantity: 2, unitPriceCents: 15000, name: 'A' },
        { sku: 'b', quantity: 3, unitPriceCents: 1500, name: 'B' },
      ]),
    ).toBe(34500);
  });
});
