-- Backfill customer price_currency from their applied price list
-- =============================================================
-- Fixes a discrepancy where a customer priced from a USD price list still shows
-- up as CAD. Applying a price list to a customer copies that list's (possibly
-- USD) prices into customer_price_overrides, but historically did NOT update
-- customers.price_currency — so it stayed at its 'CAD' default. Every downstream
-- view (the products download report, invoices, the new price-sheet PDFs) reads
-- price_currency, so those customers were labelled CAD despite holding USD
-- numbers.
--
-- The apply-to-customer API now syncs price_currency going forward; this one-off
-- repair aligns the customers who were already applied a list.
--
-- A customer's applied price list is authoritative for the currency of their
-- stored override numbers, so we set price_currency to that list's currency.
-- The list currency comes from pricelists.currency, falling back to inferring
-- USD from the list name (mirrors the app's currencyOf helper) for any list
-- whose currency column somehow wasn't set.
--
-- Idempotent and safe to run multiple times. Run this in the Supabase SQL editor.

BEGIN;

WITH applied AS (
  SELECT
    c.id AS customer_id,
    CASE
      WHEN pl.currency = 'USD' THEN 'USD'
      WHEN pl.currency = 'CAD' THEN 'CAD'
      WHEN pl.name ILIKE '%usd%' THEN 'USD'
      ELSE 'CAD'
    END AS list_currency
  FROM customers c
  JOIN pricelists pl ON pl.id = c.applied_pricelist_id
  WHERE c.applied_pricelist_id IS NOT NULL
)
UPDATE customers c
   SET price_currency = a.list_currency,
       updated_at = now()
  FROM applied a
 WHERE c.id = a.customer_id
   AND c.price_currency IS DISTINCT FROM a.list_currency;

-- Report how many rows were realigned.
DO $$
DECLARE
  usd_count int;
BEGIN
  SELECT count(*) INTO usd_count
    FROM customers c
    JOIN pricelists pl ON pl.id = c.applied_pricelist_id
   WHERE c.price_currency = 'USD';
  RAISE NOTICE 'Customers now tagged USD via an applied price list: %', usd_count;
END $$;

COMMIT;
