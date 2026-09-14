import { beforeEach, describe, expect, it } from 'vitest';
import {
  assessInvoiceSkuLock,
  assessPaymentRequestReadiness,
  checkoutShippingTotalCents,
  invoiceAmountCents,
  resolveInvoicePuramassLines,
  UNMAPPED_SKUS_WARNING,
  SKU_LOCK_CODE,
} from './invoice-payment';

/**
 * The pre-flight an admin's "Request Payment" runs before a link goes out.
 *
 * Three failures motivate it, and the whole point is that they are treated
 * differently: a missing customer email dead-ends the PuraMass card hand-off
 * with nothing the customer can do (blocker); an *empty* `puramass_sku` /
 * `puramass_sku_vial` on the column a line actually needs locks the link
 * outright (blocker); and a malformed SKU or an unlinked line merely hides the
 * card option and leaves crypto working (overridable warning).
 */

type Row = Record<string, any>;

interface FakeData {
  settings?: Row | null;
  lineItems?: Row[];
  products?: Row[];
}

/**
 * The narrow slice of the Supabase client these helpers use: a chain that is
 * awaited directly (`.select().eq()`) or terminated with `.single()`.
 */
function fakeDb({ settings = {}, lineItems = [], products = [] }: FakeData = {}): any {
  return {
    from(table: string) {
      const result =
        table === 'site_settings'
          ? { data: settings, error: settings ? null : { message: 'no row' } }
          : table === 'invoice_line_items'
            ? { data: lineItems, error: null }
            : { data: products, error: null };
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        single: async () => result,
        maybeSingle: async () => result,
        then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
      };
      return chain;
    },
  };
}

const CRYPTO_ON = {
  payment_crypto_enabled: true,
  crypto_wallets: [
    { id: 'w1', label: 'USDT (TRC-20)', address: 'T-address', enabled: true },
  ],
};

/** A box line and a vial line, both mapped to real-shaped catalog SKUs. */
const MAPPED = {
  lineItems: [
    {
      description: 'Retatrutide 10mg',
      qty: 2,
      price_type: 'box',
      product_id: 'p1',
      unit_price: 149,
      line_total: 298,
    },
    {
      description: 'BPC-157 5mg',
      qty: 3,
      price_type: 'vial',
      product_id: 'p2',
      unit_price: 32,
      line_total: 96,
    },
  ],
  products: [
    {
      id: 'p1',
      name: 'Retatrutide 10mg',
      puramass_sku: 'puramass-retatrutide-10mg-case',
      puramass_sku_vial: 'puramass-retatrutide-10mg-vial',
    },
    {
      id: 'p2',
      name: 'BPC-157 5mg',
      puramass_sku: 'puramass-bpc-157-5mg-case',
      puramass_sku_vial: 'puramass-bpc-157-5mg-vial',
    },
  ],
};

beforeEach(() => {
  // `isPuramassConfigured()` gates the card option on real credentials.
  process.env.PURAMASS_API_KEY = 'test-key';
});

describe('resolveInvoicePuramassLines', () => {
  it('maps box lines to puramass_sku and vial lines to puramass_sku_vial', async () => {
    const r = await resolveInvoicePuramassLines(fakeDb(MAPPED), 'inv1');
    expect(r.unmapped).toEqual([]);
    expect(r.lines).toEqual([
      { sku: 'puramass-retatrutide-10mg-case', quantity: 2, unit_price_cents: 14900 },
      { sku: 'puramass-bpc-157-5mg-vial', quantity: 3, unit_price_cents: 3200 },
    ]);
  });

  it('prices a line off its line_total, so a per-line discount is charged', async () => {
    const r = await resolveInvoicePuramassLines(
      fakeDb({
        ...MAPPED,
        lineItems: [
          {
            description: 'Retatrutide 10mg',
            qty: 2,
            price_type: 'box',
            product_id: 'p1',
            unit_price: 149,
            discount_pct: 10,
            line_total: 268.2,
          },
        ],
      }),
      'inv1',
    );
    expect(r.lines).toEqual([
      { sku: 'puramass-retatrutide-10mg-case', quantity: 2, unit_price_cents: 13410 },
    ]);
  });

  it('falls back to the unit price and discount when no line_total is stored', async () => {
    const r = await resolveInvoicePuramassLines(
      fakeDb({
        ...MAPPED,
        lineItems: [
          {
            description: 'Retatrutide 10mg',
            qty: 2,
            price_type: 'box',
            product_id: 'p1',
            unit_price: 149,
            discount_pct: 50,
            line_total: 0,
          },
        ],
      }),
      'inv1',
    );
    expect(r.lines).toEqual([
      { sku: 'puramass-retatrutide-10mg-case', quantity: 2, unit_price_cents: 7450 },
    ]);
  });

  it('merges two lines on one SKU at the price their quantities imply', async () => {
    const r = await resolveInvoicePuramassLines(
      fakeDb({
        ...MAPPED,
        lineItems: [
          {
            description: 'Retatrutide 10mg',
            qty: 1,
            price_type: 'box',
            product_id: 'p1',
            unit_price: 150,
            line_total: 150,
          },
          {
            description: 'Retatrutide 10mg (repeat)',
            qty: 3,
            price_type: 'box',
            product_id: 'p1',
            unit_price: 100,
            line_total: 300,
          },
        ],
      }),
      'inv1',
    );
    // (150 + 3 × 100) / 4 units = $112.50 each.
    expect(r.lines).toEqual([
      { sku: 'puramass-retatrutide-10mg-case', quantity: 4, unit_price_cents: 11250 },
    ]);
  });

  it('keeps the unit price intact when a huge quantity is clamped to 99', async () => {
    const r = await resolveInvoicePuramassLines(
      fakeDb({
        ...MAPPED,
        lineItems: [
          {
            description: 'BPC-157 5mg',
            qty: 250,
            price_type: 'vial',
            product_id: 'p2',
            unit_price: 32,
            line_total: 8000,
          },
        ],
      }),
      'inv1',
    );
    expect(r.lines).toEqual([
      { sku: 'puramass-bpc-157-5mg-vial', quantity: 99, unit_price_cents: 3200 },
    ]);
  });

  it('reports a null puramass_sku as missing_sku on the box column', async () => {
    const r = await resolveInvoicePuramassLines(
      fakeDb({
        lineItems: [{ description: 'Custom blend', qty: 1, price_type: 'box', product_id: 'p1' }],
        products: [{ id: 'p1', name: 'Custom blend', puramass_sku: null, puramass_sku_vial: null }],
      }),
      'inv1',
    );
    expect(r.lines).toEqual([]);
    expect(r.unmappedDetails).toEqual([
      { label: 'Custom blend', reason: 'missing_sku', field: 'puramass_sku' },
    ]);
  });

  it('reports a null puramass_sku_vial on the vial column, labelled as a vial', async () => {
    const r = await resolveInvoicePuramassLines(
      fakeDb({
        lineItems: [{ description: 'Tesamorelin 10mg', qty: 1, price_type: 'vial', product_id: 'p1' }],
        // The box SKU is set — a vial line must not silently fall back to it.
        products: [
          {
            id: 'p1',
            name: 'Tesamorelin 10mg',
            puramass_sku: 'puramass-tesamorelin-10mg-case',
            puramass_sku_vial: null,
          },
        ],
      }),
      'inv1',
    );
    expect(r.unmappedDetails).toEqual([
      { label: 'Tesamorelin 10mg (single vial)', reason: 'missing_sku', field: 'puramass_sku_vial' },
    ]);
  });

  it('distinguishes an unlinked line from a malformed SKU', async () => {
    const r = await resolveInvoicePuramassLines(
      fakeDb({
        lineItems: [
          { description: 'Shipping surcharge', qty: 1, price_type: 'box', product_id: null },
          { description: 'Legacy item', qty: 1, price_type: 'box', product_id: 'p2' },
        ],
        products: [{ id: 'p2', name: 'Legacy item', puramass_sku: 'sku-12345' }],
      }),
      'inv1',
    );
    expect(r.unmappedDetails.map((u) => u.reason)).toEqual(['no_product', 'invalid_sku']);
  });

  it('rejects a stale `-10-pack` box SKU — PuraMass case SKUs end `-case`', async () => {
    const r = await resolveInvoicePuramassLines(
      fakeDb({
        lineItems: [{ description: 'Retatrutide 10mg', qty: 1, price_type: 'box', product_id: 'p1' }],
        products: [
          { id: 'p1', name: 'Retatrutide 10mg', puramass_sku: 'puramass-retatrutide-10mg-10-pack' },
        ],
      }),
      'inv1',
    );
    // Flagged for a re-sync rather than handed to PuraMass, which would reject it.
    expect(r.lines).toEqual([]);
    expect(r.unmappedDetails.map((u) => u.reason)).toEqual(['invalid_sku']);
  });
});

describe('assessPaymentRequestReadiness', () => {
  it('blocks an invoice with no customer email', async () => {
    const r = await assessPaymentRequestReadiness(fakeDb(MAPPED), {
      id: 'inv1',
      customer_email: null,
    });
    expect(r.blockers.map((b) => b.code)).toEqual(['missing_email']);
    expect(r.customerEmail).toBeNull();
    expect(r.invoiceHasEmail).toBe(false);
  });

  it('blocks a malformed address rather than sending into a void', async () => {
    const r = await assessPaymentRequestReadiness(fakeDb(MAPPED), {
      id: 'inv1',
      customer_email: 'not-an-email',
    });
    expect(r.blockers.map((b) => b.code)).toEqual(['invalid_email']);
  });

  it('accepts the recipient the admin is about to send to', async () => {
    const r = await assessPaymentRequestReadiness(
      fakeDb(MAPPED),
      { id: 'inv1', customer_email: null },
      { recipient: ' buyer@example.com ' },
    );
    expect(r.blockers).toEqual([]);
    expect(r.customerEmail).toBe('buyer@example.com');
    // Still false — the caller has to persist it before the link goes out.
    expect(r.invoiceHasEmail).toBe(false);
  });

  it('is clean when every line maps and an email is on file', async () => {
    const r = await assessPaymentRequestReadiness(fakeDb(MAPPED), {
      id: 'inv1',
      customer_email: 'buyer@example.com',
    });
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.cardAvailable).toBe(true);
  });

  it('warns — but does not block — on a line with a malformed SKU', async () => {
    const r = await assessPaymentRequestReadiness(
      fakeDb({
        settings: CRYPTO_ON,
        lineItems: [
          { description: 'Retatrutide 10mg', qty: 1, price_type: 'box', product_id: 'p1' },
          { description: 'Custom blend', qty: 1, price_type: 'box', product_id: 'p2' },
        ],
        products: [
          {
            id: 'p1',
            name: 'Retatrutide 10mg',
            puramass_sku: 'puramass-retatrutide-10mg-case',
            puramass_sku_vial: 'puramass-retatrutide-10mg-vial',
          },
          // Present but not a catalog SKU. An *empty* column would lock the
          // invoice outright; a malformed one stays the overridable warning.
          { id: 'p2', name: 'Custom blend', puramass_sku: 'sku-12345' },
        ],
      }),
      { id: 'inv1', customer_email: 'buyer@example.com' },
    );
    expect(r.blockers).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual([UNMAPPED_SKUS_WARNING]);
    expect(r.warnings[0].message).toContain('Custom blend');
    expect(r.warnings[0].message).toContain('only pay by crypto');
    expect(r.cardAvailable).toBe(false);
    expect(r.cryptoAvailable).toBe(true);
    expect(r.unmapped).toHaveLength(1);
  });

  it('spells out that there is no way to pay when crypto is off too', async () => {
    const r = await assessPaymentRequestReadiness(
      fakeDb({
        settings: { payment_crypto_enabled: false },
        lineItems: [{ description: 'Custom blend', qty: 1, price_type: 'box', product_id: 'p1' }],
        products: [{ id: 'p1', name: 'Custom blend', puramass_sku: 'sku-12345' }],
      }),
      { id: 'inv1', customer_email: 'buyer@example.com' },
    );
    expect(r.cryptoAvailable).toBe(false);
    expect(r.warnings[0].message).toContain('no way to pay');
  });

  it('stays quiet about SKUs when card payment is turned off site-wide', async () => {
    const r = await assessPaymentRequestReadiness(
      fakeDb({
        settings: { ...CRYPTO_ON, payment_card_enabled: false },
        lineItems: [{ description: 'Custom blend', qty: 1, price_type: 'box', product_id: 'p1' }],
        products: [{ id: 'p1', name: 'Custom blend', puramass_sku: 'sku-12345' }],
      }),
      { id: 'inv1', customer_email: 'buyer@example.com' },
    );
    expect(r.warnings).toEqual([]);
    expect(r.cardAvailable).toBe(false);
  });
});

describe('assessInvoiceSkuLock', () => {
  it('does not lock when every line has the column it needs', async () => {
    const lock = await assessInvoiceSkuLock(fakeDb(MAPPED), 'inv1');
    expect(lock).toEqual({ locked: false, products: [] });
  });

  it('locks a vial line whose product has no puramass_sku_vial', async () => {
    const lock = await assessInvoiceSkuLock(
      fakeDb({
        lineItems: [
          { description: 'Retatrutide 10mg', price_type: 'vial', product_id: 'p1' },
          { description: 'Tesamorelin 10mg', price_type: 'vial', product_id: 'p2' },
        ],
        products: [
          { id: 'p1', name: 'Retatrutide 10mg', puramass_sku_vial: 'puramass-retatrutide-10mg-vial' },
          {
            id: 'p2',
            name: 'Tesamorelin 10mg',
            puramass_sku: 'puramass-tesamorelin-10mg-case',
            puramass_sku_vial: null,
          },
        ],
      }),
      'inv1',
    );
    expect(lock.locked).toBe(true);
    expect(lock.products).toEqual([
      {
        productId: 'p2',
        label: 'Tesamorelin 10mg (single vial)',
        reason: 'missing_sku',
        field: 'puramass_sku_vial',
      },
    ]);
  });

  it('locks a box line whose product has no puramass_sku', async () => {
    const lock = await assessInvoiceSkuLock(
      fakeDb({
        lineItems: [{ description: 'Retatrutide 10mg', price_type: 'box', product_id: 'p1' }],
        // The vial SKU is set; the box line still cannot be fulfilled.
        products: [
          {
            id: 'p1',
            name: 'Retatrutide 10mg',
            puramass_sku: null,
            puramass_sku_vial: 'puramass-retatrutide-10mg-vial',
          },
        ],
      }),
      'inv1',
    );
    expect(lock.locked).toBe(true);
    expect(lock.products).toEqual([
      { productId: 'p1', label: 'Retatrutide 10mg', reason: 'missing_sku', field: 'puramass_sku' },
    ]);
  });

  /**
   * The regression this rule exists for. The general range (VIVI Cap, Omeva,
   * DHEA, Red Yeast Rice, …) has no single-vial SKU in the PuraMass catalog at
   * all, so judging it on `puramass_sku_vial` locked invoices over a column no
   * developer could ever fill in.
   */
  it('does NOT lock a box-only product that has no vial SKU', async () => {
    const lock = await assessInvoiceSkuLock(
      fakeDb({
        lineItems: [{ description: 'Omeva Complete', price_type: 'box', product_id: 'p1' }],
        products: [
          { id: 'p1', name: 'Omeva\u2122 Complete', puramass_sku: 'omeva-complete', puramass_sku_vial: null },
        ],
      }),
      'inv1',
    );
    expect(lock).toEqual({ locked: false, products: [] });
  });

  /** The mirror case: a vial-only product (a Retatrutide pen) has no case SKU. */
  it('does NOT lock a vial-only product that has no box SKU', async () => {
    const lock = await assessInvoiceSkuLock(
      fakeDb({
        lineItems: [{ description: 'Retatrutide 40mg Pen', price_type: 'vial', product_id: 'p1' }],
        products: [
          {
            id: 'p1',
            name: 'Retatrutide 40mg Pen',
            puramass_sku: null,
            puramass_sku_vial: 'puramass-retatrutide-40mg-pen-vial',
          },
        ],
      }),
      'inv1',
    );
    expect(lock).toEqual({ locked: false, products: [] });
  });

  it('judges a product sold both ways on each column separately', async () => {
    const lock = await assessInvoiceSkuLock(
      fakeDb({
        lineItems: [
          { description: 'Semaglutide 5mg', price_type: 'box', product_id: 'p1' },
          { description: 'Semaglutide 5mg', price_type: 'vial', product_id: 'p1' },
        ],
        // Box SKU present, vial SKU missing: only the vial line locks.
        products: [
          {
            id: 'p1',
            name: 'Semaglutide 5mg',
            puramass_sku: 'puramass-semaglutide-5mg-case',
            puramass_sku_vial: '   ',
          },
        ],
      }),
      'inv1',
    );
    expect(lock.locked).toBe(true);
    expect(lock.products.map((p) => p.field)).toEqual(['puramass_sku_vial']);
  });

  it('reports a product once per column, not once per line', async () => {
    const lock = await assessInvoiceSkuLock(
      fakeDb({
        lineItems: [
          { description: 'Custom blend', price_type: 'box', product_id: 'p1' },
          { description: 'Custom blend', price_type: 'box', product_id: 'p1' },
        ],
        products: [{ id: 'p1', name: 'Custom blend', puramass_sku: null }],
      }),
      'inv1',
    );
    expect(lock.products).toHaveLength(1);
  });

  it('ignores lines with no product — an ad-hoc charge cannot lock an invoice', async () => {
    const lock = await assessInvoiceSkuLock(
      fakeDb({
        lineItems: [
          { description: 'Shipping surcharge', price_type: 'box', product_id: null },
          { description: 'Handling', price_type: 'box', product_id: null },
        ],
        products: [],
      }),
      'inv1',
    );
    expect(lock).toEqual({ locked: false, products: [] });
  });

  it('locks when a linked product row has gone missing', async () => {
    const lock = await assessInvoiceSkuLock(
      fakeDb({
        lineItems: [{ description: 'Deleted item', price_type: 'box', product_id: 'gone' }],
        products: [],
      }),
      'inv1',
    );
    expect(lock.locked).toBe(true);
    expect(lock.products).toEqual([
      { productId: 'gone', label: 'Deleted item', reason: 'product_missing', field: null },
    ]);
  });

  it('leaves a malformed-but-present SKU to the overridable warning', async () => {
    const lock = await assessInvoiceSkuLock(
      fakeDb({
        lineItems: [{ description: 'Legacy item', price_type: 'box', product_id: 'p1' }],
        products: [{ id: 'p1', name: 'Legacy item', puramass_sku: 'sku-12345' }],
      }),
      'inv1',
    );
    expect(lock.locked).toBe(false);
  });
});

describe('assessPaymentRequestReadiness \u2014 SKU lock', () => {
  const LOCKED = {
    settings: CRYPTO_ON,
    lineItems: [{ description: 'Tesamorelin 10mg', qty: 1, price_type: 'vial', product_id: 'p1' }],
    products: [
      {
        id: 'p1',
        name: 'Tesamorelin 10mg',
        puramass_sku: 'puramass-tesamorelin-10mg-case',
        puramass_sku_vial: null,
      },
    ],
  };

  it('blocks the send and names the product and the column', async () => {
    const r = await assessPaymentRequestReadiness(fakeDb(LOCKED), {
      id: 'inv1',
      customer_email: 'buyer@example.com',
    });
    expect(r.blockers.map((b) => b.code)).toEqual([SKU_LOCK_CODE]);
    expect(r.blockers[0].message).toContain('Tesamorelin 10mg');
    expect(r.blockers[0].message).toContain('puramass_sku_vial');
    expect(r.blockers[0].message).toContain('Please contact developer.');
    expect(r.skuLock.locked).toBe(true);
  });

  it('takes crypto down with card — a locked link offers nothing', async () => {
    const r = await assessPaymentRequestReadiness(fakeDb(LOCKED), {
      id: 'inv1',
      customer_email: 'buyer@example.com',
    });
    expect(r.cardAvailable).toBe(false);
    expect(r.cryptoAvailable).toBe(false);
  });

  it('leads with the lock, not the softer unmapped-SKU warning', async () => {
    const r = await assessPaymentRequestReadiness(fakeDb(LOCKED), {
      id: 'inv1',
      customer_email: 'buyer@example.com',
    });
    expect(r.warnings).toEqual([]);
  });

  it('reports the lock alongside a missing email, lock first', async () => {
    const r = await assessPaymentRequestReadiness(fakeDb(LOCKED), {
      id: 'inv1',
      customer_email: null,
    });
    expect(r.blockers.map((b) => b.code)).toEqual([SKU_LOCK_CODE, 'missing_email']);
  });

  it('does not block a box-only product with no vial SKU', async () => {
    const r = await assessPaymentRequestReadiness(
      fakeDb({
        settings: CRYPTO_ON,
        lineItems: [{ description: 'DHEA 25MG', qty: 1, price_type: 'box', product_id: 'p1' }],
        products: [{ id: 'p1', name: 'DHEA 25MG', puramass_sku: 'dhea-25mg', puramass_sku_vial: null }],
      }),
      { id: 'inv1', customer_email: 'buyer@example.com' },
    );
    expect(r.blockers).toEqual([]);
    expect(r.skuLock.locked).toBe(false);
  });
});

describe('invoiceAmountCents', () => {
  it('converts an invoice dollar amount to whole cents', () => {
    expect(invoiceAmountCents(35)).toBe(3500);
    expect(invoiceAmountCents('12.34')).toBe(1234);
    // Binary floating point: 19.99 × 100 is 1998.9999… before rounding.
    expect(invoiceAmountCents(19.99)).toBe(1999);
  });

  it('reads no shipping, a negative, or junk as 0 — the free-shipping value', () => {
    expect(invoiceAmountCents(0)).toBe(0);
    expect(invoiceAmountCents(null)).toBe(0);
    expect(invoiceAmountCents(undefined)).toBe(0);
    expect(invoiceAmountCents(-5)).toBe(0);
    expect(invoiceAmountCents('free')).toBe(0);
  });
});

/**
 * What shipping the hosted checkout is told to charge.
 *
 * The default matters more than the opt-in: shipping is usually settled outside
 * the payment link, so an invoice that says nothing must send `0` rather than
 * quietly billing the fee a second time.
 */
describe('checkoutShippingTotalCents', () => {
  it('sends 0 unless the invoice opted in', () => {
    expect(checkoutShippingTotalCents({ shipping_cost: 35 })).toBe(0);
    expect(checkoutShippingTotalCents({ shipping_cost: 35, charge_shipping_on_checkout: false })).toBe(0);
    // A database that hasn't run the migration reads the same as "off".
    expect(checkoutShippingTotalCents({ shipping_cost: 35, charge_shipping_on_checkout: null })).toBe(0);
  });

  it('wires the invoice shipping in once it is ticked', () => {
    expect(checkoutShippingTotalCents({ shipping_cost: 35, charge_shipping_on_checkout: true })).toBe(3500);
    expect(checkoutShippingTotalCents({ shipping_cost: '19.99', charge_shipping_on_checkout: true })).toBe(1999);
  });

  it('is 0 when ticked on an invoice with no shipping to charge', () => {
    expect(checkoutShippingTotalCents({ shipping_cost: 0, charge_shipping_on_checkout: true })).toBe(0);
    expect(checkoutShippingTotalCents({ charge_shipping_on_checkout: true })).toBe(0);
  });

  it('does not take a truthy non-boolean as consent', () => {
    expect(checkoutShippingTotalCents({ shipping_cost: 35, charge_shipping_on_checkout: 'yes' })).toBe(0);
    expect(checkoutShippingTotalCents({ shipping_cost: 35, charge_shipping_on_checkout: 1 })).toBe(0);
  });
});
