import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPuramassOrder,
  isPuramassPriceRejection,
  puramassChargedCents,
  toPuramassCurrency,
  PuramassApiError,
  PURAMASS_MAX_PRICE_CENTS,
  PURAMASS_PRICE_BELOW_WHOLESALE,
} from './puramass';

/**
 * The hand-off that mints a hosted-checkout link.
 *
 * What matters here is the money: an order may name its own amounts — a
 * per-line `unit_price_cents` and an order-level `shipping_total_cents` — and
 * whatever we send is what the customer is charged. So `0` has to survive as a
 * real value (that is how free shipping is asked for), an amount we cannot send
 * must fail loudly rather than fall back to PuraMass's catalog price, and the
 * API's own price rejections have to stay distinguishable from a transport
 * failure.
 */

const ORDER_RESPONSE = {
  order: {
    status: 'payment_pending',
    transaction_id: 'aBc123',
    payment_link: 'https://app.puramass.com/transaction/aBc123',
    subtotal_cents: 14900,
    shipping_total_cents: 0,
    total_cents: 14900,
    items: [],
  },
};

/** The JSON body of the last POST the client made. */
function lastRequestBody(fetchMock: any): any {
  const calls = fetchMock.mock.calls;
  return JSON.parse(calls[calls.length - 1][1].body);
}

function mockFetch(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn(async (_url: any, _init: any) => ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const CUSTOMER = { email: 'jane@example.com' };

beforeEach(() => {
  process.env.PURAMASS_API_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createPuramassOrder', () => {
  it('sends only sku + quantity when no prices are given', async () => {
    const fetchMock = mockFetch(ORDER_RESPONSE);
    await createPuramassOrder({
      items: [{ sku: 'puramass-nxgen-pen-2-10-pack', quantity: 1 }],
      customer: CUSTOMER,
      partnerReference: 'amc_1',
    });
    const body = lastRequestBody(fetchMock);
    expect(body.items).toEqual([{ sku: 'puramass-nxgen-pen-2-10-pack', quantity: 1 }]);
    expect('shipping_total_cents' in body).toBe(false);
    // No address — PuraMass collects it on the hosted page.
    expect('shipping' in body).toBe(false);
  });

  it('sends the prices it is given, per line and for shipping', async () => {
    const fetchMock = mockFetch(ORDER_RESPONSE);
    await createPuramassOrder({
      items: [
        { sku: 'puramass-magnesium-glycinate-10-pack', quantity: 2, unit_price_cents: 3200 },
        { sku: 'puramass-nxgen-pen-2-vial', quantity: 1, unit_price_cents: 14900 },
      ],
      customer: CUSTOMER,
      partnerReference: 'amc_2',
      shippingTotalCents: 1250,
    });
    const body = lastRequestBody(fetchMock);
    expect(body.items).toEqual([
      { sku: 'puramass-magnesium-glycinate-10-pack', quantity: 2, unit_price_cents: 3200 },
      { sku: 'puramass-nxgen-pen-2-vial', quantity: 1, unit_price_cents: 14900 },
    ]);
    expect(body.shipping_total_cents).toBe(1250);
  });

  it('sends a zero as a real amount — free shipping, and a free line', async () => {
    const fetchMock = mockFetch(ORDER_RESPONSE);
    await createPuramassOrder({
      items: [{ sku: 'puramass-bpc-157-5mg-vial', quantity: 1, unit_price_cents: 0 }],
      customer: CUSTOMER,
      partnerReference: 'amc_3',
      shippingTotalCents: 0,
    });
    const body = lastRequestBody(fetchMock);
    expect(body.items[0].unit_price_cents).toBe(0);
    expect(body.shipping_total_cents).toBe(0);
  });

  it('refuses a malformed amount instead of letting the catalog price stand', async () => {
    const fetchMock = mockFetch(ORDER_RESPONSE);
    const bad = [
      { unit_price_cents: -1 },
      { unit_price_cents: 32.5 },
      { unit_price_cents: PURAMASS_MAX_PRICE_CENTS + 1 },
    ];
    for (const override of bad) {
      await expect(
        createPuramassOrder({
          items: [{ sku: 'puramass-bpc-157-5mg-vial', quantity: 1, ...override }],
          customer: CUSTOMER,
          partnerReference: 'amc_4',
        }),
      ).rejects.toBeInstanceOf(PuramassApiError);
    }
    await expect(
      createPuramassOrder({
        items: [{ sku: 'puramass-bpc-157-5mg-vial', quantity: 1 }],
        customer: CUSTOMER,
        partnerReference: 'amc_4',
        shippingTotalCents: -1,
      }),
    ).rejects.toThrow(/shipping_total_cents/);
    // Nothing was handed to PuraMass — the order never left.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('carries the API error code so a price rejection can be told apart', async () => {
    mockFetch(
      {
        error: 'unit_price_cents 1200 is below the wholesale price 2400 for puramass-bpc-157-5mg-vial',
        code: PURAMASS_PRICE_BELOW_WHOLESALE,
      },
      false,
      400,
    );
    const err = await createPuramassOrder({
      items: [{ sku: 'puramass-bpc-157-5mg-vial', quantity: 1, unit_price_cents: 1200 }],
      customer: CUSTOMER,
      partnerReference: 'amc_5',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PuramassApiError);
    expect(err.code).toBe(PURAMASS_PRICE_BELOW_WHOLESALE);
    expect(isPuramassPriceRejection(err)).toBe(true);
    // The wholesale floor is in the detail for the admin log, never the customer.
    expect(err.message).toContain('wholesale');
  });

  it('does not mistake a transport failure for a price rejection', async () => {
    mockFetch({ error: 'Something broke' }, false, 500);
    const err = await createPuramassOrder({
      items: [{ sku: 'puramass-bpc-157-5mg-vial', quantity: 1 }],
      customer: CUSTOMER,
      partnerReference: 'amc_6',
    }).catch((e) => e);
    expect(isPuramassPriceRejection(err)).toBe(false);
  });

  it('reads the shipping and total back off the response', async () => {
    mockFetch(ORDER_RESPONSE);
    const order = await createPuramassOrder({
      items: [{ sku: 'puramass-nxgen-pen-2-10-pack', quantity: 1, unit_price_cents: 14900 }],
      customer: CUSTOMER,
      partnerReference: 'amc_7',
      shippingTotalCents: 0,
    });
    expect(order.payment_link).toBe(ORDER_RESPONSE.order.payment_link);
    expect(order.shipping_total_cents).toBe(0);
    expect(order.total_cents).toBe(14900);
  });

  // An order that names its own amounts has to name the currency too: without
  // it a CAD customer's `unit_price_cents: 15600` would be charged as USD.
  it('sends the currency the amounts are expressed in', async () => {
    const fetchMock = mockFetch(ORDER_RESPONSE);
    await createPuramassOrder({
      items: [{ sku: 'puramass-bpc-157-5mg-vial', quantity: 1, unit_price_cents: 15600 }],
      customer: CUSTOMER,
      partnerReference: 'amc_8',
      currency: 'cad',
      shippingTotalCents: 0,
    });
    expect(lastRequestBody(fetchMock).currency).toBe('cad');
  });

  it('omits the currency when none is named, leaving the API default in place', async () => {
    const fetchMock = mockFetch(ORDER_RESPONSE);
    await createPuramassOrder({
      items: [{ sku: 'puramass-bpc-157-5mg-vial', quantity: 1 }],
      customer: CUSTOMER,
      partnerReference: 'amc_9',
    });
    expect(lastRequestBody(fetchMock)).not.toHaveProperty('currency');
  });
});

describe('toPuramassCurrency', () => {
  it('normalises to the lower-case codes the API expects', () => {
    expect(toPuramassCurrency('USD')).toBe('usd');
    expect(toPuramassCurrency('usd')).toBe('usd');
    expect(toPuramassCurrency('CAD')).toBe('cad');
  });

  it('falls back to the base currency for anything unrecognised', () => {
    expect(toPuramassCurrency('eur')).toBe('cad');
    expect(toPuramassCurrency(null)).toBe('cad');
    expect(toPuramassCurrency(undefined)).toBe('cad');
  });
});

describe('puramassChargedCents', () => {
  it('prefers an explicit total', () => {
    expect(puramassChargedCents({ total_cents: 16150, subtotal_cents: 14900 })).toBe(16150);
    expect(puramassChargedCents({ amount_total_cents: 16150 })).toBe(16150);
  });

  it('adds the shipping the same payload reports when there is no total', () => {
    expect(puramassChargedCents({ subtotal_cents: 14900, shipping_total_cents: 1250 })).toBe(16150);
    expect(puramassChargedCents({ subtotal_cents: 14900, shipping_total_cents: 0 })).toBe(14900);
    expect(puramassChargedCents({ subtotal_cents: 14900 })).toBe(14900);
  });

  it('returns null when the payload names no amount, so it is never read as free', () => {
    expect(puramassChargedCents({ status: 'paid' })).toBeNull();
    expect(puramassChargedCents(null)).toBeNull();
  });
});
