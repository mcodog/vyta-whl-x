-- Price-sheet email — per-send history
-- =============================================================================
-- Records every "Preview & email" send of a customer/sales-person price list:
-- when it was sent, who sent it, and the exact config (recipients, CC, whether
-- inventory was included, the sheet currency and product count). One row per
-- send attempt (success or failure), so a single entity accrues a full history.
--
-- entity_id is polymorphic (a customers.id for a customer sheet, or a
-- sales_persons.id for a sales-rep sheet), disambiguated by entity_type — so no
-- foreign key is placed on it.
--
-- Run this in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS price_sheet_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('customer', 'sales_person')),
  entity_id uuid NOT NULL,
  sent_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  sent_by_email text,
  to_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  include_inventory boolean NOT NULL DEFAULT false,
  currency text,
  product_count integer,
  subject text,
  message_id text,
  success boolean NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_sheet_email_log_entity
  ON price_sheet_email_log (entity_type, entity_id, created_at DESC);

------------------------------------------------------------------------------
-- RLS — admin/assistant read, admin write (mirrors invoice_email_log)
------------------------------------------------------------------------------
ALTER TABLE price_sheet_email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS price_sheet_email_log_admin_read ON price_sheet_email_log;
CREATE POLICY price_sheet_email_log_admin_read ON price_sheet_email_log
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role IN ('admin','assistant'))
  );

DROP POLICY IF EXISTS price_sheet_email_log_admin_write ON price_sheet_email_log;
CREATE POLICY price_sheet_email_log_admin_write ON price_sheet_email_log
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role = 'admin')
  );

COMMENT ON TABLE price_sheet_email_log IS 'Audit trail of every price-list email send (success or failure), one row per send.';
COMMENT ON COLUMN price_sheet_email_log.entity_type IS 'customer | sales_person — which kind of price sheet was sent.';
COMMENT ON COLUMN price_sheet_email_log.entity_id IS 'Polymorphic id: customers.id or sales_persons.id per entity_type.';
COMMENT ON COLUMN price_sheet_email_log.include_inventory IS 'Whether the on-hand inventory column was included in the attached PDF.';
