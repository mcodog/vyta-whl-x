-- PuraMass hosted checkout — fulfillment invoice on payment
-- =====================================================================
-- Run this in the Supabase SQL editor (after the other puramass migrations).
--
-- When a PuraMass (Stealth Health) order is paid, the webhook creates a
-- fulfillment invoice so the items show up in the warehouse fulfillment queue,
-- clearly marked as a Stealth Health order.
--
--   invoices.source        — how the invoice originated. 'stealth_health' marks
--                            a PuraMass hosted-checkout order so the queue can
--                            badge it and explain any missing (externally
--                            managed) fields.
--   puramass_orders.invoice_id — links the hand-off to the invoice it produced,
--                            and guarantees at most one invoice per order.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_source
  ON invoices (source) WHERE source IS NOT NULL;

COMMENT ON COLUMN invoices.source IS
  'Origin of the invoice. ''stealth_health'' = auto-created from a paid PuraMass hosted-checkout order; NULL = normal in-house invoice.';

ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_puramass_orders_invoice
  ON puramass_orders (invoice_id) WHERE invoice_id IS NOT NULL;

COMMENT ON COLUMN puramass_orders.invoice_id IS
  'The fulfillment invoice created when this order was paid (set by the Stealth Health webhook). Ensures the invoice is created at most once.';
