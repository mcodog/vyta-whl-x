import { describe, it, expect } from 'vitest';
import {
  isAllowedCourier,
  isBlockedCourier,
  applyHandlingFee,
  PURAMASS_CHECKOUT_COURIERS,
  type ShippingConfig,
} from './easyship';

/**
 * Checkout only offers FedEx and UPS. isAllowedCourier is the whitelist that
 * keeps every other courier (notably Canpar) out of the rate list — both what
 * the customer sees and what they're charged. Easyship groups services under an
 * `umbrella_name` ("UPS Standard®" → "UPS"), which is the primary match.
 */
describe('isAllowedCourier', () => {
  it('allows UPS and FedEx by umbrella_name (the real Easyship shape)', () => {
    expect(
      isAllowedCourier({ courier_service: { umbrella_name: 'UPS', name: 'UPS Standard®' } }),
    ).toBe(true);
    expect(
      isAllowedCourier({ courier_service: { umbrella_name: 'FedEx', name: 'FedEx Ground®' } }),
    ).toBe(true);
  });

  it('excludes Canpar and every other umbrella courier', () => {
    expect(isAllowedCourier({ courier_service: { umbrella_name: 'Canpar' } })).toBe(false);
    expect(isAllowedCourier({ courier_service: { umbrella_name: 'Canada Post' } })).toBe(false);
    expect(isAllowedCourier({ courier_service: { umbrella_name: 'Purolator' } })).toBe(false);
    expect(isAllowedCourier({ courier_service: { umbrella_name: 'DHL' } })).toBe(false);
  });

  it('matches umbrella_name case-insensitively', () => {
    expect(isAllowedCourier({ courier_service: { umbrella_name: 'ups' } })).toBe(true);
    expect(isAllowedCourier({ courier_service: { umbrella_name: 'FEDEX' } })).toBe(true);
  });

  it('falls back to the display name when umbrella_name is absent', () => {
    expect(isAllowedCourier({ courier_service_name: 'UPS Express Saver' })).toBe(true);
    expect(isAllowedCourier({ courier_name: 'FedEx Priority' })).toBe(true);
    expect(isAllowedCourier({ courier_service: { name: 'Canpar Ground' } })).toBe(false);
    // "ups" must be a standalone word, not a substring of another word.
    expect(isAllowedCourier({ courier_service: { name: 'Groupson Logistics' } })).toBe(false);
  });

  it('excludes unknown/empty shapes', () => {
    expect(isAllowedCourier({})).toBe(false);
    expect(isAllowedCourier(null)).toBe(false);
  });
});

/**
 * The PuraMass hosted checkout offers its own courier scope — UPS, FedEx and
 * Canada Post — without widening what the in-house checkout offers. The two
 * lists are deliberately separate: adding Canada Post to the shared allow-list
 * would have changed every existing flow.
 */
describe('isAllowedCourier — hosted-checkout scope', () => {
  const allowed = (rate: any) => isAllowedCourier(rate, PURAMASS_CHECKOUT_COURIERS);

  it('offers UPS, FedEx and Canada Post', () => {
    expect(allowed({ courier_service: { umbrella_name: 'UPS' } })).toBe(true);
    expect(allowed({ courier_service: { umbrella_name: 'FedEx' } })).toBe(true);
    expect(allowed({ courier_service: { umbrella_name: 'Canada Post' } })).toBe(true);
  });

  it('matches Canada Post by display name when umbrella_name is absent', () => {
    expect(allowed({ courier_service_name: 'Canada Post Expedited Parcel' })).toBe(true);
  });

  it('still excludes every other courier', () => {
    expect(allowed({ courier_service: { umbrella_name: 'Canpar' } })).toBe(false);
    expect(allowed({ courier_service: { umbrella_name: 'Purolator' } })).toBe(false);
    expect(allowed({ courier_service: { umbrella_name: 'DHL' } })).toBe(false);
  });

  it('keeps the deny-list winning over the wider scope', () => {
    expect(allowed({ courier_service: { umbrella_name: 'UniUni' } })).toBe(false);
  });

  it('leaves the in-house scope alone — Canada Post stays out of it', () => {
    expect(isAllowedCourier({ courier_service: { umbrella_name: 'Canada Post' } })).toBe(
      false,
    );
  });
});

/**
 * UniUni is hard-blocked everywhere: the deny-list takes precedence over the
 * allow-list, so it can never appear at checkout, in the admin invoice courier
 * picker, in the admin order rates, or be auto-selected for a shipment — every
 * path funnels through isAllowedCourier.
 */
describe('isBlockedCourier / UniUni block', () => {
  it('blocks UniUni by umbrella_name (case-insensitive)', () => {
    expect(isBlockedCourier({ courier_service: { umbrella_name: 'UniUni' } })).toBe(true);
    expect(isBlockedCourier({ courier_service: { umbrella_name: 'uniuni' } })).toBe(true);
    expect(isBlockedCourier({ courier_service: { umbrella_name: 'UNIUNI' } })).toBe(true);
  });

  it('blocks UniUni by display name when umbrella_name is absent', () => {
    expect(isBlockedCourier({ courier_service: { name: 'UniUni Standard' } })).toBe(true);
    expect(isBlockedCourier({ courier_service_name: 'UniUni' })).toBe(true);
    expect(isBlockedCourier({ courier_name: 'UniUni Express' })).toBe(true);
  });

  it('keeps UniUni out of the allowed set regardless of the allow-list', () => {
    expect(isAllowedCourier({ courier_service: { umbrella_name: 'UniUni' } })).toBe(false);
    expect(isAllowedCourier({ courier_service: { name: 'UniUni Standard' } })).toBe(false);
  });

  it('does not block UPS/FedEx', () => {
    expect(isBlockedCourier({ courier_service: { umbrella_name: 'UPS' } })).toBe(false);
    expect(isBlockedCourier({ courier_service: { umbrella_name: 'FedEx' } })).toBe(false);
  });
});

/**
 * applyHandlingFee folds the admin-configured packing/labour markup into the
 * live courier cost. It must never appear as a separate line — these tests pin
 * down the maths for both fee types.
 */
describe('applyHandlingFee', () => {
  const base = (overrides: Partial<ShippingConfig>): ShippingConfig =>
    ({ handlingFeeType: 'flat', handlingFeeValue: 0, ...overrides }) as ShippingConfig;

  it('returns the cost unchanged when no fee is configured', () => {
    expect(applyHandlingFee(18.26, base({ handlingFeeValue: 0 }))).toBe(18.26);
    expect(applyHandlingFee(18.26, base({ handlingFeeValue: -5 }))).toBe(18.26);
  });

  it('adds a flat fee', () => {
    expect(applyHandlingFee(18.26, base({ handlingFeeType: 'flat', handlingFeeValue: 5 }))).toBe(23.26);
  });

  it('adds a percentage fee, rounded to cents', () => {
    // 20.00 + 15% = 23.00
    expect(applyHandlingFee(20, base({ handlingFeeType: 'percent', handlingFeeValue: 15 }))).toBe(23);
    // 18.26 + 10% = 20.086 → 20.09
    expect(applyHandlingFee(18.26, base({ handlingFeeType: 'percent', handlingFeeValue: 10 }))).toBe(20.09);
  });
});
