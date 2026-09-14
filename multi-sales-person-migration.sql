-- Multiple sales people per invoice and per customer
-- =================================================
-- Run this in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- WHY
--   An invoice could only ever be attributed to ONE sales person
--   (invoices.sales_person_id + sales_person_commission_rate/_amount), and a
--   customer to one default (customers.default_sales_person_id). Deals are
--   frequently brought in by two or more people who each earn their own cut.
--
-- WHAT
--   Two roster tables that hold up to FIVE people each, every one with their
--   own commission percentage:
--     * invoice_sales_persons  — who earned on this invoice, and how much
--     * customer_sales_persons — who is assigned to this customer, at what rate
--
-- NOTHING IS REMOVED OR REWRITTEN
--   The existing single-person columns stay and keep their meaning: they are
--   now the PRIMARY (position 0) member of the roster. Every current reader —
--   affiliate scoping, analytics, genealogy, the commissions report, the
--   invoice list's sales-person filter — keeps working untouched, and older
--   invoices simply have a one-person roster after the backfill below.
--
--   The five-person cap is structural, not a trigger: position is CHECKed to
--   0..4 and unique per parent, so a sixth row cannot exist.

------------------------------------------------------------------------------
-- 0. set_updated_at() — defined defensively so this file can run standalone.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

------------------------------------------------------------------------------
-- 1. invoice_sales_persons — the per-invoice commission roster
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_sales_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  sales_person_id uuid NOT NULL REFERENCES sales_persons (id) ON DELETE CASCADE,
  -- Percent, like invoices.sales_person_commission_rate (5.00 = 5%).
  commission_rate numeric(5,2) NOT NULL DEFAULT 0,
  -- invoice total x rate, snapshotted so the split survives a rate change.
  commission_amount numeric(10,2) NOT NULL DEFAULT 0,
  -- 0 = primary (mirrored onto invoices.sales_person_id). Max five people.
  position smallint NOT NULL DEFAULT 0 CHECK (position >= 0 AND position <= 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_invoice_sales_person UNIQUE (invoice_id, sales_person_id),
  CONSTRAINT uniq_invoice_sales_person_position UNIQUE (invoice_id, position)
);

COMMENT ON TABLE invoice_sales_persons IS
  'Every sales person credited on an invoice, with their own commission rate and amount. Position 0 is the primary and is mirrored onto invoices.sales_person_id / _commission_rate / _commission_amount for backward compatibility. Capped at five rows per invoice by the position CHECK + unique constraint.';

CREATE INDEX IF NOT EXISTS idx_invoice_sales_persons_invoice
  ON invoice_sales_persons (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_sales_persons_sales_person
  ON invoice_sales_persons (sales_person_id);

------------------------------------------------------------------------------
-- 2. customer_sales_persons — the per-customer assignment roster
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_sales_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  sales_person_id uuid NOT NULL REFERENCES sales_persons (id) ON DELETE CASCADE,
  -- The rate this person earns on THIS customer's invoices. Pre-fills the
  -- invoice form; the invoice keeps its own snapshot once raised.
  commission_rate numeric(5,2) NOT NULL DEFAULT 0,
  position smallint NOT NULL DEFAULT 0 CHECK (position >= 0 AND position <= 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_customer_sales_person UNIQUE (customer_id, sales_person_id),
  CONSTRAINT uniq_customer_sales_person_position UNIQUE (customer_id, position)
);

COMMENT ON TABLE customer_sales_persons IS
  'Sales people assigned to a customer, each with the commission rate they earn on that customer. Position 0 is the primary and is mirrored onto customers.default_sales_person_id. Capped at five rows per customer.';

CREATE INDEX IF NOT EXISTS idx_customer_sales_persons_customer
  ON customer_sales_persons (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_sales_persons_sales_person
  ON customer_sales_persons (sales_person_id);

DROP TRIGGER IF EXISTS customer_sales_persons_updated_at ON customer_sales_persons;
CREATE TRIGGER customer_sales_persons_updated_at
  BEFORE UPDATE ON customer_sales_persons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

------------------------------------------------------------------------------
-- 3. Backfill — every existing attribution becomes a one-person roster
------------------------------------------------------------------------------
-- Invoices: the current sales person, rate and amount move in verbatim as
-- position 0. Nothing is recomputed, so historical commission math is
-- preserved exactly as it was recorded.
INSERT INTO invoice_sales_persons
  (invoice_id, sales_person_id, commission_rate, commission_amount, position)
SELECT
  i.id,
  i.sales_person_id,
  COALESCE(i.sales_person_commission_rate, 0),
  COALESCE(i.sales_person_commission_amount, 0),
  0
FROM invoices i
WHERE i.sales_person_id IS NOT NULL
ON CONFLICT ON CONSTRAINT uniq_invoice_sales_person DO NOTHING;

-- Customers: the saved default sales person becomes position 0. The rate comes
-- from that sales person's own default, which is exactly what the invoice form
-- already pre-filled for them.
INSERT INTO customer_sales_persons
  (customer_id, sales_person_id, commission_rate, position)
SELECT
  c.id,
  c.default_sales_person_id,
  COALESCE(sp.commission_rate, 0),
  0
FROM customers c
JOIN sales_persons sp ON sp.id = c.default_sales_person_id
WHERE c.default_sales_person_id IS NOT NULL
ON CONFLICT ON CONSTRAINT uniq_customer_sales_person DO NOTHING;

------------------------------------------------------------------------------
-- 4. Row Level Security — mirrors sales_commissions
------------------------------------------------------------------------------
ALTER TABLE invoice_sales_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_sales_persons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_sales_persons_admin_read ON invoice_sales_persons;
CREATE POLICY invoice_sales_persons_admin_read ON invoice_sales_persons
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role IN ('admin','assistant'))
  );

DROP POLICY IF EXISTS invoice_sales_persons_admin_write ON invoice_sales_persons;
CREATE POLICY invoice_sales_persons_admin_write ON invoice_sales_persons
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role = 'admin')
  );

DROP POLICY IF EXISTS customer_sales_persons_admin_read ON customer_sales_persons;
CREATE POLICY customer_sales_persons_admin_read ON customer_sales_persons
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role IN ('admin','assistant'))
  );

DROP POLICY IF EXISTS customer_sales_persons_admin_write ON customer_sales_persons;
CREATE POLICY customer_sales_persons_admin_write ON customer_sales_persons
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role = 'admin')
  );

------------------------------------------------------------------------------
-- 5. Sanity check (informational)
------------------------------------------------------------------------------
-- SELECT
--   (SELECT count(*) FROM invoices WHERE sales_person_id IS NOT NULL) AS invoices_attributed,
--   (SELECT count(*) FROM invoice_sales_persons)                      AS invoice_roster_rows,
--   (SELECT count(*) FROM customers WHERE default_sales_person_id IS NOT NULL) AS customers_attributed,
--   (SELECT count(*) FROM customer_sales_persons)                     AS customer_roster_rows;
