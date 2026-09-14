-- Invoice email — sending, templates, CC list, history
-- =============================================================================
-- Extends site_settings with invoice-email template fields and a separate
-- BCC list ("invoice copies"). Adds last-emailed tracking columns on invoices
-- and a per-send invoice_email_log table.

------------------------------------------------------------------------------
-- 1. site_settings: new fields
------------------------------------------------------------------------------
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS invoice_cc_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS invoice_customer_email_subject text,
  ADD COLUMN IF NOT EXISTS invoice_customer_email_body text,
  ADD COLUMN IF NOT EXISTS invoice_admin_email_subject text,
  ADD COLUMN IF NOT EXISTS invoice_admin_email_body text;

-- Seed default templates on the singleton row when columns are still NULL.
-- NOTE: the application also falls back to defaults at render time, so this
-- is mostly so the editor opens with the defaults pre-filled.
UPDATE site_settings
SET
  invoice_customer_email_subject = COALESCE(
    invoice_customer_email_subject,
    'Your PuraMass invoice {{invoice_number}}'
  ),
  invoice_customer_email_body = COALESCE(
    invoice_customer_email_body,
    'Hi {{customer_first_name}},

Thanks again for your order. Your invoice {{invoice_number}} is attached as a PDF — the total is ${{invoice_total}} {{currency}}, due {{due_date}}.

If anything looks off, just reply to this email and we''ll sort it out.

— PuraMass'
  ),
  invoice_admin_email_subject = COALESCE(
    invoice_admin_email_subject,
    '[Copy] Invoice {{invoice_number}} sent to {{customer_email}}'
  ),
  invoice_admin_email_body = COALESCE(
    invoice_admin_email_body,
    'Invoice {{invoice_number}} was just emailed to {{customer_name}} <{{customer_email}}>.

  Total: ${{invoice_total}} {{currency}}
  Amount due: ${{amount_due}} {{currency}}
  Due date: {{due_date}}
  Sent by: {{sent_by_email}}

PDF attached.'
  )
WHERE TRUE;

------------------------------------------------------------------------------
-- 2. invoices: last-emailed tracking
------------------------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS last_emailed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_emailed_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_emailed_by_email text;

CREATE INDEX IF NOT EXISTS idx_invoices_last_emailed_at
  ON invoices (last_emailed_at);

------------------------------------------------------------------------------
-- 3. invoice_email_log: full history of every send
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  sent_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  sent_by_email text,
  to_email text NOT NULL,
  bcc_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text NOT NULL,
  message_id text,
  success boolean NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_email_log_invoice_id
  ON invoice_email_log (invoice_id, created_at DESC);

------------------------------------------------------------------------------
-- 4. RLS
------------------------------------------------------------------------------
ALTER TABLE invoice_email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_email_log_admin_read ON invoice_email_log;
CREATE POLICY invoice_email_log_admin_read ON invoice_email_log
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role IN ('admin','assistant'))
  );

DROP POLICY IF EXISTS invoice_email_log_admin_write ON invoice_email_log;
CREATE POLICY invoice_email_log_admin_write ON invoice_email_log
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role = 'admin')
  );

COMMENT ON TABLE invoice_email_log IS 'Audit trail of every invoice email send (success or failure).';
COMMENT ON COLUMN invoices.last_emailed_at IS 'Most recent successful invoice email send.';
COMMENT ON COLUMN invoices.last_emailed_by IS 'User who triggered the most recent successful send.';
