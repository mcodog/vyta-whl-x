-- Per-Customer Product Status (visibility) Migration
-- Run this in Supabase SQL Editor
--
-- Adds a per-customer product "status" alongside the per-customer price.
-- When a product's status is set to hidden (is_visible = false) for a customer,
-- it is excluded from that customer's storefront/product listings — even if the
-- product has no custom price.
--
-- Because a customer may be hidden a product WITHOUT having a custom price for
-- it, override_price is relaxed to allow NULL: a row can now represent a
-- price override, a visibility override, or both.

-- 1. New status column (defaults to visible so existing rows are unaffected).
ALTER TABLE customer_price_overrides
  ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT true;

-- 2. Allow visibility-only rows (no custom price). The CHECK (override_price >= 0)
--    still holds for non-null values.
ALTER TABLE customer_price_overrides
  ALTER COLUMN override_price DROP NOT NULL;

-- 3. Index for the "which products are hidden for this customer" lookup used by
--    the storefront product queries.
CREATE INDEX IF NOT EXISTS idx_overrides_customer_hidden
  ON customer_price_overrides(customer_id)
  WHERE is_visible = false;

-- Documentation
COMMENT ON COLUMN customer_price_overrides.is_visible IS
  'Per-customer product visibility. When false, the product is hidden from this customer''s storefront/product listings. Defaults to true.';
COMMENT ON COLUMN customer_price_overrides.override_price IS
  'The custom price for this customer. NULL means no custom price (row exists only to carry a visibility override). Must be non-negative when set.';
