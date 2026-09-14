// Purchase-order landed cost
// ===========================
// A line's supplier `unit_price` isn't the true cost of getting that product
// into inventory — order-level shipping and discounts belong to it too. The
// landed unit cost folds each line's share of shipping and discount back into
// the per-unit price, giving the real cost basis for COGS / margin.
//
// Allocation is by value: a line absorbs shipping and discount in proportion to
// its share of the order subtotal (the accounting-standard method, and
// consistent with how a percentage discount already works). The shares always
// sum back to the order's shipping and discount, so the landed line totals
// reconcile to `subtotal + shipping - discount`.
//
// This is a pure function with no I/O so the form, the API routes, and the PDF
// can all share one source of truth and never disagree.

/** The minimal per-line shape the landed-cost math needs. */
export interface LandedCostLineInput {
  qty: number;
  unit_price: number;
}

export interface LandedCostLine {
  /** Raw line subtotal: qty × unit_price. */
  lineSubtotal: number;
  /** This line's share of the order-level shipping fee (≥ 0). */
  shippingShare: number;
  /** This line's share of the order-level discount (≥ 0). */
  discountShare: number;
  /** lineSubtotal + shippingShare − discountShare. */
  landedLineTotal: number;
  /** landedLineTotal ÷ qty — the effective per-unit cost. */
  landedUnitCost: number;
}

export interface LandedCostInput {
  lines: LandedCostLineInput[];
  /** Order-level shipping fee (flat dollars). */
  shippingFee: number;
  /**
   * The already-computed discount **dollar amount** for the whole order — not
   * the raw percentage or the discount_value input. Callers derive this the
   * same way the financial summary does (fixed → the amount; percentage →
   * subtotal × rate).
   */
  discountAmount: number;
}

/**
 * Allocate order-level shipping and discount across the lines by value and
 * derive each line's landed unit cost.
 *
 * Edge case: when the order subtotals to $0 (every line is free) value-based
 * weighting would divide by zero — fall back to splitting by quantity so every
 * unit still carries an equal share of shipping/discount. When there are no
 * units at all, shares are zero.
 */
export function computeLandedCosts({
  lines,
  shippingFee,
  discountAmount,
}: LandedCostInput): LandedCostLine[] {
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const shipping = Math.max(0, shippingFee || 0);
  const discount = Math.max(0, discountAmount || 0);

  return lines.map((l) => {
    const lineSubtotal = l.qty * l.unit_price;
    // Weight by value; fall back to quantity when the order carries no value.
    const weight =
      subtotal > 0
        ? lineSubtotal / subtotal
        : totalQty > 0
          ? l.qty / totalQty
          : 0;
    const shippingShare = shipping * weight;
    const discountShare = discount * weight;
    const landedLineTotal = lineSubtotal + shippingShare - discountShare;
    const landedUnitCost = l.qty > 0 ? landedLineTotal / l.qty : 0;
    return { lineSubtotal, shippingShare, discountShare, landedLineTotal, landedUnitCost };
  });
}

/** Fixed-amount or percentage-of-subtotal discount → dollar amount. */
export function resolveDiscountAmount(
  discountType: "percentage" | "fixed",
  discountValue: number,
  subtotal: number,
): number {
  const value = Math.max(0, Number(discountValue) || 0);
  return discountType === "percentage" ? subtotal * (value / 100) : value;
}

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
export const round4 = (n: number): number => Math.round((Number(n) || 0) * 10000) / 10000;
