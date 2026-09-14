-- Pricelist Enhancements Migration
-- Run this in Supabase SQL Editor.
--
-- Builds on pricelist-migration.sql. Adds the metadata the admin Price Lists
-- view needs (a human description + who created the list) and lets a customer
-- record remember which price list was last applied to them.
--
-- Purely additive — no existing data is touched.

-- ---------------------------------------------------------------------------
-- pricelists: description + created_by
-- ---------------------------------------------------------------------------
ALTER TABLE pricelists
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pricelists_created_by ON pricelists(created_by);

COMMENT ON COLUMN pricelists.description IS 'Optional human-readable description shown in the admin Price Lists view.';
COMMENT ON COLUMN pricelists.created_by IS 'Customer/staff id that created the list (nullable — legacy lists have none).';

-- ---------------------------------------------------------------------------
-- customers: applied_pricelist_id
--   Which price list was most recently applied to this customer. Applying a
--   list copies its item prices into customer_price_overrides; this column just
--   records the source so the UI can show "Price list: X" and warn before an
--   overwrite. ON DELETE SET NULL so deleting a list never orphans a customer.
-- ---------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS applied_pricelist_id UUID REFERENCES pricelists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_applied_pricelist ON customers(applied_pricelist_id);

COMMENT ON COLUMN customers.applied_pricelist_id IS 'The price list last applied to this customer (source of their price overrides). Null when prices were set manually or never from a list.';
