/**
 * Derives an order's *shipping fulfillment* state for the admin orders list —
 * separate from the order `status` (pending/paid/…) which tracks payment.
 *
 * Three states drive the orders-page tag and the shipping filter:
 *  - `pickup`  — local pickup, no shipping label is ever needed.
 *  - `created` — an Easyship shipment record already exists for the order.
 *  - `none`    — a shippable order that still needs a shipment ("new" work).
 */
export type ShippingState = 'pickup' | 'created' | 'none';

/** Minimal shape needed to classify an order's shipping state. */
export interface ShippingStatusOrder {
  fulfillment_type?: string | null;
  /** Legacy flag used before `fulfillment_type` existed. */
  notes?: string | null;
  easyship_shipment_id?: string | null;
  tracking_number?: string | null;
}

/** True when the order is collected in person and never needs a label. */
export function isPickupOrder(order: ShippingStatusOrder): boolean {
  return order.fulfillment_type === 'pickup' || order.notes === 'PICKUP';
}

export function shippingState(order: ShippingStatusOrder): ShippingState {
  if (isPickupOrder(order)) return 'pickup';
  if (order.easyship_shipment_id) return 'created';
  return 'none';
}

const STATE_LABELS: Record<ShippingState, string> = {
  pickup: 'Pickup',
  created: 'Shipment',
  none: 'No shipment',
};

export function shippingStateLabel(state: ShippingState): string {
  return STATE_LABELS[state];
}

/**
 * Tailwind classes for the shipping tag badge: emerald once a shipment exists,
 * amber while one is still owed, neutral for pickup orders.
 */
export function shippingBadgeClasses(state: ShippingState): string {
  switch (state) {
    case 'created':
      return 'bg-emerald-500/10 text-emerald-500';
    case 'none':
      return 'bg-amber-500/10 text-amber-500';
    case 'pickup':
    default:
      return 'bg-surface text-ink-muted';
  }
}
