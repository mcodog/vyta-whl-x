-- Vial pricing: history + box/vial line tagging
-- =============================================
-- Builds on:
--   * product-price-stock-history-migration.sql (product_change_history)
--   * the products.vial_price column + trg_products_set_vial_price trigger
--     (added directly on the database).
--
-- This migration:
--   1. Lets product_change_history track `vial_price` changes (so the admin
--      Products history modal has a Vial tab) and seeds a baseline row per
--      existing product.
--   2. Adds a `price_type` tag to order / invoice / purchase-order line items
--      so it is clear whether a line was sold/charged at the box (pack of 10)
--      price or the single-vial price.
--
-- Conventions:
--   * 'box'  = the product.price (pack of 10) price.
--   * 'vial' = the product.vial_price (single vial) price.

------------------------------------------------------------------------------
-- 1. Allow vial_price in the product change history + seed a baseline.
------------------------------------------------------------------------------
ALTER TABLE product_change_history
  DROP CONSTRAINT IF EXISTS product_change_history_field_check;
ALTER TABLE product_change_history
  ADD CONSTRAINT product_change_history_field_check
  CHECK (field IN ('price', 'stock_quantity', 'vial_price'));

-- Seed a baseline 'create' row for vial_price for every product that doesn't
-- have vial_price history yet, using created_at so the current value has a
-- known start time. Idempotent. Skips products with a null vial_price (the
-- new_value column is NOT NULL — those get their first history row on the next
-- edit instead).
INSERT INTO product_change_history (product_id, field, old_value, new_value, changed_by, change_source, created_at)
SELECT p.id, 'vial_price', NULL, p.vial_price, NULL, 'create', p.created_at
  FROM products p
 WHERE p.vial_price IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM product_change_history h
      WHERE h.product_id = p.id AND h.field = 'vial_price'
   );

------------------------------------------------------------------------------
-- 2. Box / vial tagging on line items.
------------------------------------------------------------------------------

-- Orders: nullable + no default on purpose. Existing orders stay NULL ("no
-- tag"); only new orders created after this change carry 'box' / 'vial'.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS price_type text
    CHECK (price_type IS NULL OR price_type IN ('box', 'vial'));

-- Invoices & purchase orders default to 'box' (the pack-of-10 price), matching
-- the form default. Existing rows backfill to 'box'.
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS price_type text NOT NULL DEFAULT 'box'
    CHECK (price_type IN ('box', 'vial'));

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS price_type text NOT NULL DEFAULT 'box'
    CHECK (price_type IN ('box', 'vial'));
