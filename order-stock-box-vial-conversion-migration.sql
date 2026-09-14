-- =====================================================================
-- Convert box order line items to vials when a paid order moves stock
-- ---------------------------------------------------------------------
-- Companion to invoice-stock-box-vial-conversion-migration.sql. Stock is
-- counted in vials (see stock-vials-per-box-migration.sql), and the
-- invoice path now converts box lines to vials on paid/cancel. The
-- storefront paid-order path — adjust_stock_for_order() — still lowered
-- stock by the raw `order_items.quantity`, so a box-priced order of 2 of
-- a 10-vials/box product only removed 2 vials instead of 20.
--
-- This rewrites adjust_stock_for_order() to move:
--   * box line    -> quantity * COALESCE(products.vials_per_box, 10)
--   * vial line   -> quantity
--   * untagged    -> quantity   (price_type IS NULL)
--
-- IMPORTANT — asymmetry with invoices: order_items.price_type is nullable
-- with NO default (see vial-price-and-price-type-migration.sql). Existing
-- orders predate box/vial tagging and carry NULL. Only an *explicit* 'box'
-- tag is converted; NULL is left as the raw quantity so historical
-- untagged orders keep decrementing exactly as they did before. (Invoice
-- lines default to 'box', so there the default treats non-'vial' as box.)
--
-- The GREATEST(0, …) floor, the 'order' product_change_history rows, and
-- the stock_adjusted idempotency claim are unchanged — only the per-line
-- quantity feeding the aggregate changes. order_items.product_id is TEXT
-- (a UUID stored as a string), so the same cast + regex guard as the
-- original is preserved.
--
-- Self-contained and idempotent: CREATE OR REPLACE, safe to run multiple
-- times (requires products.vials_per_box, added by
-- stock-vials-per-box-migration).
-- =====================================================================

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

  WITH lines AS (
    -- Project + guard first (matches the original's cast/regex safety),
    -- so the products join below only sees valid uuid product ids.
    SELECT oi.product_id::uuid AS pid, oi.quantity, oi.price_type
      FROM order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.product_id IS NOT NULL
       AND oi.product_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ),
  agg AS (
    SELECT l.pid,
           SUM(
             CASE
               WHEN l.price_type = 'box'
                 THEN l.quantity * COALESCE(pr.vials_per_box, 10)
               ELSE l.quantity
             END
           ) AS qty
      FROM lines l
      JOIN products pr ON pr.id = l.pid
     GROUP BY l.pid
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
