-- Invoices Module — Base Schema
-- =============================
-- Status vocabulary matches the TypeScript type:
--   draft | sent | partial | paid | overdue
--
-- RLS is scoped from day one: service_role gets full bypass, admin/assistant
-- get read access, admins get write access. No blanket `USING (true)`.

------------------------------------------------------------------------------
-- 1. invoices
------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 1000;

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE NOT NULL
    DEFAULT 'INV-' || nextval('invoice_number_seq')::text,
  order_id uuid REFERENCES orders (id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers (id) ON DELETE SET NULL,
  customer_name text,
  customer_email text,
  customer_phone text,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_total numeric(10,2) NOT NULL DEFAULT 0,
  shipping_cost numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','partial','paid','overdue')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices (order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices (due_date);
-- Idempotency for autoCreateInvoiceFromOrder: one invoice per order at most.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoices_order_id
  ON invoices (order_id) WHERE order_id IS NOT NULL;

------------------------------------------------------------------------------
-- 2. invoice_line_items
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  product_id uuid REFERENCES products (id) ON DELETE SET NULL,
  description text NOT NULL,
  qty integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  line_total numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_id
  ON invoice_line_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_product_id
  ON invoice_line_items (product_id);

------------------------------------------------------------------------------
-- 3. payments
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CONSTRAINT payments_method_check
    CHECK (method IN ('card','e-transfer','cash','crypto','other')),
  reference_note text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments (invoice_id);

------------------------------------------------------------------------------
-- 4. updated_at trigger (shared)
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_updated_at ON invoices;
CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

------------------------------------------------------------------------------
-- 5. mark_overdue_invoices() RPC
------------------------------------------------------------------------------
-- Sweeps invoices whose due date has passed; returns the row count.
-- Called by GET /api/admin/invoices and GET /api/admin/invoices/aging on each
-- request. For real-time freshness, the API additionally computes a virtual
-- `status_effective` field so list views don't depend on the sweep firing.
CREATE OR REPLACE FUNCTION mark_overdue_invoices()
RETURNS integer AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE invoices
     SET status = 'overdue',
         updated_at = now()
   WHERE due_date < CURRENT_DATE
     AND status IN ('sent','partial');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

------------------------------------------------------------------------------
-- 6. Row Level Security
------------------------------------------------------------------------------
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- invoices
DROP POLICY IF EXISTS invoices_admin_read ON invoices;
CREATE POLICY invoices_admin_read ON invoices
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin','assistant')
    )
  );

DROP POLICY IF EXISTS invoices_admin_write ON invoices;
CREATE POLICY invoices_admin_write ON invoices
  FOR ALL TO authenticated USING (
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

-- invoice_line_items
DROP POLICY IF EXISTS line_items_admin_read ON invoice_line_items;
CREATE POLICY line_items_admin_read ON invoice_line_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin','assistant')
    )
  );

DROP POLICY IF EXISTS line_items_admin_write ON invoice_line_items;
CREATE POLICY line_items_admin_write ON invoice_line_items
  FOR ALL TO authenticated USING (
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

-- payments
DROP POLICY IF EXISTS payments_admin_read ON payments;
CREATE POLICY payments_admin_read ON payments
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin','assistant')
    )
  );

DROP POLICY IF EXISTS payments_admin_write ON payments;
CREATE POLICY payments_admin_write ON payments
  FOR ALL TO authenticated USING (
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
