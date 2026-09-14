-- Easyship shipping integration
-- Run this in the Supabase SQL editor.

-- 1. Shipping configuration on the singleton site_settings row.
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS easyship_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS easyship_api_key TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS shipping_origin JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS shipping_box JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS shipping_item_weight_kg NUMERIC DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS shipping_flat_rate NUMERIC DEFAULT 20;

COMMENT ON COLUMN site_settings.easyship_api_key IS 'Easyship API token. Never returned by the public settings endpoint.';
COMMENT ON COLUMN site_settings.shipping_origin IS 'Origin/warehouse address: { line_1, city, state, postal_code, country_alpha2 }';
COMMENT ON COLUMN site_settings.shipping_box IS 'Default parcel box in cm: { length, width, height }';

-- 2. Tracking / shipment fields on orders, populated by Easyship webhooks.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS easyship_shipment_id TEXT,
  ADD COLUMN IF NOT EXISTS tracking_status TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS carrier TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_easyship_shipment
  ON orders (easyship_shipment_id) WHERE easyship_shipment_id IS NOT NULL;
