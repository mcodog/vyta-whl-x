-- Easyship auto-shipment: automatically create shipment records (and optionally
-- buy labels) when orders are placed / paid. All best-effort and server-side —
-- failures never affect the customer-facing checkout.
-- Run this in the Supabase SQL editor.

-- 1. Toggles on the singleton site_settings row.
ALTER TABLE site_settings
  -- Auto-create an Easyship draft shipment when an order is placed.
  ADD COLUMN IF NOT EXISTS easyship_auto_create_shipment BOOLEAN DEFAULT false,
  -- Preferred courier for the auto-created shipment: 'cheapest' | 'ups' | 'fedex'.
  ADD COLUMN IF NOT EXISTS easyship_auto_courier_preference TEXT DEFAULT 'cheapest',
  -- Auto-buy/confirm the shipping label once the order's invoice is marked paid.
  ADD COLUMN IF NOT EXISTS easyship_auto_buy_label BOOLEAN DEFAULT false;

COMMENT ON COLUMN site_settings.easyship_auto_create_shipment IS
  'When true, a draft Easyship shipment is auto-created server-side as each order is placed.';
COMMENT ON COLUMN site_settings.easyship_auto_courier_preference IS
  'Preferred courier for auto-created shipments: cheapest | ups | fedex.';
COMMENT ON COLUMN site_settings.easyship_auto_buy_label IS
  'When true, the shipping label is auto-purchased once the order''s invoice is marked paid.';

-- 2. Per-order record of the latest auto-shipment attempt (shown on the single
--    order page). status: success | failed | skipped. stage: shipment | label.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS auto_shipment_status TEXT,
  ADD COLUMN IF NOT EXISTS auto_shipment_stage TEXT,
  ADD COLUMN IF NOT EXISTS auto_shipment_error TEXT,
  ADD COLUMN IF NOT EXISTS auto_shipment_attempted_at TIMESTAMPTZ;

-- 3. Append-only feed of auto-shipment attempts, surfaced on the admin
--    dashboard (especially failures). Written only by the service-role key.
CREATE TABLE IF NOT EXISTS shipment_auto_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders (id) ON DELETE CASCADE,
  order_number text,
  stage text NOT NULL,          -- shipment | label
  ok boolean NOT NULL,
  courier text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipment_auto_logs_created
  ON shipment_auto_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipment_auto_logs_order
  ON shipment_auto_logs (order_id, created_at DESC);

ALTER TABLE shipment_auto_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shipment_auto_logs_admin_read ON shipment_auto_logs;
CREATE POLICY shipment_auto_logs_admin_read ON shipment_auto_logs
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin','assistant')
    )
  );
-- Writes happen only via the service-role key (API routes); no client policy.
