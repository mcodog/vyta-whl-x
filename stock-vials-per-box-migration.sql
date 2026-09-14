-- =====================================================================
-- Vials-per-box: count stock in vials, receive purchase orders in boxes
-- ---------------------------------------------------------------------
-- Stock numbers on the admin Products page are now expressed in *vials*,
-- the smallest unit we ship. Purchase orders are still ordered and
-- received in the line's unit (a "box" line = a pack of N vials, a
-- "vial" line = single vials), so receiving has to convert box lines to
-- vials before it touches products.stock_quantity.
--
-- This migration:
--   1. Adds products.vials_per_box (how many vials are in one box).
--      Defaults to 10 for every existing product, matching the old
--      hard-coded "pack of 10" convention, and is editable in
--      admin/products.
--   2. Rewrites receive_po_items() so that receiving a purchase-order
--      line increments stock by:
--        * box line : qty_received × the product's vials_per_box
--        * vial line: qty_received (already in vials)
--      The product_change_history 'restock' row and the inventory_log
--      delta both record the vial figure, so the Products > History view
--      matches the stock number it explains.
--
-- Self-contained and idempotent: safe to run regardless of which earlier
-- receiving / history migrations have been applied.
-- =====================================================================

-- 1. vials_per_box column ---------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS vials_per_box integer NOT NULL DEFAULT 10;

-- Guard against zero / negative so box→vial conversion is always sane.
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_vials_per_box_check;
ALTER TABLE products
  ADD CONSTRAINT products_vials_per_box_check CHECK (vials_per_box > 0);

-- Backfill any pre-existing NULLs (defensive; the column is NOT NULL).
UPDATE products SET vials_per_box = 10 WHERE vials_per_box IS NULL;

-- 2. Allow the 'restock' change source (idempotent, self-contained) ---
ALTER TABLE product_change_history
  DROP CONSTRAINT IF EXISTS product_change_history_change_source_check;
ALTER TABLE product_change_history
  ADD CONSTRAINT product_change_history_change_source_check
  CHECK (change_source IN (
    'create', 'inline', 'form', 'import', 'revert', 'api',
    'order', 'invoice', 'restock'
  ));

-- 3. receive_po_items() — convert box lines to vials on receive -------
-- Identical to purchase-order-receipt-stock-history-migration.sql, plus
-- the box→vial conversion driven by the line's price_type and the
-- product's vials_per_box.
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
  v_vials_per_box integer;
  v_units integer;
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

    -- qty_received tracks the line in its own unit (boxes for a box line).
    UPDATE purchase_order_items
       SET qty_received = qty_received + v_line.qty
     WHERE id = v_item.id;

    INSERT INTO purchase_order_receipt_items (receipt_id, po_item_id, product_id, qty)
    VALUES (v_receipt_id, v_item.id, v_item.product_id, v_line.qty);

    IF v_item.product_id IS NOT NULL THEN
      -- Convert the received quantity to vials. A box line multiplies by
      -- the product's vials_per_box; a vial line is already in vials.
      SELECT COALESCE(vials_per_box, 10) INTO v_vials_per_box
        FROM products WHERE id = v_item.product_id;

      v_units := CASE
                   WHEN v_item.price_type = 'box'
                     THEN v_line.qty * COALESCE(v_vials_per_box, 10)
                   ELSE v_line.qty
                 END;

      UPDATE products
         SET stock_quantity = stock_quantity + v_units,
             updated_at = now()
       WHERE id = v_item.product_id
      RETURNING stock_quantity INTO v_new_stock;

      v_old_stock := v_new_stock - v_units;

      INSERT INTO inventory_log
        (product_id, delta, reason, reference_type, reference_id, created_by)
      VALUES
        (v_item.product_id, v_units, 'restock', 'purchase_order_receipt', v_receipt_id, p_actor);

      -- Surface the restock (in vials) in the admin Products > History view.
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

-- 4. apply_po_inventory() — same box→vial conversion for the "create a
-- purchase order directly as fulfilled" shortcut, which applies all
-- inventory at once instead of going through receive_po_items(). Now it
-- also appends a 'restock' history row per product so the shortcut shows
-- up in Products > History just like a normal receipt.
CREATE OR REPLACE FUNCTION apply_po_inventory(po_id uuid)
RETURNS void AS $$
DECLARE
  v_already_applied boolean;
  v_actor uuid;
  v_item record;
  v_vials_per_box integer;
  v_units integer;
  v_old_stock integer;
  v_new_stock integer;
BEGIN
  SELECT inventory_applied, created_by
    INTO v_already_applied, v_actor
    FROM purchase_orders
   WHERE id = po_id
   FOR UPDATE;

  IF v_already_applied IS DISTINCT FROM false THEN
    RETURN;
  END IF;

  FOR v_item IN
    SELECT id, product_id, qty, price_type
      FROM purchase_order_items
     WHERE purchase_order_id = po_id
       AND product_id IS NOT NULL
  LOOP
    SELECT COALESCE(vials_per_box, 10) INTO v_vials_per_box
      FROM products WHERE id = v_item.product_id;

    v_units := CASE
                 WHEN v_item.price_type = 'box'
                   THEN v_item.qty * COALESCE(v_vials_per_box, 10)
                 ELSE v_item.qty
               END;

    UPDATE products
       SET stock_quantity = stock_quantity + v_units,
           updated_at = now()
     WHERE id = v_item.product_id
    RETURNING stock_quantity INTO v_new_stock;

    v_old_stock := v_new_stock - v_units;

    INSERT INTO inventory_log (product_id, delta, reason, reference_type, reference_id, created_by)
    VALUES (v_item.product_id, v_units, 'restock', 'purchase_order', po_id, v_actor);

    INSERT INTO product_change_history
      (product_id, field, old_value, new_value, changed_by, change_source)
    VALUES
      (v_item.product_id, 'stock_quantity', v_old_stock, v_new_stock, v_actor, 'restock');
  END LOOP;

  UPDATE purchase_orders
     SET inventory_applied = true,
         inventory_applied_at = now()
   WHERE id = po_id;
END;
$$ LANGUAGE plpgsql;
