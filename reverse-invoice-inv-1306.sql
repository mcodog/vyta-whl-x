-- =====================================================================
-- One-off: reverse the payment(s) on invoice INV-1306
-- ---------------------------------------------------------------------
-- Undoes a mistakenly-paid invoice, mirroring exactly what the new
-- "Reverse payment" admin action does, but for a single named invoice:
--
--   1. If the invoice took stock when it went paid (stock_adjusted = true),
--      give that stock back and clear the flag.
--   2. Delete every payment recorded against the invoice.
--   3. Reset the status from 'paid' back to 'sent' (issued, unpaid).
--
-- NOTE: the stock-restore step is INLINED here (rather than calling
-- restore_stock_for_invoice) on purpose. This database has more than one
-- overload of restore_stock_for_invoice(...), so a positional call to it is
-- ambiguous ("function ... is not unique"). Inlining the exact same logic —
-- the box->vial conversion, the stock_adjusted guard, and the
-- product_change_history row — keeps the script self-contained and
-- unambiguous.
--
-- Wrapped in a transaction and pinned to exactly one invoice by number, so
-- it either fully applies or does nothing. Re-running it is safe: once
-- stock_adjusted is false it won't restore again, and with no payments left
-- it just re-asserts status = 'sent'.
--
-- Run this in the Supabase SQL editor.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_invoice_id uuid;
  v_status     text;
  v_adjusted   boolean;
  v_paid       integer;
BEGIN
  SELECT id, status, stock_adjusted
    INTO v_invoice_id, v_status, v_adjusted
    FROM invoices
   WHERE invoice_number = 'INV-1306';

  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Invoice INV-1306 not found';
  END IF;

  -- 1. Return the stock the paid transition took (only if it was adjusted).
  --    Same box->vial conversion + history row as restore_stock_for_invoice().
  IF v_adjusted THEN
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
       WHERE li.invoice_id = v_invoice_id
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

    UPDATE invoices SET stock_adjusted = false WHERE id = v_invoice_id;
  END IF;

  -- 2. Remove the recorded payment(s).
  DELETE FROM payments WHERE invoice_id = v_invoice_id;
  GET DIAGNOSTICS v_paid = ROW_COUNT;

  -- 3. Reset the status to 'sent' (unpaid / issued).
  UPDATE invoices SET status = 'sent' WHERE id = v_invoice_id;

  RAISE NOTICE 'INV-1306 (%): was %, stock_adjusted was %, removed % payment(s), status now sent.',
    v_invoice_id, v_status, v_adjusted, v_paid;
END $$;

COMMIT;

-- Verify the result:
--   SELECT invoice_number, status, stock_adjusted FROM invoices WHERE invoice_number = 'INV-1306';
--   SELECT count(*) AS remaining_payments FROM payments p
--     JOIN invoices i ON i.id = p.invoice_id WHERE i.invoice_number = 'INV-1306';
