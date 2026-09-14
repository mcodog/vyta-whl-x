-- USD price change history
-- ========================
-- Builds on:
--   * product-price-stock-history-migration.sql (product_change_history)
--   * product-usd-price-migration.sql (products.price_usd column)
--   * vial-price-and-price-type-migration.sql (last change to the field CHECK)
--
-- Lets product_change_history track `price_usd` changes so the admin Products
-- history modal has a "Price (USD)" tab, and seeds a baseline row per existing
-- product that has an explicit USD override.
--
-- Conventions:
--   * products.price_usd = the OPTIONAL explicit USD override. When NULL the USD
--     price is computed live as ROUND(price * usd_exchange_rate, 2) and there is
--     nothing to record — only explicit overrides produce history rows.

------------------------------------------------------------------------------
-- 1. Allow price_usd in the product change history.
------------------------------------------------------------------------------
ALTER TABLE product_change_history
  DROP CONSTRAINT IF EXISTS product_change_history_field_check;
ALTER TABLE product_change_history
  ADD CONSTRAINT product_change_history_field_check
  CHECK (field IN ('price', 'stock_quantity', 'vial_price', 'price_usd'));

------------------------------------------------------------------------------
-- 2. Seed a baseline 'create' row for every product with an explicit USD price
--    and no price_usd history yet, using created_at so the current value has a
--    known start time. Idempotent. Skips products with a NULL price_usd (those
--    use the auto rate and get their first history row on the next override).
------------------------------------------------------------------------------
INSERT INTO product_change_history (product_id, field, old_value, new_value, changed_by, change_source, created_at)
SELECT p.id, 'price_usd', NULL, p.price_usd, NULL, 'create', p.created_at
  FROM products p
 WHERE p.price_usd IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM product_change_history h
      WHERE h.product_id = p.id AND h.field = 'price_usd'
   );
