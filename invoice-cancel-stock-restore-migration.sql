-- =====================================================================
-- Restore stock when a paid invoice is cancelled
-- ---------------------------------------------------------------------
-- When an invoice is marked paid, adjust_stock_for_invoice() decrements
-- the purchased products' stock_quantity and flips the invoice's
-- stock_adjusted flag to true (see stock-decrement-history-migration.sql).
--
-- Until now there was no way to give that stock back: cancelling an
-- invoice left the sold quantities permanently out of inventory, and the
-- Products > History view had no record explaining why the stock never
-- came back.
--
-- This migration adds the mirror operation:
--   1. Introduces a 'cancelled' invoice status.
--   2. Adds a new 'invoice_cancel' change_source for product history.
--   3. Adds restore_stock_for_invoice(), which adds the sold quantities
--      back onto stock and records an 'invoice_cancel' history row per
--      product (old -> new value), atomically with the update.
--
-- Idempotency mirrors the decrement: restore only runs when the invoice
-- currently has stock_adjusted = true, and clearing that flag in the same
-- claim guarantees it runs at most once. A cancelled invoice that is
-- later re-marked paid decrements again cleanly.
--
-- Self-contained and idempotent: safe to run multiple times, and whether
-- or not the earlier stock-decrement migrations have been applied.
-- =====================================================================

-- 1. Idempotency flag (no-op if already present) ---------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false;

-- 2. Allow the 'cancelled' invoice status ----------------------------
-- The original CHECK (from ecommerce-backend-migration.sql) is the inline
-- column check, auto-named invoices_status_check.
ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled'));

-- 3. Allow the 'invoice_cancel' change source ------------------------
-- Rebuild the CHECK to the full set of sources so this migration is
-- self-contained regardless of which earlier history migrations ran.
ALTER TABLE product_change_history
  DROP CONSTRAINT IF EXISTS product_change_history_change_source_check;
ALTER TABLE product_change_history
  ADD CONSTRAINT product_change_history_change_source_check
  CHECK (change_source IN (
    'create', 'inline', 'form', 'import', 'revert', 'api',
    'order', 'invoice', 'restock', 'invoice_cancel'
  ));

-- 4. Restore stock for a cancelled invoice (with history) ------------
-- The inverse of adjust_stock_for_invoice(): it adds the invoice's sold
-- quantities back onto stock and appends a 'stock_quantity' history row
-- (old -> new) per product, in the same data-modifying CTE so the record
-- is atomic with the increment. Only products whose value actually
-- changes get a row.
CREATE OR REPLACE FUNCTION restore_stock_for_invoice(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only restore if this invoice previously took stock. Clearing the flag
  -- in the same statement makes the restore run at most once and lets a
  -- later re-payment decrement again cleanly.
  UPDATE invoices
     SET stock_adjusted = false
   WHERE id = p_invoice_id
     AND stock_adjusted = true;
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
