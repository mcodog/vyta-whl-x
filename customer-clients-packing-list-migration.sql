-- Customer clients (end-recipients) + Packing List workflow
-- =========================================================
-- Builds on ecommerce-backend-migration.sql (invoices) and
-- warehouse-emails-orders-migration.sql (fulfillment_email_log).
--
-- Some customers (typically resellers) place orders whose items actually ship
-- to THEIR client. In that scenario:
--   * the invoice still bills the customer,
--   * the physical shipment (order + Easyship label + tracking) goes to the
--     client's address, using the client's contact info where present, but
--     addressed under the customer's name,
--   * the client receives ONLY a Packing List (SKU / description / quantity —
--     no pricing) with the tracking link, never the invoice.
--
-- 1. A reusable per-customer address book of clients.
-- 2. Flags + audit columns on invoices to mark the scenario and track sends.
-- 3. Extend the fulfillment email log to record packing-list sends.

------------------------------------------------------------------------------
-- 1. Customer clients (end-recipients). Only `address` is required; the rest is
--    optional and may be backfilled per invoice.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  first_name text,
  last_name text,
  address text NOT NULL,
  city text,
  state text,
  postal_code text,
  country text DEFAULT 'CA',
  phone text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_clients_customer
  ON customer_clients (customer_id, created_at DESC);

-- All reads/writes go through the service-role admin/warehouse API, so the
-- role check in the route IS the access boundary (matches orders/invoices).
-- A staff-only read policy is added for any future JWT client use.
ALTER TABLE customer_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_clients_staff_read ON customer_clients;
CREATE POLICY customer_clients_staff_read ON customer_clients
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin', 'assistant', 'warehouse', 'affiliate')
    )
  );

------------------------------------------------------------------------------
-- 2. Invoice flags + packing-list send tracking.
------------------------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS ships_to_client boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES customer_clients (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS packing_list_emailed_at timestamptz,
  ADD COLUMN IF NOT EXISTS packing_list_emailed_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS packing_list_emailed_to text;

CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices (client_id);

------------------------------------------------------------------------------
-- 3. Allow the fulfillment email log to record packing-list sends.
------------------------------------------------------------------------------
ALTER TABLE fulfillment_email_log
  DROP CONSTRAINT IF EXISTS fulfillment_email_log_kind_check;
ALTER TABLE fulfillment_email_log
  ADD CONSTRAINT fulfillment_email_log_kind_check
  CHECK (kind IN ('packed', 'shipped', 'packing_list'));
