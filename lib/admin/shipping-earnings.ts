/**
 * Shipping earnings — what the business bills (and collects) for shipping.
 *
 * The system never persists what a carrier actually charged us: Easyship rates
 * are quoted live at checkout, marked up by the handling fee, and folded into
 * the invoice's `shipping_cost`. So the honest figure here is GROSS shipping
 * revenue — everything billed on the shipping line, handling markup included —
 * not a carrier-cost margin. Every label in the UI says so.
 *
 * Collection is allocated proportionally: a half-paid invoice counts half of
 * its shipping line as collected. That keeps `collected` consistent with the
 * revenue book (which also caps payments at the invoice total) instead of
 * jumping only when an invoice flips to fully paid.
 *
 * Shared by the Analytics summary/report and the admin dashboard so the two
 * can never drift.
 */
import type {
  InvoiceCurrency,
  ShippingCurrencyEarnings,
  ShippingEarnings,
} from "@/lib/supabase";

/** The invoice projection this module needs — a subset of `invoices`. */
export interface ShippingEarningsInvoice {
  issue_date: string | null;
  total: number | string | null;
  shipping_cost: number | string | null;
  currency: string | null;
  payments?: Array<{ amount: number | string | null }> | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number): number => Number(n.toFixed(2));

const emptyCurrency = (): ShippingCurrencyEarnings => ({
  charged: 0,
  collected: 0,
  uncollected: 0,
  invoice_count: 0,
});

/**
 * Fraction of an invoice that has been paid, clamped to 0–1. Used to allocate
 * the shipping line between collected and uncollected.
 */
export function paidRatio(total: number, paid: number): number {
  if (total > 0) return Math.min(1, Math.max(0, paid / total));
  // A zero-total invoice can't be apportioned; treat any payment as full.
  return paid > 0 ? 1 : 0;
}

/**
 * Aggregate the shipping line across a set of revenue invoices. Amounts are
 * nominal — CAD and USD are summed together at the top level (matching the rest
 * of the analytics figures) and kept apart in `by_currency`.
 *
 * @param invoices Revenue invoices (drafts/cancelled must already be excluded).
 * @param invoicedRevenue Total invoiced across the same set, used for the
 *   share-of-revenue figure. Pass 0 to skip it.
 */
export function computeShippingEarnings(
  invoices: ShippingEarningsInvoice[],
  invoicedRevenue = 0,
): ShippingEarnings {
  let charged = 0;
  let collected = 0;
  let invoiceCount = 0;

  const byCurrency: Record<InvoiceCurrency, ShippingCurrencyEarnings> = {
    CAD: emptyCurrency(),
    USD: emptyCurrency(),
  };
  const months = new Map<string, { charged: number; collected: number }>();

  for (const inv of invoices) {
    const shipping = num(inv.shipping_cost);
    if (shipping <= 0) continue; // pickup / free shipping — nothing billed

    const total = num(inv.total);
    const paid = Math.min(
      (inv.payments ?? []).reduce((s, p) => s + num(p?.amount), 0),
      total,
    );
    const shipCollected = shipping * paidRatio(total, paid);

    charged += shipping;
    collected += shipCollected;
    invoiceCount += 1;

    // Invoices predating the currency column (null) are CAD, matching its default.
    const cur: InvoiceCurrency = inv.currency === "USD" ? "USD" : "CAD";
    const bucket = byCurrency[cur];
    bucket.charged += shipping;
    bucket.collected += shipCollected;
    bucket.invoice_count += 1;

    const monthKey = inv.issue_date ? inv.issue_date.slice(0, 7) : null;
    if (monthKey) {
      const m = months.get(monthKey) ?? { charged: 0, collected: 0 };
      m.charged += shipping;
      m.collected += shipCollected;
      months.set(monthKey, m);
    }
  }

  for (const cur of ["CAD", "USD"] as InvoiceCurrency[]) {
    const b = byCurrency[cur];
    b.charged = round2(b.charged);
    b.collected = round2(b.collected);
    b.uncollected = Math.max(0, round2(b.charged - b.collected));
  }

  return {
    charged: round2(charged),
    collected: round2(collected),
    uncollected: Math.max(0, round2(charged - collected)),
    invoice_count: invoiceCount,
    avg_per_invoice: invoiceCount > 0 ? round2(charged / invoiceCount) : 0,
    share_of_invoiced:
      invoicedRevenue > 0 ? round2((charged / invoicedRevenue) * 100) : 0,
    by_currency: byCurrency,
    monthly: Array.from(months.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, m]) => ({
        month,
        charged: round2(m.charged),
        collected: round2(m.collected),
      })),
  };
}
