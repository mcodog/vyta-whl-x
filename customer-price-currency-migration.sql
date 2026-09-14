-- Customer price-display currency tag
-- Adds a per-customer marking for which currency this customer is quoted in:
--   * price_currency — 'CAD' or 'USD' (default CAD).
-- This mirrors the invoice-level `currency` flag: it tags the customer so new
-- invoices raised for them default to that currency. Prices themselves are not
-- converted by this column — it only records the customer's expected currency.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS price_currency TEXT NOT NULL DEFAULT 'CAD';

COMMENT ON COLUMN customers.price_currency IS
  'Currency this customer is quoted/invoiced in: "CAD" or "USD" (default CAD). New invoices default to this currency. Amounts are not converted by this flag.';
