import { isPickupOrder, type ShippingStatusOrder } from './shippingStatus';

/**
 * Recovers an order's financial breakdown for display. Orders don't persist a
 * separate shipping figure — the live Easyship rate (or $0 for pickup) was
 * folded into `total` at checkout — so shipping is recovered as the difference
 * between the charged total and the discounted product subtotal. This mirrors
 * how the invoice generator derives shipping (see lib/admin/invoices.ts), so the
 * admin order view and the invoice always agree. Never returns the old flat $20.
 */
export interface OrderTotalsOrder extends ShippingStatusOrder {
  total?: number | null;
  discount_amount?: number | null;
}

export interface OrderTotalsItem {
  quantity?: number | null;
  price_at_time?: number | null;
  price?: number | null;
}

export interface OrderTotals {
  /** Product subtotal before any affiliate discount. */
  rawSubtotal: number;
  /** Affiliate discount applied to the subtotal. */
  discount: number;
  /** Product subtotal after discount (what the email/invoice call "subtotal"). */
  discountedSubtotal: number;
  /** Shipping actually charged: 0 for pickup, otherwise total − discounted subtotal. */
  shipping: number;
  /** The charged order total. */
  total: number;
}

export function deriveOrderTotals(
  order: OrderTotalsOrder,
  items: OrderTotalsItem[] | null | undefined,
): OrderTotals {
  const rawSubtotal = (items ?? []).reduce(
    (sum, item) =>
      sum + Number(item.price_at_time ?? item.price ?? 0) * Number(item.quantity || 0),
    0,
  );
  const discount = Math.max(0, Number(order.discount_amount || 0));
  const total = Number(order.total || 0);
  const discountedSubtotal = Math.max(0, Number((rawSubtotal - discount).toFixed(2)));
  const shipping = isPickupOrder(order)
    ? 0
    : Math.max(0, Number((total - discountedSubtotal).toFixed(2)));

  return { rawSubtotal, discount, discountedSubtotal, shipping, total };
}
