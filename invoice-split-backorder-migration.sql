-- =====================================================================
-- Invoice splitting for backorders
-- ---------------------------------------------------------------------
-- When an invoice line item's quantity exceeds the product's available
-- stock, the invoice is split into two at creation time:
--   * a primary invoice containing the in-stock quantities, and
--   * a "backorder" invoice containing only the exceeding quantities.
-- The backorder invoice is flagged with `is_backorder = true` and points
-- back to the primary via `parent_invoice_id`. It is the invoice that
-- shows up in the Backorders tab (a backorders row is created against it).
--
-- Safe to run multiple times.
-- =====================================================================

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS is_backorder boolean NOT NULL DEFAULT false;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS parent_invoice_id uuid REFERENCES invoices (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_is_backorder ON invoices (is_backorder);
CREATE INDEX IF NOT EXISTS idx_invoices_parent ON invoices (parent_invoice_id);

COMMENT ON COLUMN invoices.is_backorder IS 'True when this invoice holds the exceeding-stock (backordered) portion of a split invoice.';
COMMENT ON COLUMN invoices.parent_invoice_id IS 'For a backorder invoice, the primary (in-stock) invoice it was split from.';
