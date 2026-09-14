-- =====================================================================
-- Record PO-receipt stock changes in the product change history
-- ---------------------------------------------------------------------
-- receive_po_items() raised products.stock_quantity directly (and wrote
-- an inventory_log row) but never appended to product_change_history, so
-- receiving stock against a purchase order silently increased a product's
-- stock with nothing in the admin Products > History view to explain it.
-- That also made "revert" unsafe: reverting jumped back to a value that
-- predated the receipts.
--
-- This migration closes that gap. receive_po_items() now appends a
-- 'stock_quantity' history row (old -> new value) for every product it
-- restocks, tagged with a new change_source:
--   * 'restock' -- increment from receiving a purchase order line item
--
-- The history insert happens in the SAME transaction as the stock update
-- and receipt, so it is atomic with the receive. It mirrors the existing
-- inventory_log write (one row per received line item).
--
-- Self-contained and idempotent: safe to run whether or not
-- purchase-orders-receiving-migration.sql or
-- stock-decrement-history-migration.sql have already been applied.
-- =====================================================================

-- 1. Allow the new change source -------------------------------------
-- Rebuild the CHECK to the full set of sources so this migration is
-- self-contained regardless of which earlier history migrations ran.
ALTER TABLE product_change_history
  DROP CONSTRAINT IF EXISTS product_change_history_change_source_check;
ALTER TABLE product_change_history
  ADD CONSTRAINT product_change_history_change_source_check
  CHECK (change_source IN (
    'create', 'inline', 'form', 'import', 'revert', 'api',
    'order', 'invoice', 'restock'
  ));

-- 2. receive_po_items() — atomic receive + stock + history + status --
-- Identical to purchase-orders-receiving-migration.sql, plus a
-- product_change_history insert alongside each stock increment.
CREATE OR REPLACE FUNCTION receive_po_items(
  p_po_id uuid,
  p_actor uuid,
  p_note text,
  p_items jsonb
)
RETURNS uuid AS $$
DECLARE
  v_status text;
  v_receipt_id uuid;
  v_line record;
  v_item record;
  v_remaining integer;
  v_old_stock integer;
  v_new_stock integer;
  v_total_qty integer;
  v_total_received integer;
  v_fully boolean;
BEGIN
  SELECT status INTO v_status
    FROM purchase_orders
   WHERE id = p_po_id
   FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;
  IF v_status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'Purchase order is % and cannot receive items', v_status;
  END IF;

  INSERT INTO purchase_order_receipts (purchase_order_id, note, created_by)
  VALUES (p_po_id, NULLIF(btrim(p_note), ''), p_actor)
  RETURNING id INTO v_receipt_id;

  FOR v_line IN
    SELECT * FROM jsonb_to_recordset(p_items) AS x(po_item_id uuid, qty integer)
  LOOP
    IF v_line.qty IS NULL OR v_line.qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_item
      FROM purchase_order_items
     WHERE id = v_line.po_item_id
       AND purchase_order_id = p_po_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Line item % does not belong to this purchase order', v_line.po_item_id;
    END IF;

    v_remaining := v_item.qty - v_item.qty_received;
    IF v_line.qty > v_remaining THEN
      RAISE EXCEPTION 'Cannot receive % of "%": only % remaining',
        v_line.qty, v_item.description, v_remaining;
    END IF;

    UPDATE purchase_order_items
       SET qty_received = qty_received + v_line.qty
     WHERE id = v_item.id;

    INSERT INTO purchase_order_receipt_items (receipt_id, po_item_id, product_id, qty)
    VALUES (v_receipt_id, v_item.id, v_item.product_id, v_line.qty);

    IF v_item.product_id IS NOT NULL THEN
      UPDATE products
         SET stock_quantity = stock_quantity + v_line.qty,
             updated_at = now()
       WHERE id = v_item.product_id
      RETURNING stock_quantity INTO v_new_stock;

      v_old_stock := v_new_stock - v_line.qty;

      INSERT INTO inventory_log
        (product_id, delta, reason, reference_type, reference_id, created_by)
      VALUES
        (v_item.product_id, v_line.qty, 'restock', 'purchase_order_receipt', v_receipt_id, p_actor);

      -- Surface the restock in the admin Products > History view.
      INSERT INTO product_change_history
        (product_id, field, old_value, new_value, changed_by, change_source)
      VALUES
        (v_item.product_id, 'stock_quantity', v_old_stock, v_new_stock, p_actor, 'restock');
    END IF;
  END LOOP;

  -- Reject empty receipts so we never leave a header with no lines.
  IF NOT EXISTS (
    SELECT 1 FROM purchase_order_receipt_items WHERE receipt_id = v_receipt_id
  ) THEN
    DELETE FROM purchase_order_receipts WHERE id = v_receipt_id;
    RAISE EXCEPTION 'No quantities to receive';
  END IF;

  SELECT COALESCE(SUM(qty), 0), COALESCE(SUM(qty_received), 0)
    INTO v_total_qty, v_total_received
    FROM purchase_order_items
   WHERE purchase_order_id = p_po_id;

  v_fully := (v_total_qty > 0 AND v_total_received >= v_total_qty);

  UPDATE purchase_orders
     SET status = CASE
                    WHEN v_fully THEN 'fulfilled'
                    WHEN v_total_received > 0 THEN 'partially_fulfilled'
                    ELSE 'pending'
                  END,
         inventory_applied = v_fully,
         inventory_applied_at = CASE WHEN v_fully THEN now() ELSE inventory_applied_at END
   WHERE id = p_po_id;

  RETURN v_receipt_id;
END;
$$ LANGUAGE plpgsql;
