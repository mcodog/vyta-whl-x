// Splitting an invoice into in-stock and backordered portions.
//
// When a line item's quantity exceeds the product's available stock, the
// invoice is split at creation time: the in-stock quantities go on the primary
// invoice and the exceeding quantities go on a separate "backorder" invoice.
// Stock is allocated greedily in line order so multiple lines referencing the
// same product never over-allocate the same units.
//
// Stock (`stockMap`) is counted in vials. A line's `qty` is in its own unit —
// vials for a vial line, boxes for a box line — so allocation happens in vials
// via `qtyToVials`, and box lines are only ever fulfilled in WHOLE boxes (you
// can't ship a partial box). Leftover vials below a full box stay available for
// later vial lines of the same product.

import { qtyToVials, resolveVialsPerBox } from "./stock-units";

export interface SplitLine {
  product_id: string | null;
  description: string;
  qty: number;
  unit_price: number;
  discount_pct: number;
  line_total: number;
  /** Whether the unit price is the box (pack of 10) or single-vial price. */
  price_type?: "box" | "vial";
  /** Vials per box for this line's product; drives the box→vial conversion. */
  vials_per_box?: number;
  /** Supplier chosen to procure this line (prepaid invoices). Carried through
   *  the split via object spread so both invoices keep the choice. */
  preferred_supplier_id?: string | null;
}

function lineTotal(qty: number, unitPrice: number, discountPct: number): number {
  return Number((qty * unitPrice * (1 - discountPct / 100)).toFixed(2));
}

export interface StockSplit {
  inStock: SplitLine[];
  backordered: SplitLine[];
  /** Per-line backordered detail for building backorder_items. */
  backorderItems: Array<{
    product_id: string;
    description: string;
    qty_ordered: number;
    qty_available: number;
    qty_backordered: number;
    unit_price: number;
  }>;
}

/**
 * Allocate `stockMap` (product_id -> available units) across `lines` in order.
 * Lines without a product_id are always treated as fully in stock (custom
 * items). Returns the in-stock and backordered line sets with quantities and
 * line totals recomputed, plus per-line backorder detail.
 */
export function computeStockSplit(
  lines: SplitLine[],
  stockMap: Map<string, number>,
): StockSplit {
  const remaining = new Map(stockMap);
  const inStock: SplitLine[] = [];
  const backordered: SplitLine[] = [];
  const backorderItems: StockSplit["backorderItems"] = [];

  for (const li of lines) {
    if (!li.product_id) {
      inStock.push({ ...li });
      continue;
    }
    // Everything below is in vials. `availableUnits` is how much of the line's
    // own unit the remaining vial stock can cover: box lines only count whole
    // boxes; vial lines count vials one-for-one.
    const availableVials = Math.max(0, remaining.get(li.product_id) ?? 0);
    const per = resolveVialsPerBox(li.vials_per_box);
    const availableUnits =
      li.price_type === "vial" ? availableVials : Math.floor(availableVials / per);
    const inQty = Math.min(li.qty, availableUnits);
    const backQty = li.qty - inQty;
    // Only the vials actually consumed by the in-stock portion leave the pool.
    remaining.set(li.product_id, availableVials - qtyToVials(inQty, per, li.price_type));

    if (inQty > 0) {
      inStock.push({
        ...li,
        qty: inQty,
        line_total: lineTotal(inQty, li.unit_price, li.discount_pct),
      });
    }
    if (backQty > 0) {
      backordered.push({
        ...li,
        qty: backQty,
        line_total: lineTotal(backQty, li.unit_price, li.discount_pct),
      });
      backorderItems.push({
        product_id: li.product_id,
        description: li.description || "Item",
        qty_ordered: li.qty,
        qty_available: inQty,
        qty_backordered: backQty,
        unit_price: li.unit_price,
      });
    }
  }

  return { inStock, backordered, backorderItems };
}
