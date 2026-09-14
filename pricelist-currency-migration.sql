-- Pricelist currency tag
-- =======================
-- A pricelist can now be marked as holding CAD or USD prices. This lets the
-- admin invoice form price lines from a list without double-converting: a
-- USD-native list (e.g. "USD Wholesale Pricelist") shows its stored numbers
-- 1:1 on a USD invoice instead of running them through the CAD→USD rate.
--
--   * pricelists.currency — 'CAD' (default) or 'USD'. The stored pricelist_items
--     prices are in this currency.
--
-- Existing lists default to CAD (their prices were always treated as CAD), so
-- this is a safe, additive change. Any list whose name mentions USD is flipped
-- to 'USD' (covers the "USD Wholesale Pricelist" and "Christian Harcus — USD
-- Price List"); adjust below if a CAD list happens to carry "USD" in its name.
--
-- Run this in the Supabase SQL editor. Safe to run multiple times.

ALTER TABLE pricelists
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CAD'
  CHECK (currency IN ('CAD', 'USD'));

COMMENT ON COLUMN pricelists.currency IS
  'Currency the pricelist_items prices are stored in: "CAD" (default) or "USD". A USD list is shown 1:1 on a USD invoice (no exchange-rate conversion).';

-- Flip existing USD lists. The USD Wholesale Pricelist is the active list whose
-- prices were imported already in USD.
UPDATE pricelists
   SET currency = 'USD',
       updated_at = now()
 WHERE currency <> 'USD'
   AND name ILIKE '%usd%';
