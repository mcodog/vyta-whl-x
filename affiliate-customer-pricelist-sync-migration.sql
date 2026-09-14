-- Affiliate ↔ own-customer-record price-list reconciliation (one-time backfill)
-- ===========================================================================
-- Run this once in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- An affiliate has the same auth UID across the customers, affiliates and
-- sales_persons tables (ADR 0003), and that UID keys TWO price lists that are
-- meant to hold the same prices but were written by different code paths:
--
--   1. customer_price_overrides WHERE customer_id  = <uid>
--        The affiliate's OWN record — prices the invoices they create.
--   2. affiliate_price_overrides WHERE affiliate_id = <uid>
--        The affiliate's price list — copied onto every bound customer.
--
-- Going forward the application keeps these identical (see
-- lib/admin/affiliate-pricelist-sync.ts). This script reconciles rows that
-- drifted BEFORE that change shipped.
--
-- Only the labeled BOX price (override_price) is shared between the two tables;
-- unlabeled / per-vial / visibility data lives only on side (1) and is left
-- untouched. Only positive, visible box prices are treated as sellable.
--
-- Conflict rule: when both lists have a (different) price for the same product,
-- the more recently updated row wins — the natural extension of the "last write
-- wins" sync the application now performs.

BEGIN;

-- Sellable box prices from each side, per affiliate + product, with their edit
-- time, then the winner (newer updated_at) of the two.
CREATE TEMP TABLE _affiliate_pricelist_reconcile AS
WITH affiliate_rows AS (
  SELECT apo.affiliate_id AS aff_id,
         apo.product_id,
         apo.override_price AS price,
         apo.updated_at     AS ts
  FROM affiliate_price_overrides apo
  WHERE apo.override_price IS NOT NULL
    AND apo.override_price > 0
),
own_rows AS (
  SELECT cpo.customer_id AS aff_id,
         cpo.product_id,
         cpo.override_price AS price,
         cpo.updated_at     AS ts
  FROM customer_price_overrides cpo
  WHERE cpo.customer_id IN (SELECT id FROM affiliates)
    AND cpo.override_price IS NOT NULL
    AND cpo.override_price > 0
    AND cpo.is_visible IS DISTINCT FROM FALSE
)
SELECT
  COALESCE(a.aff_id, o.aff_id)         AS aff_id,
  COALESCE(a.product_id, o.product_id) AS product_id,
  CASE
    WHEN a.aff_id IS NULL           THEN o.price   -- only the own record has it
    WHEN o.aff_id IS NULL           THEN a.price   -- only the affiliate list has it
    WHEN a.ts >= o.ts               THEN a.price   -- affiliate list edited last
    ELSE o.price                                   -- own record edited last
  END AS price
FROM affiliate_rows a
FULL OUTER JOIN own_rows o
  ON a.aff_id = o.aff_id AND a.product_id = o.product_id;

-- Push the winning prices into BOTH tables so they match.
INSERT INTO affiliate_price_overrides (affiliate_id, product_id, override_price)
SELECT aff_id, product_id, price FROM _affiliate_pricelist_reconcile
ON CONFLICT (affiliate_id, product_id)
DO UPDATE SET override_price = EXCLUDED.override_price, updated_at = now()
WHERE affiliate_price_overrides.override_price IS DISTINCT FROM EXCLUDED.override_price;

INSERT INTO customer_price_overrides (customer_id, product_id, override_price)
SELECT aff_id, product_id, price FROM _affiliate_pricelist_reconcile
ON CONFLICT (customer_id, product_id)
DO UPDATE SET override_price = EXCLUDED.override_price, updated_at = now()
WHERE customer_price_overrides.override_price IS DISTINCT FROM EXCLUDED.override_price;

DROP TABLE _affiliate_pricelist_reconcile;

COMMIT;

-- Verify (optional): rows where the two lists still disagree should be empty.
--   SELECT a.affiliate_id, a.product_id, a.override_price AS affiliate_price,
--          c.override_price AS own_record_price
--   FROM affiliate_price_overrides a
--   JOIN customer_price_overrides c
--     ON c.customer_id = a.affiliate_id AND c.product_id = a.product_id
--   WHERE a.override_price IS DISTINCT FROM c.override_price;
