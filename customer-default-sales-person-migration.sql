-- Customer default sales person
-- =============================
-- Links a customer to a "default" sales person / affiliate so that new invoices
-- created for that customer auto-fill the sales person (and their commission
-- rate). The default is set from the invoice form via a "Save this sales person
-- to the customer" checkbox, and shown in the admin Customers list.
--
-- Run this in the Supabase SQL editor.

------------------------------------------------------------------------------
-- 1. customers: default_sales_person_id column
------------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS default_sales_person_id uuid
    REFERENCES sales_persons (id) ON DELETE SET NULL;

COMMENT ON COLUMN customers.default_sales_person_id IS
  'The sales person auto-filled on new invoices for this customer. Set from the invoice form; a null value means no default. Cleared automatically if the sales person is deleted.';

CREATE INDEX IF NOT EXISTS idx_customers_default_sales_person_id
  ON customers (default_sales_person_id);

------------------------------------------------------------------------------
-- 2. Backfill from existing invoices
------------------------------------------------------------------------------
-- For every customer whose past invoices are all attributed to exactly ONE
-- sales person, adopt that sales person as their default. Customers whose
-- invoices reference two or more different sales persons are "conflicting" and
-- are skipped — there is no single non-ambiguous choice for them. Customers
-- that already carry a default are left untouched.
WITH customer_sp AS (
  SELECT
    customer_id,
    COUNT(DISTINCT sales_person_id) AS sp_count,
    MIN(sales_person_id)            AS sole_sales_person_id
  FROM invoices
  WHERE customer_id IS NOT NULL
    AND sales_person_id IS NOT NULL
  GROUP BY customer_id
)
UPDATE customers c
SET default_sales_person_id = cs.sole_sales_person_id
FROM customer_sp cs
WHERE c.id = cs.customer_id
  AND cs.sp_count = 1
  AND c.default_sales_person_id IS NULL;
