-- =====================================================================
-- One-off: re-denominate invoices INV-1371 and INV-1359 to CAD
-- ---------------------------------------------------------------------
-- These two invoices were raised in USD but should read CAD. This is a
-- LABEL-ONLY change: it flips invoices.currency from 'USD' to 'CAD' and
-- touches NOTHING else — line unit prices, subtotal, tax_total,
-- shipping_cost, processing_fee and total all stay exactly as-is. The
-- numbers don't move; only the currency they're shown in changes.
--
-- This mirrors the new admin-only "Switch to CAD/USD" button on the
-- invoice detail page (which PATCHes { currency } alone, skipping the
-- server's totals-recalc path).
--
-- Wrapped in a transaction and pinned to exactly these two invoice
-- numbers. Safe to run more than once (only rows still in USD change).
-- Run this in the Supabase SQL editor.
-- =====================================================================

BEGIN;

UPDATE invoices
   SET currency   = 'CAD',
       updated_at = now()
 WHERE invoice_number IN ('INV-1371', 'INV-1359')
   AND currency = 'USD';

-- Show the result (currency now CAD; total unchanged).
SELECT invoice_number, currency, subtotal, tax_total, shipping_cost, total
  FROM invoices
 WHERE invoice_number IN ('INV-1371', 'INV-1359')
 ORDER BY invoice_number;

COMMIT;
