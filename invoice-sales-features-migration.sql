-- Invoices Module — Sales Person & Commissions
-- =============================================
-- Adds the sales_persons table, sales_commissions ledger, and links them to
-- invoices. Commission rows are written automatically when an invoice has
-- a sales_person_id set and a non-zero commission amount.

------------------------------------------------------------------------------
-- 1. sales_persons
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  commission_rate numeric(5,2) NOT NULL DEFAULT 5.00,
  notes text,
  active boolean NOT NULL DEFAULT true,
  total_earnings numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_persons_active ON sales_persons (active);
CREATE INDEX IF NOT EXISTS idx_sales_persons_name
  ON sales_persons (lower(last_name), lower(first_name));

DROP TRIGGER IF EXISTS sales_persons_updated_at ON sales_persons;
CREATE TRIGGER sales_persons_updated_at
  BEFORE UPDATE ON sales_persons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

------------------------------------------------------------------------------
-- 2. invoices: sales person columns
------------------------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS sales_person_id uuid REFERENCES sales_persons (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sales_person_commission_rate numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_person_commission_amount numeric(10,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_invoices_sales_person_id
  ON invoices (sales_person_id);

------------------------------------------------------------------------------
-- 3. sales_commissions
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_person_id uuid NOT NULL REFERENCES sales_persons (id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices (id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL,
  invoice_total numeric(10,2) NOT NULL,
  commission_rate numeric(5,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','cancelled')),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_commissions_sales_person_id
  ON sales_commissions (sales_person_id);
CREATE INDEX IF NOT EXISTS idx_sales_commissions_invoice_id
  ON sales_commissions (invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_commissions_status
  ON sales_commissions (status);

------------------------------------------------------------------------------
-- 4. Row Level Security
------------------------------------------------------------------------------
ALTER TABLE sales_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_persons_admin_read ON sales_persons;
CREATE POLICY sales_persons_admin_read ON sales_persons
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role IN ('admin','assistant'))
  );

DROP POLICY IF EXISTS sales_persons_admin_write ON sales_persons;
CREATE POLICY sales_persons_admin_write ON sales_persons
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role = 'admin')
  );

DROP POLICY IF EXISTS sales_commissions_admin_read ON sales_commissions;
CREATE POLICY sales_commissions_admin_read ON sales_commissions
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role IN ('admin','assistant'))
  );

DROP POLICY IF EXISTS sales_commissions_admin_write ON sales_commissions;
CREATE POLICY sales_commissions_admin_write ON sales_commissions
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role = 'admin')
  );
