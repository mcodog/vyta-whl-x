-- Purchase Orders — Discount, Shipping Fee, Order Date + receiving fixes
-- =====================================================================
-- 1. Adds discount, shipping_fee and order_date to purchase_orders, and
--    recomputes the financial summary as:
--       subtotal -> + shipping fee -> - discount -> + tax  = total
--    (tax is applied to the running total, i.e. subtotal + shipping - discount)
-- 2. Guarantees inventory_log has the columns receive_po_items()/
--    apply_po_inventory() write to. The live table predated the purchase-orders
--    migration with a different shape, so receiving failed with
--    'column "product_id" of relation "inventory_log" does not exist'.
-- 3. Allows receiving items on a 'paid' purchase order (only 'cancelled' blocks
--    receiving now), preserving the 'paid' status after the receipt.
--
-- Safe to run multiple times.

------------------------------------------------------------------------------
-- 1. New financial / date columns
------------------------------------------------------------------------------
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS discount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_fee numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_date date;

-- Discount can be a flat amount or a percentage, mirroring tax. `discount`
-- stays the computed dollar amount (like tax_total); discount_type +
-- discount_value are the inputs.
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS discount_type text NOT NULL DEFAULT 'fixed'
    CHECK (discount_type IN ('percentage', 'fixed')),
  ADD COLUMN IF NOT EXISTS discount_value numeric(10,2) NOT NULL DEFAULT 0;

-- Existing rows stored `discount` as a flat amount — seed discount_value from it.
UPDATE purchase_orders
   SET discount_value = discount
 WHERE discount_value = 0 AND discount <> 0;

-- Backfill order_date for existing rows to their creation date.
UPDATE purchase_orders
   SET order_date = created_at::date
 WHERE order_date IS NULL;

------------------------------------------------------------------------------
-- 2. inventory_log safety: ensure the columns the PO functions write exist
------------------------------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS in the original migration is a no-op when a table
-- by that name already exists with a different schema, which is what happened
-- in production. Bring the existing table up to the expected shape.
ALTER TABLE inventory_log
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delta integer,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS reference_type text,
  ADD COLUMN IF NOT EXISTS reference_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Legacy inventory_log tables carried a NOT NULL variant_id from the old
-- product_variants design, which is no longer used (everything keys off
-- products now). Drop the NOT NULL so product-only restock rows can insert,
-- otherwise receiving fails with:
--   null value in column "variant_id" of relation "inventory_log" violates
--   not-null constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'inventory_log'
       AND column_name = 'variant_id'
  ) THEN
    ALTER TABLE inventory_log ALTER COLUMN variant_id DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_log_product ON inventory_log (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_log_reference ON inventory_log (reference_type, reference_id);

------------------------------------------------------------------------------
-- 3. receive_po_items — allow receiving on 'paid', keep the paid status
------------------------------------------------------------------------------
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
  -- 'paid' orders can still receive stock (paid-before-delivery is common);
  -- only a cancelled order rejects receiving.
  IF v_status = 'cancelled' THEN
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
       WHERE id = v_item.product_id;

      -- inventory_log's canonical quantity column is change_qty (NOT NULL);
      -- delta is a newer alias kept in sync. reference_id is text.
      INSERT INTO inventory_log
        (product_id, change_qty, delta, reason, reference_type, reference_id, created_by)
      VALUES
        (v_item.product_id, v_line.qty, v_line.qty, 'restock', 'purchase_order_receipt',
         v_receipt_id::text, p_actor);
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
                    -- 'paid' is a terminal payment state; receiving stock
                    -- against it must not silently revert it to a fulfilment
                    -- status.
                    WHEN v_status = 'paid' THEN 'paid'
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

------------------------------------------------------------------------------
-- 4. apply_po_inventory — same inventory_log column fix
------------------------------------------------------------------------------
-- Used when a PO is created directly as 'fulfilled'. It hit the same
-- inventory_log shape mismatch, so write change_qty (NOT NULL) and cast the
-- text reference_id.
CREATE OR REPLACE FUNCTION apply_po_inventory(po_id uuid)
RETURNS void AS $$
DECLARE
  v_already_applied boolean;
  v_actor uuid;
BEGIN
  SELECT inventory_applied, created_by
    INTO v_already_applied, v_actor
    FROM purchase_orders
   WHERE id = po_id
   FOR UPDATE;

  IF v_already_applied IS DISTINCT FROM false THEN
    RETURN;
  END IF;

  UPDATE products p
     SET stock_quantity = p.stock_quantity + i.qty,
         updated_at = now()
    FROM purchase_order_items i
   WHERE i.purchase_order_id = po_id
     AND i.product_id = p.id;

  INSERT INTO inventory_log
    (product_id, change_qty, delta, reason, reference_type, reference_id, created_by)
  SELECT product_id, qty, qty, 'restock', 'purchase_order', po_id::text, v_actor
    FROM purchase_order_items
   WHERE purchase_order_id = po_id
     AND product_id IS NOT NULL;

  UPDATE purchase_orders
     SET inventory_applied = true,
         inventory_applied_at = now()
   WHERE id = po_id;
END;
$$ LANGUAGE plpgsql;
