-- Purchase Orders — Line-item Receiving & Process History
-- =======================================================
-- Adds partial-receipt tracking on top of the purchase_orders module:
--   * purchase_order_items.qty_received     — cumulative quantity received
--   * purchase_order_receipts               — one row per receiving event
--   * purchase_order_receipt_items          — per line item received in an event
--   * receive_po_items()                    — atomic receive + stock + status
--
-- Inventory now flows through receiving (incrementally), so the PO status is
-- derived from received quantities:
--   no items received           -> pending
--   some but not all received   -> partially_fulfilled
--   every item fully received   -> fulfilled
-- ('paid' and 'cancelled' remain manual terminal states.)

------------------------------------------------------------------------------
-- 1. qty_received on line items
------------------------------------------------------------------------------
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS qty_received integer NOT NULL DEFAULT 0
    CHECK (qty_received >= 0);

-- Backfill: POs already fulfilled via the legacy all-at-once path count as
-- fully received so completion percentages read correctly for historical data.
UPDATE purchase_order_items i
   SET qty_received = i.qty
  FROM purchase_orders po
 WHERE po.id = i.purchase_order_id
   AND po.inventory_applied = true
   AND i.qty_received = 0;

------------------------------------------------------------------------------
-- 2. purchase_order_receipts (process history header)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_order_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders (id) ON DELETE CASCADE,
  note text,
  created_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_receipts_po_id
  ON purchase_order_receipts (purchase_order_id, created_at DESC);

------------------------------------------------------------------------------
-- 3. purchase_order_receipt_items (what was received in an event)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_order_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES purchase_order_receipts (id) ON DELETE CASCADE,
  po_item_id uuid NOT NULL REFERENCES purchase_order_items (id) ON DELETE CASCADE,
  product_id uuid REFERENCES products (id) ON DELETE SET NULL,
  qty integer NOT NULL CHECK (qty > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_receipt_items_receipt
  ON purchase_order_receipt_items (receipt_id);
CREATE INDEX IF NOT EXISTS idx_po_receipt_items_po_item
  ON purchase_order_receipt_items (po_item_id);

------------------------------------------------------------------------------
-- 4. receive_po_items(po_id, actor, note, items) — atomic receive
------------------------------------------------------------------------------
-- items is a JSON array: [{ "po_item_id": "<uuid>", "qty": <int> }, ...]
-- Runs in one transaction so concurrent receives/sales cannot race the
-- read-modify-write on stock. Returns the new receipt id.
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
       WHERE id = v_item.product_id;

      INSERT INTO inventory_log
        (product_id, delta, reason, reference_type, reference_id, created_by)
      VALUES
        (v_item.product_id, v_line.qty, 'restock', 'purchase_order_receipt', v_receipt_id, p_actor);
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

------------------------------------------------------------------------------
-- 5. Row Level Security
------------------------------------------------------------------------------
ALTER TABLE purchase_order_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_receipt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS po_receipts_admin_read ON purchase_order_receipts;
CREATE POLICY po_receipts_admin_read ON purchase_order_receipts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin', 'assistant')
    )
  );

DROP POLICY IF EXISTS po_receipt_items_admin_read ON purchase_order_receipt_items;
CREATE POLICY po_receipt_items_admin_read ON purchase_order_receipt_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin', 'assistant')
    )
  );
-- Writes happen exclusively through receive_po_items() via the service role.
