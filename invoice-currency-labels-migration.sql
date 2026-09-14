-- Invoice currency + label marking
-- Adds two admin-set markings captured when an invoice is created:
--   * currency    — whether the invoice is paid in CAD or USD (default CAD).
--   * with_labels — whether the order ships with product labels (default true).
-- Both are simple flags surfaced on the invoice form, detail view, and PDF.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE invoices
  -- 'CAD' or 'USD'. The amounts themselves are not converted — this only marks
  -- which currency the invoice is denominated/paid in.
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CAD',
  -- Whether this order ships with product labels applied.
  ADD COLUMN IF NOT EXISTS with_labels BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN invoices.currency IS 'Currency the invoice is paid in: "CAD" or "USD". Amounts are not converted.';
COMMENT ON COLUMN invoices.with_labels IS 'Whether the order ships with product labels (true) or without (false).';
