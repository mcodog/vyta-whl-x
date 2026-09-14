-- =====================================================================
-- Convert box line items to vials when an invoice moves stock
-- ---------------------------------------------------------------------
-- Stock is counted in vials (see stock-vials-per-box-migration.sql), and
-- purchase-order *box* lines are already converted to vials at
-- `products.vials_per_box` when received. The invoice side was never
-- updated to match: adjust_stock_for_invoice() and
-- restore_stock_for_invoice() decremented/restored the raw `qty`, so
-- selling 2 boxes of a 10-vials/box product only moved 2 vials instead of
-- 20. Boxes went *in* as vials but came *out* as raw units.
--
-- This migration rewrites both functions so a line's stock movement is:
--   * vial line  -> qty
--   * box line   -> qty * COALESCE(products.vials_per_box, 10)
-- Anything not explicitly 'vial' is treated as a box, mirroring the
-- frontend/queue mapper (`price_type === 'vial' ? 'vial' : 'box'`).
--
-- The GREATEST(0, ...) floor, the product_change_history rows, and the
-- stock_adjusted idempotency claim all behave exactly as before — only the
-- per-line quantity that feeds the aggregate changes.
--
-- Self-contained and idempotent: CREATE OR REPLACE, safe to run multiple
-- times and regardless of which earlier stock migrations were applied
-- (requires products.vials_per_box, added by stock-vials-per-box-migration).
-- =====================================================================

-- 1. Decrement on payment (with history) -----------------------------
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
    SELECT li.product_id AS pid,
           SUM(
             CASE
               WHEN li.price_type = 'vial' THEN li.qty
               ELSE li.qty * COALESCE(pr.vials_per_box, 10)
             END
           ) AS qty
      FROM invoice_line_items li
      JOIN products pr ON pr.id = li.product_id
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

-- 2. Restore on cancellation (with history) --------------------------
-- Exact inverse of the decrement, using the same box->vial conversion so a
-- cancel gives back precisely what the payment took.
CREATE OR REPLACE FUNCTION restore_stock_for_invoice(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE invoices
     SET stock_adjusted = false
   WHERE id = p_invoice_id
     AND stock_adjusted = true;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  WITH agg AS (
    SELECT li.product_id AS pid,
           SUM(
             CASE
               WHEN li.price_type = 'vial' THEN li.qty
               ELSE li.qty * COALESCE(pr.vials_per_box, 10)
             END
           ) AS qty
      FROM invoice_line_items li
      JOIN products pr ON pr.id = li.product_id
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
       SET stock_quantity = COALESCE(p.stock_quantity, 0) + snap.qty
      FROM snap
     WHERE p.id = snap.pid
    RETURNING p.id AS pid, p.stock_quantity AS new_value
  )
  INSERT INTO product_change_history
    (product_id, field, old_value, new_value, changed_by, change_source)
  SELECT snap.pid, 'stock_quantity', snap.old_value, upd.new_value, NULL, 'invoice_cancel'
    FROM upd
    JOIN snap ON snap.pid = upd.pid
   WHERE snap.old_value IS DISTINCT FROM upd.new_value;
END;
$$;
