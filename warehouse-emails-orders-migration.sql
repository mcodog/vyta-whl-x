-- Warehouse fulfillment emails + invoice-created orders
-- =====================================================
-- Builds on warehouse-fulfillment-migration.sql and warehouse-activity-migration.sql.
--
-- 1. Per-account permission: which warehouse staff may send customer
--    fulfillment emails (packed / shipped). Admins can always send.
-- 2. Track when packed/shipped notifications were emailed (for UI state) and
--    keep a full send history.
-- 3. (Orders are now created from admin invoices in application code — no schema
--    change needed; orders already have every column used.)

------------------------------------------------------------------------------
-- 1. Email-send permission flag on accounts (default OFF; admin grants it).
------------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS can_send_fulfillment_emails boolean NOT NULL DEFAULT false;

------------------------------------------------------------------------------
-- 2. Notification state on invoices + send history.
------------------------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS packed_emailed_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipped_emailed_at timestamptz;

CREATE TABLE IF NOT EXISTS fulfillment_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES invoices (id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('packed', 'shipped')),
  to_email text NOT NULL,
  subject text,
  message_id text,
  success boolean NOT NULL DEFAULT false,
  error text,
  sent_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  sent_by_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_email_log_invoice
  ON fulfillment_email_log (invoice_id, created_at DESC);

ALTER TABLE fulfillment_email_log ENABLE ROW LEVEL SECURITY;
-- Writes happen only via the service-role API; reads (if ever needed by a JWT
-- client) are limited to staff.
DROP POLICY IF EXISTS fulfillment_email_log_staff_read ON fulfillment_email_log;
CREATE POLICY fulfillment_email_log_staff_read ON fulfillment_email_log
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin', 'assistant', 'warehouse')
    )
  );
