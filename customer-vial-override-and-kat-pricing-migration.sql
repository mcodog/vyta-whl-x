-- Per-Vial Customer Pricing + seed affiliate "Kat Torres"
-- Run this in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- WHY
--   customer_price_overrides only stored a per-customer BOX price
--   (override_price + unlabeled_override_price). Single-vial invoice lines had
--   no per-customer/affiliate price, so they always fell back to the catalog
--   products.vial_price (or price / 10). This adds a per-vial override so a
--   customer/affiliate is quoted their own single-vial price:
--     * box line  -> override_price / unlabeled_override_price (unchanged)
--     * vial line -> vial_override_price (NEW), falling back to the catalog
--                    vial_price / (price / 10) when null.
--
-- The seeded prices below are the catalog values (CAD). This assumes Kat is
-- quoted in CAD (the default). If her price_currency is USD, adjust her rows
-- afterwards.

-- ---------------------------------------------------------------------------
-- 1. Schema: per-vial override column (additive; existing rows unaffected).
-- ---------------------------------------------------------------------------
ALTER TABLE customer_price_overrides
  ADD COLUMN IF NOT EXISTS vial_override_price DECIMAL(10, 2) CHECK (vial_override_price >= 0);

COMMENT ON COLUMN customer_price_overrides.vial_override_price IS
  'Per-customer single-vial price. When set, vial-priced invoice/order lines use this instead of the catalog products.vial_price. NULL falls back to products.vial_price (or price / 10).';

-- ---------------------------------------------------------------------------
-- 2. Seed affiliate Kat Torres (getatkat@gmail.com) with her own price list:
--      box  = catalog price
--      vial = 2x the catalog vial_price (fallback 2x price/10 when vial_price
--             is null/0)
--    for every active product, so ALL of her invoice prices come from her own
--    overrides rather than the products table.
--
--    An affiliate is provisioned with id == customer id == auth uid (see the
--    affiliate-request approval flow), so her customer_price_overrides are
--    keyed on this same id. If this INSERT errors on a missing customer, her
--    customers row hasn't been created yet.
-- ---------------------------------------------------------------------------
INSERT INTO customer_price_overrides
  (customer_id, product_id, override_price, vial_override_price, is_visible)
SELECT
  'e112efa7-8d3e-49ab-8247-d14e2c6907c7'::uuid,
  p.id,
  ROUND(p.price, 2),
  ROUND(COALESCE(NULLIF(p.vial_price, 0), p.price / 10.0) * 2, 2),
  true
FROM products p
WHERE p.active = true
ON CONFLICT (customer_id, product_id) DO UPDATE
  SET override_price      = EXCLUDED.override_price,
      vial_override_price = EXCLUDED.vial_override_price,
      is_visible          = true,
      updated_at          = now();

-- Verify (optional): her per-vial prices should be double the catalog vial price.
-- SELECT p.name, p.price AS catalog_box, p.vial_price AS catalog_vial,
--        o.override_price AS kat_box, o.vial_override_price AS kat_vial
--   FROM customer_price_overrides o
--   JOIN products p ON p.id = o.product_id
--  WHERE o.customer_id = 'e112efa7-8d3e-49ab-8247-d14e2c6907c7'
--  ORDER BY p.name;
