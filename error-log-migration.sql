-- Error Log
-- =========
-- Append-only ledger of API-function failures across the system. Written by
-- API routes via logErrorServer() from lib/admin/errorLog.ts whenever a handler
-- throws or returns a 5xx. Rows may be flagged `resolved` by an admin from the
-- Error Logs dashboard, but are never hard-deleted by application code.

CREATE TABLE IF NOT EXISTS error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Where the failure happened.
  area text NOT NULL,                 -- coarse bucket, e.g. "customers", "invoices", "warehouse"
  route text,                         -- request path, e.g. "/api/admin/customers/123"
  method text,                        -- HTTP method, e.g. "POST"
  status_code integer,                -- response status returned to the client (usually 500)
  -- What went wrong.
  message text NOT NULL,              -- human-readable error message
  stack text,                         -- stack trace when available
  fingerprint text NOT NULL,          -- stable hash of (area + normalized message) for grouping repeats
  -- Who / context.
  actor_id uuid REFERENCES customers (id) ON DELETE SET NULL,
  payload jsonb,                      -- optional request context (sanitized)
  -- Triage.
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_error_log_created
  ON error_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_fingerprint
  ON error_log (fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_area
  ON error_log (area, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_resolved
  ON error_log (resolved, created_at DESC);

ALTER TABLE error_log ENABLE ROW LEVEL SECURITY;

-- Admins and assistants may read the error ledger.
DROP POLICY IF EXISTS error_log_admin_read ON error_log;
CREATE POLICY error_log_admin_read ON error_log
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin','assistant')
    )
  );

-- Only admins may flag rows resolved/unresolved (writes otherwise happen via the
-- service-role key in API routes, which bypasses RLS).
DROP POLICY IF EXISTS error_log_admin_update ON error_log;
CREATE POLICY error_log_admin_update ON error_log
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'admin'
    )
  );
