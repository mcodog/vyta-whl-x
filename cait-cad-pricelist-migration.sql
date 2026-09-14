-- Cait — CAD Price List
-- =====================
-- Creates a new pricing record ("Cait — CAD Price List") from the
-- CAD_Pricelist_for_Cait PDF (80 rows), matched to products by SLUG = the PDF
-- "Code" column (same convention as the USD price-list migrations).
--
--   * pricelists              -> one header row, currency = CAD, is_active = false.
--   * pricelist_items.price   -> the CAD (box / pack-of-10) price from the PDF.
--     unlabeled_price is left NULL (this list has no labeled/unlabeled split;
--     the invoice falls back to the labeled price).
--
-- The list is CAD, so on a USD invoice its prices are converted up by the site
-- exchange rate (a CAD-native list — the name has no "USD", so it resolves to
-- CAD whether or not pricelists.currency has been migrated).
--
-- NOT attached to a customer and NOT activated — it's just a pricing record the
-- admin can select in the invoice builder or apply to a customer later.
--
-- Safe to run multiple times (idempotent). Any PDF code with no matching active
-- product is skipped and listed via RAISE NOTICE at the end. A few codes are new
-- strengths the catalog may not carry (e.g. CD2, CND2, H12) and PFBA (the PDF's
-- code for Pfizer Bacteriostatic Water, vs BAPF elsewhere) — those simply won't
-- match and will be reported, not remapped.

BEGIN;

------------------------------------------------------------------------------
-- 1. Staging: the PDF price list (code = products.slug, CAD price)
------------------------------------------------------------------------------
CREATE TEMP TABLE _cait_pdf (
  code  text PRIMARY KEY,
  price numeric(10,2) NOT NULL
) ON COMMIT DROP;

INSERT INTO _cait_pdf (code, price) VALUES
  ('5AM5', 182),   ('5AM10', 273),  ('5AM50', 363),  ('5AD', 309),
  ('10AD', 472),   ('RA10', 309),   ('BA30', 155),   ('BA10', 83),
  ('BC5', 128),    ('BC10', 182),   ('CGL5', 318),   ('CGL10', 535),
  ('CP10', 318),   ('CD2', 237),    ('CD5', 245),    ('CND2', 182),
  ('CND5', 237),   ('CND10', 327),  ('DS5', 173),    ('DS10', 228),
  ('ET10', 155),   ('ET50', 472),   ('CU50', 128),   ('CU100', 155),
  ('GLOW', 472),   ('GTT1500', 245),('G2K', 173),    ('G5K', 228),
  ('G10K', 418),   ('H10', 137),    ('H12', 182),    ('H15', 218),
  ('H24', 427),    ('H36', 535),    ('IG1', 535),    ('IP5', 155),
  ('IP10', 228),   ('KS5', 155),    ('KS10', 245),   ('KLOW', 699),
  ('KPV5', 145),   ('KPV10', 218),  ('MS10', 245),   ('MS40', 472),
  ('MT1', 192),    ('MT2', 192),    ('NAD500', 228), ('NAD1000', 337),
  ('OT5', 155),    ('PFBA', 30),    ('P41', 192),    ('RT10', 282),
  ('RT20', 472),   ('RT30', 699),   ('RT40', 789),   ('RT50', 943),
  ('SK10', 228),   ('SM10', 264),   ('SM20', 337),   ('XA10', 245),
  ('SMO5', 218),   ('SMO10', 399),  ('3325', 363),   ('NP810', 182),
  ('2S10', 245),   ('2S50', 817),   ('TB5', 228),    ('TB10', 382),
  ('TSM5', 290),   ('TSM10', 499),  ('TY10', 218),   ('TA5', 254),
  ('TA10', 472),   ('TR10', 200),   ('TR20', 245),   ('TR30', 363),
  ('TR40', 472),   ('VIP10', 282),  ('BB10', 309),   ('BB20', 563);

------------------------------------------------------------------------------
-- 2. Pricelist header (idempotent by name)
------------------------------------------------------------------------------
INSERT INTO pricelists (name, description, is_active)
SELECT 'Cait — CAD Price List',
       'CAD price list for Cait. price = CAD box (pack-of-10) price. Source: CAD_Pricelist_for_Cait.',
       false
WHERE NOT EXISTS (
  SELECT 1 FROM pricelists WHERE name = 'Cait — CAD Price List'
);

------------------------------------------------------------------------------
-- 3. Pricelist items from the PDF, matched to active products by SLUG
------------------------------------------------------------------------------
INSERT INTO pricelist_items (pricelist_id, product_id, price)
SELECT pl.id, p.id, d.price
  FROM _cait_pdf d
  JOIN products p ON p.slug = d.code AND p.active = true
  CROSS JOIN (SELECT id FROM pricelists WHERE name = 'Cait — CAD Price List') pl
ON CONFLICT (pricelist_id, product_id) DO UPDATE
  SET price = EXCLUDED.price;

------------------------------------------------------------------------------
-- 4. Diagnostics: PDF codes with no matching active product (skipped)
------------------------------------------------------------------------------
DO $$
DECLARE
  missing text;
  matched int;
BEGIN
  SELECT string_agg(d.code, ', ' ORDER BY d.code)
    INTO missing
    FROM _cait_pdf d
    LEFT JOIN products p ON p.slug = d.code AND p.active = true
   WHERE p.id IS NULL;

  SELECT count(*) INTO matched
    FROM pricelist_items pi
    JOIN pricelists pl ON pl.id = pi.pricelist_id
   WHERE pl.name = 'Cait — CAD Price List';

  RAISE NOTICE 'Cait pricelist: % of 80 PDF rows priced.', matched;
  IF missing IS NOT NULL THEN
    RAISE NOTICE 'PDF codes with no active product (skipped): %', missing;
  END IF;
END $$;

COMMIT;
