-- Purchase Orders Module
-- =====================
-- Creates suppliers, purchase_orders, purchase_order_items, and inventory_log,
-- plus a po_number sequence and an atomic apply_po_inventory() function for
-- transactional stock fulfilment.
--
-- Status vocabulary (CHECK constraint matches the TypeScript type):
--   pending | partially_fulfilled | fulfilled | paid | cancelled

------------------------------------------------------------------------------
-- 1. suppliers
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  email text,
  phone text,
  lead_time_days integer DEFAULT 7,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers (lower(name));

------------------------------------------------------------------------------
-- 2. purchase_orders
------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS po_number_seq START WITH 1001;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text UNIQUE NOT NULL
    DEFAULT 'PO-' || LPAD(nextval('po_number_seq')::text, 5, '0'),
  supplier_id uuid NOT NULL REFERENCES suppliers (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','partially_fulfilled','fulfilled','paid','cancelled')),
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  tax_type text NOT NULL DEFAULT 'percentage'
    CHECK (tax_type IN ('percentage','fixed')),
  tax_value numeric(10,2) NOT NULL DEFAULT 0,
  tax_total numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  notes text,
  expected_date date,
  inventory_applied boolean NOT NULL DEFAULT false,
  inventory_applied_at timestamptz,
  created_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id ON purchase_orders (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders (status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at ON purchase_orders (created_at DESC);

------------------------------------------------------------------------------
-- 3. purchase_order_items
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders (id) ON DELETE CASCADE,
  product_id uuid REFERENCES products (id) ON DELETE SET NULL,
  description text NOT NULL,
  sku_snapshot text,
  qty integer NOT NULL CHECK (qty > 0),
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  line_total numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_items_po_id ON purchase_order_items (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_items_product_id ON purchase_order_items (product_id);

------------------------------------------------------------------------------
-- 4. inventory_log
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products (id) ON DELETE SET NULL,
  delta integer NOT NULL,
  reason text NOT NULL,
  reference_type text,
  reference_id uuid,
  created_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_log_product ON inventory_log (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_log_reference ON inventory_log (reference_type, reference_id);

------------------------------------------------------------------------------
-- 5. updated_at trigger
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON suppliers;
CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER trg_purchase_orders_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

------------------------------------------------------------------------------
-- 6. apply_po_inventory(po_id) — atomic stock increment
------------------------------------------------------------------------------
-- Runs in a single SQL block so concurrent sales cannot race the read-modify-
-- write. Idempotent: returns early if inventory_applied is already true.
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

  INSERT INTO inventory_log (product_id, delta, reason, reference_type, reference_id, created_by)
  SELECT product_id, qty, 'restock', 'purchase_order', po_id, v_actor
    FROM purchase_order_items
   WHERE purchase_order_id = po_id
     AND product_id IS NOT NULL;

  UPDATE purchase_orders
     SET inventory_applied = true,
         inventory_applied_at = now()
   WHERE id = po_id;
END;
$$ LANGUAGE plpgsql;

------------------------------------------------------------------------------
-- 7. Row Level Security
------------------------------------------------------------------------------
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_log ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS automatically; explicit policies cover JWT clients.

-- suppliers: read for admin/assistant, write for admin only
DROP POLICY IF EXISTS suppliers_admin_read ON suppliers;
CREATE POLICY suppliers_admin_read ON suppliers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin','assistant')
    )
  );

DROP POLICY IF EXISTS suppliers_admin_write ON suppliers;
CREATE POLICY suppliers_admin_write ON suppliers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'admin'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'admin'
    )
  );

-- purchase_orders
DROP POLICY IF EXISTS po_admin_read ON purchase_orders;
CREATE POLICY po_admin_read ON purchase_orders
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin','assistant')
    )
  );

DROP POLICY IF EXISTS po_admin_write ON purchase_orders;
CREATE POLICY po_admin_write ON purchase_orders
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'admin'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'admin'
    )
  );

-- purchase_order_items
DROP POLICY IF EXISTS po_items_admin_read ON purchase_order_items;
CREATE POLICY po_items_admin_read ON purchase_order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin','assistant')
    )
  );

DROP POLICY IF EXISTS po_items_admin_write ON purchase_order_items;
CREATE POLICY po_items_admin_write ON purchase_order_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'admin'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'admin'
    )
  );

-- inventory_log: read-only for admin/assistant; writes happen through SECURITY
-- DEFINER functions or the service role
DROP POLICY IF EXISTS inventory_log_admin_read ON inventory_log;
CREATE POLICY inventory_log_admin_read ON inventory_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin','assistant')
    )
  );
