-- ============================================================================
-- Invoice Export / Cross-site sync
-- ----------------------------------------------------------------------------
-- Lets an admin push an invoice (with its line items, customer, and payments)
-- to another website that runs a compatible "import-invoice" Supabase Edge
-- Function. This repo is the SENDER. The receiving site owns the Edge Function
-- (see supabase/functions/import-invoice) and its own database.
--
--   * invoice_export_destinations — the receiving sites you can push to.
--     Each holds a label, the Edge Function URL, and a shared secret that is
--     sent as a bearer token so the far side can authenticate the request.
--   * invoice_exports — an append-only log of every push attempt (preview or
--     commit) so you can see where an invoice was sent and what came back.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

------------------------------------------------------------------------------
-- 1. invoice_export_destinations
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_export_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-friendly name shown in the picker ("Sister store", "EU site", ...).
  label text NOT NULL,
  -- Full URL of the receiving site's import-invoice Edge Function, e.g.
  -- https://<project>.supabase.co/functions/v1/import-invoice
  edge_function_url text NOT NULL,
  -- Shared secret sent as `Authorization: Bearer <secret>`. The receiving
  -- Edge Function compares it against its IMPORT_INVOICE_SECRET env var.
  secret text NOT NULL,
  -- When false the destination is hidden from the send picker.
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS invoice_export_destinations_updated_at
  ON invoice_export_destinations;
CREATE TRIGGER invoice_export_destinations_updated_at
  BEFORE UPDATE ON invoice_export_destinations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

------------------------------------------------------------------------------
-- 2. invoice_exports (attempt log)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES invoices (id) ON DELETE SET NULL,
  destination_id uuid REFERENCES invoice_export_destinations (id) ON DELETE SET NULL,
  -- Snapshot so the log survives the invoice/destination being deleted.
  invoice_number text,
  destination_label text,
  -- 'preview' (dry-run), 'success', 'skipped' (already existed), or 'failed'.
  status text NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview','success','skipped','failed')),
  -- Identifiers the far side reported for the created/matched invoice.
  remote_invoice_id text,
  remote_invoice_number text,
  -- The far side's structured response (schema check, existence report, ...).
  response jsonb,
  error text,
  created_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_exports_invoice_id
  ON invoice_exports (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_exports_destination_id
  ON invoice_exports (destination_id);
CREATE INDEX IF NOT EXISTS idx_invoice_exports_created_at
  ON invoice_exports (created_at DESC);

------------------------------------------------------------------------------
-- 3. Row Level Security
-- ----------------------------------------------------------------------------
-- API routes use the service-role key (which bypasses RLS), but we still lock
-- these down so nothing is readable through the anon key. The secret column in
-- particular must never leak to the browser.
------------------------------------------------------------------------------
ALTER TABLE invoice_export_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_exports ENABLE ROW LEVEL SECURITY;

-- destinations: admin only, both read and write (secrets are sensitive).
DROP POLICY IF EXISTS export_destinations_admin_all ON invoice_export_destinations;
CREATE POLICY export_destinations_admin_all ON invoice_export_destinations
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'admin'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'admin'
    )
  );

-- export log: admin/assistant may read; admin may write.
DROP POLICY IF EXISTS invoice_exports_admin_read ON invoice_exports;
CREATE POLICY invoice_exports_admin_read ON invoice_exports
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin','assistant')
    )
  );

DROP POLICY IF EXISTS invoice_exports_admin_write ON invoice_exports;
CREATE POLICY invoice_exports_admin_write ON invoice_exports
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'admin'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'admin'
    )
  );
