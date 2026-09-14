-- Christian Harcus — USD Price List + Labeled/Unlabeled pricing
-- =============================================================
-- Two things happen here:
--
--   1. SCHEMA (global): add an "unlabeled" price alongside the existing price on
--      both pricing tables. The EXISTING price column is the LABELED value
--      (vials shipped with a printed label). The new column is the UNLABELED
--      (base) value.
--        * pricelist_items.price            -> labeled   | + pricelist_items.unlabeled_price
--        * customer_price_overrides.override_price -> labeled | + .unlabeled_override_price
--      Existing rows keep their (labeled) price; unlabeled is NULL, which the
--      invoice treats as "no unlabeled price -> fall back to the labeled price".
--
--   2. DATA (Christian): build his pricelist from PURA_Price_List_USD (108 rows,
--      matched to products by SLUG = the PDF "Code" column), then apply it to
--      customer f31eb9af-8630-4cc1-805f-d36ca4aaf860 by copying the labeled +
--      unlabeled prices into customer_price_overrides. Christian is flipped to
--      price_currency = 'USD'; the stored numbers ARE the USD prices (they are
--      not converted — see the spec for the matching invoice-side change).
--
-- Prices are USD, box (pack-of-10) prices, exactly as printed in the PDF.
-- The PDF relationship is labeled = unlabeled + $10 (Bacteriostatic Water Pfizer
-- has a single price, stored the same for both).
--
-- Safe to run multiple times. Any PDF code with no matching active product is
-- skipped and listed via RAISE NOTICE at the end (23 of the 108 PDF rows are
-- strengths/variants the catalog does not carry — e.g. BC5/BC10 vs catalog BC20,
-- MS10/MS40 vs MS20 — and are intentionally not remapped onto a different SKU).

BEGIN;

------------------------------------------------------------------------------
-- 1. Schema: add the unlabeled columns (labeled = the existing price column)
------------------------------------------------------------------------------
ALTER TABLE pricelist_items
  ADD COLUMN IF NOT EXISTS unlabeled_price DECIMAL(10,2) CHECK (unlabeled_price >= 0);

ALTER TABLE customer_price_overrides
  ADD COLUMN IF NOT EXISTS unlabeled_override_price DECIMAL(10,2) CHECK (unlabeled_override_price >= 0);

COMMENT ON COLUMN pricelist_items.unlabeled_price IS
  'Unlabeled (base) price. The sibling "price" column is the labeled price (base + label fee). NULL means fall back to price.';
COMMENT ON COLUMN customer_price_overrides.unlabeled_override_price IS
  'Unlabeled (base) price for this customer. "override_price" is the labeled price. NULL means fall back to override_price. Referenced by the admin invoice label toggle.';

------------------------------------------------------------------------------
-- 2. Staging: the PDF price list (code = products.slug, unlabeled, labeled)
------------------------------------------------------------------------------
CREATE TEMP TABLE _christian_pdf (
  code      text PRIMARY KEY,
  unlabeled numeric(10,2) NOT NULL,
  labeled   numeric(10,2) NOT NULL
) ON COMMIT DROP;

INSERT INTO _christian_pdf (code, unlabeled, labeled) VALUES
  ('5AM5', 80, 90),   ('5AM10', 120, 130), ('5AM50', 160, 170), ('ADAMAX', 410, 420),
  ('AU50', 85, 95),   ('AU100', 135, 145), ('AR50', 160, 170),  ('PRO20', 210, 220),
  ('5AD', 135, 145),  ('10AD', 210, 220),  ('RA10', 135, 145),  ('BAPF', 16, 16),
  ('BA10', 35, 45),   ('BA3', 25, 35),     ('BC5', 55, 65),     ('BC10', 90, 100),
  ('BC20', 150, 160), ('CGL5', 140, 150),  ('CGL10', 235, 245), ('CBL60', 100, 110),
  ('CP10', 140, 150), ('CD5', 110, 120),   ('CND5', 105, 115),  ('CND10', 145, 155),
  ('DIH10', 155, 165),('DS5', 75, 85),     ('DS10', 100, 110),  ('ET10', 70, 80),
  ('ET50', 210, 220), ('F410', 500, 510),  ('CU50', 55, 65),    ('CU100', 70, 80),
  ('G210', 80, 90),   ('G610', 80, 90),    ('GLOW', 210, 220),  ('GTT1500', 110, 120),
  ('G5K', 100, 110),  ('G10K', 185, 195),  ('HX5', 160, 170),   ('H10', 110, 120),
  ('H15', 160, 170),  ('H24', 250, 260),   ('H36', 370, 380),   ('IG1', 235, 245),
  ('IP5', 70, 80),    ('IP10', 105, 115),  ('KS5', 70, 80),     ('KS10', 110, 120),
  ('KLOW', 310, 320), ('KPV5', 110, 120),  ('KPV10', 195, 205), ('LC1200', 160, 170),
  ('375', 120, 130),  ('MK75', 110, 120),  ('FM2', 210, 220),   ('MS10', 110, 120),
  ('MS40', 210, 220), ('MT1', 85, 95),     ('MT2', 85, 95),     ('NAD100', 75, 85),
  ('NAD500', 100, 110),('NAD1000', 160, 170),('OT2', 100, 110), ('OT5', 210, 220),
  ('OT10', 400, 410), ('P210', 160, 170),  ('FMP2', 90, 100),   ('PE10', 210, 220),
  ('PIN10', 140, 150),('PN10', 310, 320),  ('P41', 85, 95),     ('RT10', 125, 135),
  ('RT20', 210, 220), ('RT30', 310, 320),  ('RT40', 350, 360),  ('RT50', 410, 420),
  ('SK10', 100, 110), ('SM5', 70, 80),     ('SM10', 120, 130),  ('SM20', 150, 160),
  ('SM30', 185, 195), ('XA10', 110, 120),  ('XS20', 230, 240),  ('SMO5', 110, 120),
  ('SMO10', 190, 200),('3325', 160, 170),  ('NP810', 105, 115), ('2S10', 110, 120),
  ('2S50', 360, 370), ('TB5', 100, 110),   ('TB10', 170, 180),  ('TSM5', 140, 150),
  ('TSM10', 230, 240),('TSM20', 410, 420), ('TG20', 360, 370),  ('TY10', 90, 100),
  ('TA5', 100, 110),  ('TA10', 200, 210),  ('TR10', 90, 100),   ('TR20', 110, 120),
  ('TR30', 160, 170), ('TR40', 210, 220),  ('TR50', 285, 295),  ('TR60', 360, 370),
  ('VI20', 260, 270), ('VIP10', 120, 130), ('BB10', 140, 150),  ('BB20', 270, 280);

------------------------------------------------------------------------------
-- 3. Pricelist header (idempotent by name)
------------------------------------------------------------------------------
INSERT INTO pricelists (name, description, is_active)
SELECT 'Christian Harcus — USD Price List',
       'USD price list for Christian Harcus. price = labeled, unlabeled_price = base (labeled = base + $10). Source: PURA_Price_List_USD.',
       false
WHERE NOT EXISTS (
  SELECT 1 FROM pricelists WHERE name = 'Christian Harcus — USD Price List'
);

------------------------------------------------------------------------------
-- 4. Pricelist items from the PDF, matched to active products by SLUG
------------------------------------------------------------------------------
INSERT INTO pricelist_items (pricelist_id, product_id, price, unlabeled_price)
SELECT pl.id, p.id, d.labeled, d.unlabeled
  FROM _christian_pdf d
  JOIN products p ON p.slug = d.code AND p.active = true
  CROSS JOIN (SELECT id FROM pricelists WHERE name = 'Christian Harcus — USD Price List') pl
ON CONFLICT (pricelist_id, product_id) DO UPDATE
  SET price = EXCLUDED.price,
      unlabeled_price = EXCLUDED.unlabeled_price;

------------------------------------------------------------------------------
-- 5. Apply the list to Christian: copy labeled + unlabeled into his overrides
------------------------------------------------------------------------------
INSERT INTO customer_price_overrides (customer_id, product_id, override_price, unlabeled_override_price)
SELECT 'f31eb9af-8630-4cc1-805f-d36ca4aaf860'::uuid, pi.product_id, pi.price, pi.unlabeled_price
  FROM pricelist_items pi
  JOIN pricelists pl ON pl.id = pi.pricelist_id
 WHERE pl.name = 'Christian Harcus — USD Price List'
ON CONFLICT (customer_id, product_id) DO UPDATE
  SET override_price = EXCLUDED.override_price,
      unlabeled_override_price = EXCLUDED.unlabeled_override_price;

------------------------------------------------------------------------------
-- 6. Stamp Christian: record the source list + quote him in USD
------------------------------------------------------------------------------
UPDATE customers
   SET applied_pricelist_id = (SELECT id FROM pricelists WHERE name = 'Christian Harcus — USD Price List'),
       price_currency = 'USD',
       updated_at = now()
 WHERE id = 'f31eb9af-8630-4cc1-805f-d36ca4aaf860';

------------------------------------------------------------------------------
-- 7. Diagnostics: PDF codes with no matching active product (skipped)
------------------------------------------------------------------------------
DO $$
DECLARE
  missing text;
  unpriced text;
  matched int;
BEGIN
  -- PDF rows with no matching active product (strengths the catalog lacks).
  SELECT string_agg(d.code, ', ' ORDER BY d.code)
    INTO missing
    FROM _christian_pdf d
    LEFT JOIN products p ON p.slug = d.code AND p.active = true
   WHERE p.id IS NULL;

  -- Active products the PDF does not price (they keep default/fallback pricing).
  SELECT string_agg(p.slug, ', ' ORDER BY p.slug)
    INTO unpriced
    FROM products p
    LEFT JOIN _christian_pdf d ON d.code = p.slug
   WHERE p.active = true AND p.slug IS NOT NULL AND d.code IS NULL;

  SELECT count(*) INTO matched
    FROM pricelist_items pi
    JOIN pricelists pl ON pl.id = pi.pricelist_id
   WHERE pl.name = 'Christian Harcus — USD Price List';

  RAISE NOTICE 'Christian pricelist: % of 108 PDF rows priced.', matched;
  IF missing IS NOT NULL THEN
    RAISE NOTICE 'PDF codes with no active product (skipped — strength/variant not in catalog): %', missing;
  END IF;
  IF unpriced IS NOT NULL THEN
    RAISE NOTICE 'Active products NOT in this PDF (unchanged, keep default pricing): %', unpriced;
  END IF;
END $$;

COMMIT;
