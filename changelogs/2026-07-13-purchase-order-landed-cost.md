# Purchase Order landed cost — true per-unit cost for COGS / margin

**Date:** 2026-07-13
**Area:** Admin (Purchase Orders — form, PDF, API)
**Migrations:** `purchase-orders-landed-cost-migration.sql`

## Summary

A purchase-order line's supplier **Unit $** isn't the true cost of getting that
product into inventory — the order's **shipping** and **discount** belong to it
too, but until now they lived only on the order total and never touched the
line. This adds a second per-line figure, the **landed unit cost**, that folds
each line's share of shipping and discount back into the per-unit price. It's the
cost basis for COGS / margin.

- **Allocation by value.** Order-level shipping and discount are split across the
  lines in proportion to each line's subtotal (the accounting-standard method,
  and consistent with how a percentage discount already works). The shares always
  sum back to the order's shipping and discount, so the landed line totals
  reconcile to `subtotal + shipping − discount` — no money appears or disappears.

  ```
  share           = lineSubtotal / orderSubtotal
  landedLineTotal = lineSubtotal + shipping × share − discount × share
  landedUnitCost  = landedLineTotal / qty
  ```

- **Recorded on each line.** `landed_unit_cost` and `landed_line_total` are stored
  on `purchase_order_items`, recomputed server-side whenever a PO's lines,
  shipping, or discount change — so future COGS / analytics can read the cost
  basis without re-deriving it.

- **Shown in the form.** Each line card now shows a **Landed $X.XX / unit** readout
  under the Qty / Unit $ controls, updating live as qty / shipping / discount
  change, with a **margin %** hint comparing the product's sell price (matched to
  the line's box/vial unit) against the landed cost. Green for margin, red for a
  loss.

- **Shown on the PDF.** The line-item table gains a **Landed / unit** column,
  computed live from the stored PO totals so it's correct even for POs created
  before this shipped.

## Allocation edge cases

- **Zero-value order** (every line free): value weighting would divide by zero, so
  shipping/discount fall back to being split evenly **by quantity**.
- **Rounding:** shares are computed in full precision; only the displayed and
  stored per-unit value is rounded (`landed_unit_cost` keeps 4 decimals so line
  totals still reconcile to the order's shipping/discount).

## Implementation notes

- New shared, pure helper `lib/admin/po-landed-cost.ts` (`computeLandedCosts`,
  `resolveDiscountAmount`, `round2`/`round4`) is the single source of truth used
  by the form, both API routes, and the PDF, so the number can never disagree
  between them.
- `POST /api/admin/purchase-orders` and `PATCH /api/admin/purchase-orders/:id`
  compute and persist landed cost on every line write. PATCH also re-allocates
  over existing lines when shipping/discount change without the items being
  resubmitted, and threads landed values through the receiving-lock in-place
  reconciliation path.
- The migration backfills landed cost for all existing line items. Safe to run
  multiple times.

## Files

- `lib/admin/po-landed-cost.ts` (new)
- `purchase-orders-landed-cost-migration.sql` (new)
- `lib/supabase.ts` — `PurchaseOrderItem.landed_unit_cost` / `landed_line_total`
- `app/api/admin/purchase-orders/route.ts`
- `app/api/admin/purchase-orders/[id]/route.ts`
- `app/api/admin/purchase-orders/[id]/pdf/route.ts`
- `app/(admin)/admin/purchase-orders/PurchaseOrderForm.tsx`
