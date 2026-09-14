-- Checkout add-on products (upsell)
-- =====================================================================
-- Run this in the Supabase SQL editor.
--
-- Flags products that should be offered as an upsell in the cart and checkout
-- (e.g. bacteriostatic water, which every peptide order needs to reconstitute).
-- Flagged, active, in-stock products surface in a "Complete your order" section.
-- The storefront groups flagged products that share a base name (e.g. the 3mL /
-- 10mL / 30mL bacteriostatic water sizes) into one card with a size selector.
--
-- Adds:
--   products.is_checkout_addon — when true, the product is offered as a checkout
--   / cart add-on. Defaults to false.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_checkout_addon BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN products.is_checkout_addon IS
  'When true, the product is offered as an upsell add-on in the cart and checkout (e.g. bacteriostatic water).';

-- Flag the active bacteriostatic water sizes as add-ons. The inactive Pfizer
-- variant (BAPF) is intentionally left off.
UPDATE products
  SET is_checkout_addon = true
  WHERE sku IN ('BA3', 'BA10', 'BA30');
