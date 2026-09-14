import {
  Clock,
  CheckCircle,
  Package,
  Truck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

export interface OrderStatusDisplay {
  /** Customer-friendly label (never a raw DB enum like "pending_invoice"). */
  label: string;
  /** Tailwind classes for the badge: text + bg + border. */
  color: string;
  /** Lucide icon component — each caller sizes it as needed. */
  Icon: LucideIcon;
}

// One source of truth for how an order status is presented to the customer,
// covering every value the order lifecycle can produce:
//   pending_invoice → received/confirmed/processing → shipped → delivered
//   plus the terminal expired / cancelled and the legacy pending / paid.
// Using this everywhere prevents raw enum leakage ("Pending_invoice"),
// unstyled badges (undefined color class), and an expired order rendering as
// "Pending".
const STATUS_MAP: Record<string, OrderStatusDisplay> = {
  pending_invoice: { label: 'Awaiting payment', color: 'text-amber-700 bg-amber-50 border-amber-100', Icon: Clock },
  pending: { label: 'Pending', color: 'text-amber-700 bg-amber-50 border-amber-100', Icon: Clock },
  received: { label: 'Payment received', color: 'text-cyan-700 bg-cyan-50 border-cyan-100', Icon: CheckCircle },
  confirmed: { label: 'Confirmed', color: 'text-blue-700 bg-blue-50 border-blue-100', Icon: CheckCircle },
  paid: { label: 'Paid', color: 'text-blue-700 bg-blue-50 border-blue-100', Icon: CheckCircle },
  processing: { label: 'Processing', color: 'text-purple-700 bg-purple-50 border-purple-100', Icon: Package },
  shipped: { label: 'Shipped', color: 'text-indigo-700 bg-indigo-50 border-indigo-100', Icon: Truck },
  delivered: { label: 'Delivered', color: 'text-emerald-700 bg-emerald-50 border-emerald-100', Icon: CheckCircle },
  expired: { label: 'Payment expired', color: 'text-red-700 bg-red-50 border-red-100', Icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'text-red-700 bg-red-50 border-red-100', Icon: XCircle },
};

function humanize(raw: string): string {
  if (!raw) return 'Unknown';
  return raw
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Resolve a status string to its customer-facing display, with a safe fallback. */
export function getOrderStatusDisplay(status: string | null | undefined): OrderStatusDisplay {
  const key = String(status ?? '').toLowerCase();
  return (
    STATUS_MAP[key] ?? {
      label: humanize(key),
      color: 'text-ink-muted bg-surface border-line',
      Icon: Clock,
    }
  );
}
