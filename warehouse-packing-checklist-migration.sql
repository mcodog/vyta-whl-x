-- Warehouse packing checklist, per-line fulfillment / backorder, and packed photos
-- ================================================================================
-- Builds on warehouse-fulfillment-migration.sql + warehouse-activity-migration.sql.
--
-- Adds three capabilities to the warehouse dashboard:
--   1. A persisted handling checklist — warehouse staff can tick off each
--      handling step independently (greyed out + saved).
--   2. Per-line-item fulfillment: a line can be marked Fulfilled (a quantity is
--      packed) or Backordered (a quantity is moved onto a single, non-payable
--      backorder invoice bound to the original invoice).
--   3. Photos of the packed products attached to the invoice.
--
-- Safe to run multiple times.

------------------------------------------------------------------------------
-- 1. Handling checklist + packed photos on invoices.
------------------------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS handling_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS packed_photos jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN invoices.handling_checklist IS 'Array of handling-step keys the warehouse has checked off for this invoice.';
COMMENT ON COLUMN invoices.packed_photos IS 'Array of { url, path, uploaded_at } photos of the packed products.';

------------------------------------------------------------------------------
-- 2. Non-payable flag for warehouse-created backorder invoices.
--    Such an invoice collects every backordered quantity from its parent and is
--    not meant to be paid (it tracks what still owes the customer).
------------------------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS non_payable boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN invoices.non_payable IS 'True for warehouse backorder invoices that should never be collected on.';

------------------------------------------------------------------------------
-- 3. Per-line fulfilled / backordered quantities on invoice line items.
------------------------------------------------------------------------------
ALTER TABLE invoice_line_items
  ADD COLUMN IF NOT EXISTS qty_fulfilled integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_backordered integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN invoice_line_items.qty_fulfilled IS 'Quantity the warehouse has packed/fulfilled for this line.';
COMMENT ON COLUMN invoice_line_items.qty_backordered IS 'Quantity moved to the bound backorder invoice for this line.';

------------------------------------------------------------------------------
-- 4. Storage for packed photos.
--    Photos are uploaded to the existing public 'products' bucket under the
--    `packing/<invoice_id>/` prefix via the service-role warehouse API route, so
--    no extra bucket or RLS policy is required. If you prefer a dedicated
--    bucket, create a public 'warehouse' bucket in the Supabase dashboard and
--    set WAREHOUSE_PHOTOS_BUCKET=warehouse in the environment.
------------------------------------------------------------------------------
