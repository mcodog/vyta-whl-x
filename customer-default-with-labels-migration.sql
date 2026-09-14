-- Customer default product-label preference
-- Adds a per-customer marking for whether their orders ship WITH or WITHOUT the
-- product labels (the sticker applied to each vial — NOT the shipping label):
--   * default_with_labels — true (with labels) or false (without), default true.
-- This mirrors the invoice-level `with_labels` flag: it tags the customer so new
-- invoices raised for them default to that preference. Prices are still resolved
-- per line from the labeled/unlabeled price list at invoice time.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS default_with_labels BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN customers.default_with_labels IS
  'Whether new invoices for this customer default to WITH product labels (true) or WITHOUT (false). The product label is the sticker on each vial, not the shipping label. Default true.';
