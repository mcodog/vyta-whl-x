-- Prepaid Invoices + attached Purchase Orders
-- ===========================================
-- A "prepaid" invoice is one where a client pays us up front to procure product
-- from our suppliers. It behaves like a normal invoice, but the invoice detail
-- page grows a "Supplier Purchase Orders" panel that auto-groups the line items
-- by the cheapest supplier for each product and creates one purchase order per
-- supplier, linked back to the invoice via purchase_orders.source_invoice_id.
--
--   invoices.invoice_type            'standard' | 'prepaid'  (default 'standard')
--   purchase_orders.source_invoice_id  uuid -> invoices(id)  (nullable)
--
-- Safe to run multiple times.

------------------------------------------------------------------------------
-- 1. invoices.invoice_type — discriminates prepaid invoices from ordinary ones
------------------------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_type text NOT NULL DEFAULT 'standard';

-- Constrain to the known values. Dropped-and-recreated so re-running with an
-- expanded vocabulary later is a one-line edit.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IN ('standard', 'prepaid'));

CREATE INDEX IF NOT EXISTS idx_invoices_invoice_type ON invoices (invoice_type);

------------------------------------------------------------------------------
-- 2. purchase_orders.source_invoice_id — links a PO back to the prepaid invoice
--    it was generated from. ON DELETE SET NULL so deleting the invoice keeps the
--    PO (procurement is a separate lifecycle from the customer invoice).
------------------------------------------------------------------------------
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS source_invoice_id uuid REFERENCES invoices (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_source_invoice
  ON purchase_orders (source_invoice_id);

------------------------------------------------------------------------------
-- 3. invoice_line_items.preferred_supplier_id — the supplier chosen (in the
--    prepaid invoice form) to procure this line from. Defaults to the cheapest
--    supplier in the UI; persisted so the Supplier Purchase Orders panel on the
--    invoice page honours the override when generating POs.
------------------------------------------------------------------------------
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS preferred_supplier_id uuid REFERENCES suppliers (id) ON DELETE SET NULL;
