import { describe, expect, it } from 'vitest';
import {
  applyProcessingFee,
  parseFulfillmentType,
  type PuramassShippingSettings,
} from './puramass-shipping';

/**
 * The processing fee added to every courier rate at the hosted checkout.
 *
 * It is the only markup in that flow — the global Easyship handling fee is
 * suppressed there — so it has to be right on its own. Two things matter: a
 * flat fee is configured in CAD and must follow the customer into their own
 * currency (a USD customer charged a flat CAD 5 should not pay USD 5), and a
 * percentage is a proportion of the rate, so it needs no conversion at all.
 */

const flat = (value: number): PuramassShippingSettings => ({
  enabled: true,
  feeType: 'flat',
  feeValue: value,
});
const percent = (value: number): PuramassShippingSettings => ({
  enabled: true,
  feeType: 'percent',
  feeValue: value,
});

describe('applyProcessingFee', () => {
  it('adds a flat fee to the rate', () => {
    expect(applyProcessingFee(20, flat(5))).toBe(25);
  });

  it('adds a percentage of the rate', () => {
    expect(applyProcessingFee(20, percent(10))).toBe(22);
  });

  it('leaves the rate alone when no fee is configured', () => {
    expect(applyProcessingFee(20, flat(0))).toBe(20);
    expect(applyProcessingFee(20, percent(0))).toBe(20);
  });

  it('converts a flat CAD fee for a USD customer', () => {
    // The rate is already in USD; only the CAD-configured fee converts.
    expect(applyProcessingFee(15, flat(5), { currency: 'usd', rate: 0.8 })).toBe(19);
  });

  it('does not convert a percentage fee — it is a proportion of the rate', () => {
    expect(applyProcessingFee(20, percent(10), { currency: 'usd', rate: 0.8 })).toBe(22);
  });

  it('rounds to cents rather than carrying fractions into the charge', () => {
    // 19.99 + 10% = 21.989 — the customer is charged 21.99, not 21.989.
    expect(applyProcessingFee(19.99, percent(10))).toBe(21.99);
  });

  it('treats a negative or non-finite fee as no fee', () => {
    expect(applyProcessingFee(20, flat(-5))).toBe(20);
    expect(applyProcessingFee(20, flat(Number.NaN))).toBe(20);
  });
});

/**
 * Reading the fulfillment a checkout request asked for.
 *
 * Pickup is the branch that sends `shipping_total_cents: 0` and skips both the
 * address and the courier, so it has to be entered deliberately: anything that
 * isn't the exact word must come out as a shipment, or a garbled request would
 * ship a parcel we charged nothing to send.
 */
describe('parseFulfillmentType', () => {
  it('reads an explicit pickup', () => {
    expect(parseFulfillmentType('pickup')).toBe('pickup');
  });

  it('reads an explicit shipment', () => {
    expect(parseFulfillmentType('shipment')).toBe('shipment');
  });

  it('treats anything else as a shipment', () => {
    expect(parseFulfillmentType(undefined)).toBe('shipment');
    expect(parseFulfillmentType(null)).toBe('shipment');
    expect(parseFulfillmentType('')).toBe('shipment');
    expect(parseFulfillmentType('Pickup')).toBe('shipment');
    expect(parseFulfillmentType(' pickup ')).toBe('shipment');
    expect(parseFulfillmentType(true)).toBe('shipment');
    expect(parseFulfillmentType({ pickup: true })).toBe('shipment');
  });
});
