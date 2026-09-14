-- Invoice processing fee (pickup)
-- Adds an optional flat processing fee, typically charged on self-pickup
-- invoices, plus a toggle for whether it's shown on the invoice PDF/HTML.
--   * processing_fee       — flat fee amount added to the invoice total.
--   * show_processing_fee  — when true, the fee is applied to the total and
--                            itemised on the invoice PDF; when false it's
--                            neither charged nor shown.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS processing_fee numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS show_processing_fee boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN invoices.processing_fee IS 'Flat processing fee (typically for self-pickup invoices), added to the total when show_processing_fee is true.';
COMMENT ON COLUMN invoices.show_processing_fee IS 'When true, the processing fee is applied to the total and itemised on the invoice PDF; when false it is neither charged nor shown.';
