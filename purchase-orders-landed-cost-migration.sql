-- Purchase Orders — Landed cost per line item
-- ===========================================
-- Records each line's TRUE per-unit cost after order-level shipping and
-- discount are allocated across the lines by value (proportional to each
-- line's subtotal). This is the cost basis for COGS / margin — the supplier
-- `unit_price` alone omits the line's share of shipping and discount.
--
--   landed_line_total = line_subtotal + shipping_share - discount_share
--   landed_unit_cost  = landed_line_total / qty
--
-- The API recomputes and writes these whenever a PO's lines, shipping, or
-- discount change (see lib/admin/po-landed-cost.ts for the shared math).
-- Existing rows are backfilled below.
--
-- Safe to run multiple times.

------------------------------------------------------------------------------
-- 1. New columns
------------------------------------------------------------------------------
ALTER TABLE purchase_order_items
  -- 4 decimals: per-unit shares are fractional cents; keep precision so the
  -- line totals reconcile to the order's shipping/discount.
  ADD COLUMN IF NOT EXISTS landed_unit_cost numeric(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS landed_line_total numeric(10,2) NOT NULL DEFAULT 0;

------------------------------------------------------------------------------
-- 2. Backfill existing rows
------------------------------------------------------------------------------
-- Allocate each PO's shipping and discount across its lines by value, then
-- derive per-line landed figures. `po.discount` is already the resolved dollar
-- amount, so no percentage handling is needed here.
WITH totals AS (
  SELECT
    i.purchase_order_id,
    NULLIF(SUM(i.line_total), 0) AS subtotal
  FROM purchase_order_items i
  GROUP BY i.purchase_order_id
),
alloc AS (
  SELECT
    i.id,
    i.qty,
    i.line_total,
    -- Value weight; guard against a zero-value order (all-free lines).
    CASE WHEN t.subtotal IS NULL THEN 0
         ELSE i.line_total / t.subtotal END AS weight,
    COALESCE(po.shipping_fee, 0) AS shipping_fee,
    COALESCE(po.discount, 0)     AS discount
  FROM purchase_order_items i
  JOIN purchase_orders po ON po.id = i.purchase_order_id
  LEFT JOIN totals t ON t.purchase_order_id = i.purchase_order_id
)
UPDATE purchase_order_items i
   SET landed_line_total = ROUND(a.line_total + a.shipping_fee * a.weight - a.discount * a.weight, 2),
       landed_unit_cost  = CASE WHEN a.qty > 0
                                THEN ROUND((a.line_total + a.shipping_fee * a.weight - a.discount * a.weight) / a.qty, 4)
                                ELSE 0 END
  FROM alloc a
 WHERE i.id = a.id;
