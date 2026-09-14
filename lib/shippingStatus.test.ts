import { describe, it, expect } from 'vitest';
import { shippingState, isPickupOrder } from './shippingStatus';

/**
 * The orders list tags each order by shipping state. Pickup wins over
 * everything (no label is ever needed); otherwise an Easyship shipment id is
 * what flips an order from "needs shipment" to "shipment created".
 */
describe('shippingState', () => {
  it('classifies pickup orders regardless of shipment data', () => {
    expect(shippingState({ fulfillment_type: 'pickup' })).toBe('pickup');
    expect(shippingState({ notes: 'PICKUP' })).toBe('pickup');
    // Pickup takes precedence even if a stray shipment id is present.
    expect(
      shippingState({ fulfillment_type: 'pickup', easyship_shipment_id: 'ESHIP123' }),
    ).toBe('pickup');
  });

  it('is "created" once an Easyship shipment exists', () => {
    expect(shippingState({ easyship_shipment_id: 'ESHIP123' })).toBe('created');
  });

  it('is "none" for a shippable order with no shipment yet', () => {
    expect(shippingState({})).toBe('none');
    expect(shippingState({ fulfillment_type: 'shipment', easyship_shipment_id: null })).toBe('none');
  });
});

describe('isPickupOrder', () => {
  it('recognises both the modern flag and the legacy notes marker', () => {
    expect(isPickupOrder({ fulfillment_type: 'pickup' })).toBe(true);
    expect(isPickupOrder({ notes: 'PICKUP' })).toBe(true);
    expect(isPickupOrder({ fulfillment_type: 'shipment' })).toBe(false);
    expect(isPickupOrder({})).toBe(false);
  });
});
