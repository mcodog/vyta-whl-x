-- =====================================================================
-- Record sale-driven stock changes in the product change history
-- ---------------------------------------------------------------------
-- The stock-decrement functions (adjust_stock_for_order /
-- adjust_stock_for_invoice) lowered products.stock_quantity directly and
-- never wrote to product_change_history, so a paid order or paid invoice
-- would silently drop a product's stock with nothing in the admin
-- Products > History view to explain it. That also made "revert" unsafe:
-- reverting jumped back to a value that predated the sales.
--
-- This migration closes that gap. Both functions now append a
-- 'stock_quantity' history row (old -> new value) for every product they
-- touch, tagged with a new change_source:
--   * 'order'   -- decrement from a confirmed crypto order
--   * 'invoice' -- decrement from a fully paid invoice
--
-- The history insert happens in the SAME statement as the stock update
-- (a data-modifying CTE), so it is atomic with the decrement and inherits
-- the existing once-per-order/invoice idempotency guard. Rows are only
-- written when the value actually changed (a product already at 0 that
-- stays 0 records nothing).
--
-- Self-contained and idempotent: safe to run whether or not
-- stock-decrement-migration.sql has already been applied.
-- =====================================================================

-- 1. Idempotency flags (no-op if already present) --------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false;

-- 2. Allow the new change sources ------------------------------------
-- The original CHECK constraint (from product-price-stock-history-
-- migration.sql) is the inline column check, auto-named
-- product_change_history_change_source_check.
ALTER TABLE product_change_history
  DROP CONSTRAINT IF EXISTS product_change_history_change_source_check;
ALTER TABLE product_change_history
  ADD CONSTRAINT product_change_history_change_source_check
  CHECK (change_source IN (
    'create', 'inline', 'form', 'import', 'revert', 'api', 'order', 'invoice'
  ));

-- 3. Order stock adjustment (with history) ---------------------------
-- order_items.product_id is TEXT (a UUID stored as a string), so it is
-- cast to uuid and guarded against non-uuid/null values.
CREATE OR REPLACE FUNCTION adjust_stock_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Claim the adjustment atomically; bail if it already ran (or no order).
  UPDATE orders
     SET stock_adjusted = true
   WHERE id = p_order_id
     AND stock_adjusted = false;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  WITH agg AS (
    SELECT oi.product_id::uuid AS pid, SUM(oi.quantity) AS qty
      FROM order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.product_id IS NOT NULL
       AND oi.product_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     GROUP BY oi.product_id
  ),
  snap AS (
    SELECT agg.pid, agg.qty, COALESCE(p.stock_quantity, 0) AS old_value
      FROM agg
      JOIN products p ON p.id = agg.pid
  ),
  upd AS (
    UPDATE products p
       SET stock_quantity = GREATEST(0, COALESCE(p.stock_quantity, 0) - snap.qty)
      FROM snap
     WHERE p.id = snap.pid
    RETURNING p.id AS pid, p.stock_quantity AS new_value
  )
  INSERT INTO product_change_history
    (product_id, field, old_value, new_value, changed_by, change_source)
  SELECT snap.pid, 'stock_quantity', snap.old_value, upd.new_value, NULL, 'order'
    FROM upd
    JOIN snap ON snap.pid = upd.pid
   WHERE snap.old_value IS DISTINCT FROM upd.new_value;
END;
$$;

-- 4. Invoice stock adjustment (with history) -------------------------
-- invoice_line_items.product_id is already uuid.
CREATE OR REPLACE FUNCTION adjust_stock_for_invoice(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE invoices
     SET stock_adjusted = true
   WHERE id = p_invoice_id
     AND stock_adjusted = false;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  WITH agg AS (
    SELECT li.product_id AS pid, SUM(li.qty) AS qty
      FROM invoice_line_items li
     WHERE li.invoice_id = p_invoice_id
       AND li.product_id IS NOT NULL
     GROUP BY li.product_id
  ),
  snap AS (
    SELECT agg.pid, agg.qty, COALESCE(p.stock_quantity, 0) AS old_value
      FROM agg
      JOIN products p ON p.id = agg.pid
  ),
  upd AS (
    UPDATE products p
       SET stock_quantity = GREATEST(0, COALESCE(p.stock_quantity, 0) - snap.qty)
      FROM snap
     WHERE p.id = snap.pid
    RETURNING p.id AS pid, p.stock_quantity AS new_value
  )
  INSERT INTO product_change_history
    (product_id, field, old_value, new_value, changed_by, change_source)
  SELECT snap.pid, 'stock_quantity', snap.old_value, upd.new_value, NULL, 'invoice'
    FROM upd
    JOIN snap ON snap.pid = upd.pid
   WHERE snap.old_value IS DISTINCT FROM upd.new_value;
END;
$$;
