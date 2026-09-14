-- PuraMass hosted checkout — single-vial SKU mapping
-- =====================================================================
-- Run this in the Supabase SQL editor (after puramass-hosted-checkout-migration.sql).
--
-- The original mapping (products.puramass_sku) only covers the 10-pack SKUs
-- (`…-10-pack`). Single-vial cart lines need the vial SKUs (`…-vial`), which are
-- a separate PuraMass product with their own SKU and price. This adds a second
-- mapping column so a product can hand off as either a 10-pack or a single vial
-- depending on what the customer chose.

ALTER TABLE products ADD COLUMN IF NOT EXISTS puramass_sku_vial VARCHAR(80);

CREATE INDEX IF NOT EXISTS idx_products_puramass_sku_vial
  ON products (puramass_sku_vial) WHERE puramass_sku_vial IS NOT NULL;

COMMENT ON COLUMN products.puramass_sku_vial IS
  'PuraMass single-vial SKU (e.g. puramass-retatrutide-10mg-vial), used when a cart line is a single vial. NULL until mapped. Auto-filled by the admin SKU sync alongside puramass_sku (the 10-pack SKU).';
