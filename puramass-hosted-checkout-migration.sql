-- PuraMass hosted checkout integration
-- =====================================================================
-- Run this in the Supabase SQL editor.
--
-- Adds everything the PuraMass hosted-checkout hand-off needs:
--
--   1. products.puramass_sku — maps each storefront product to the SKU the
--      PuraMass partner API expects (our internal SKUs like `RT10` don't match
--      PuraMass SKUs like `puramass-retatrutide-10mg-10-pack`). Auto-filled by
--      the admin SKU-sync endpoint, verifiable/overridable by an admin.
--
--   2. site_settings.puramass_checkout_enabled — admin toggle that routes the
--      storefront checkout to the PuraMass hosted flow instead of the in-house
--      email/invoice flow. Off by default. (The server ALSO needs the
--      PURAMASS_API_KEY env var set for the hand-off to actually run.)
--
--   3. puramass_orders — one row per hand-off, tying our internal
--      partner_reference to PuraMass's transaction_id + payment_link so orders
--      can be reconciled. PuraMass owns payment/fulfilment/emails from the
--      redirect onward; live status is viewed in the PuraMass portal.

BEGIN;

-- 1. Per-product PuraMass SKU mapping ---------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS puramass_sku VARCHAR(80);

CREATE INDEX IF NOT EXISTS idx_products_puramass_sku
  ON products (puramass_sku) WHERE puramass_sku IS NOT NULL;

COMMENT ON COLUMN products.puramass_sku IS
  'SKU used by the PuraMass hosted-checkout partner API (e.g. puramass-retatrutide-10mg-10-pack). NULL until mapped. Auto-filled by the admin SKU sync; a human verifies ambiguous matches.';

-- 2. Admin toggle on the singleton site_settings row ------------------------
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS puramass_checkout_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN site_settings.puramass_checkout_enabled IS
  'When true (and PURAMASS_API_KEY is configured server-side), the storefront checkout hands the cart off to the PuraMass hosted checkout instead of the in-house email/invoice flow.';

-- 3. Hand-off ledger --------------------------------------------------------
CREATE TABLE IF NOT EXISTS puramass_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Our internal reference, sent as partner_reference and echoed back. Unique
  -- so a safe retry with the same reference maps to the same hand-off.
  partner_reference TEXT NOT NULL UNIQUE,
  -- PuraMass's identifiers (populated once the order is created).
  transaction_id TEXT,
  payment_link TEXT,
  status TEXT NOT NULL DEFAULT 'payment_pending',
  subtotal_cents INTEGER,
  -- Who/what was handed off.
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_email TEXT,
  -- The line items we sent to PuraMass: [{ sku, quantity }, ...].
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Affiliate referral code carried at hand-off (for later manual
  -- reconciliation; commissions are not auto-created for external orders).
  referral_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_puramass_orders_transaction
  ON puramass_orders (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_customer
  ON puramass_orders (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_created
  ON puramass_orders (created_at DESC);

COMMENT ON TABLE puramass_orders IS
  'Ledger of PuraMass hosted-checkout hand-offs. Ties our partner_reference to PuraMass transaction_id + payment_link. PuraMass owns payment/fulfilment/emails after redirect; live status lives in the PuraMass portal.';

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_puramass_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS puramass_orders_updated_at ON puramass_orders;
CREATE TRIGGER puramass_orders_updated_at
  BEFORE UPDATE ON puramass_orders
  FOR EACH ROW EXECUTE FUNCTION update_puramass_orders_updated_at();

-- RLS: writes/reads happen only through the server (service role), mirroring
-- site_settings. No direct client access.
ALTER TABLE puramass_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON puramass_orders;
CREATE POLICY "Service role full access" ON puramass_orders
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;
