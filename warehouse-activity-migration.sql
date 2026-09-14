-- Warehouse activity tracking + live queue support
-- =================================================
-- Builds on warehouse-fulfillment-migration.sql (which adds the 'warehouse'
-- role and the fulfillment_type/fulfillment_status columns).
--
-- 1. Record who packed / fulfilled each invoice and when, so it is clear when
--    an order was shipped (or picked up) and by whom. Per-step audit history
--    still lives in audit_log; these columns are the fast, denormalised view.
-- 2. Let warehouse staff read invoices + line items directly (RLS) so the
--    warehouse dashboard can use Supabase Realtime subscriptions for a live
--    queue. (The 'warehouse' enum value already exists from the previous
--    migration, so referencing it here is safe.)
-- 3. Ensure the invoices table is in the supabase_realtime publication so
--    postgres_changes events are delivered to subscribed clients.

------------------------------------------------------------------------------
-- 1. Packed / fulfilled attribution on invoices.
------------------------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS packed_at timestamptz,
  ADD COLUMN IF NOT EXISTS packed_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfilled_by uuid REFERENCES customers (id) ON DELETE SET NULL;

------------------------------------------------------------------------------
-- 2. Warehouse read access (needed for client-side Realtime subscriptions).
------------------------------------------------------------------------------
DROP POLICY IF EXISTS invoices_warehouse_read ON invoices;
CREATE POLICY invoices_warehouse_read ON invoices
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'warehouse'
    )
  );

DROP POLICY IF EXISTS line_items_warehouse_read ON invoice_line_items;
CREATE POLICY line_items_warehouse_read ON invoice_line_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'warehouse'
    )
  );

------------------------------------------------------------------------------
-- 3. Realtime publication for invoices (idempotent).
------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND tablename = 'invoices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE invoices;
  END IF;
END $$;
