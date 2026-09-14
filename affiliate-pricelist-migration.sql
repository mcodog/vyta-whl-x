-- Affiliate (Client) Pricelist Migration
-- Run this in the Supabase SQL Editor.
--
-- Stores each affiliate/client's own price list so it can be applied to ALL of
-- their customers — both the customers they have today and any they add later.
--
-- How it's used:
--   * When a client imports a price list (CSV), the prices are saved here AND
--     upserted into customer_price_overrides for every customer bound to them.
--   * When a new customer is bound to a client (created by the client, or by an
--     admin assigning the client), these prices are copied into
--     customer_price_overrides for the new customer.
--
-- This is purely additive — no existing schema is removed.

CREATE TABLE IF NOT EXISTS affiliate_price_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  override_price DECIMAL(10, 2) NOT NULL CHECK (override_price >= 0),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_affiliate_product UNIQUE (affiliate_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_overrides_affiliate ON affiliate_price_overrides(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_overrides_product ON affiliate_price_overrides(product_id);

-- updated_at trigger (reuses the helper from the customer-pricing migration if
-- present; defined defensively here so this file can run standalone).
CREATE OR REPLACE FUNCTION update_price_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS affiliate_price_overrides_updated_at ON affiliate_price_overrides;
CREATE TRIGGER affiliate_price_overrides_updated_at
  BEFORE UPDATE ON affiliate_price_overrides
  FOR EACH ROW EXECUTE FUNCTION update_price_overrides_updated_at();

-- RLS — service role (used by the API routes) has full access; clients may read
-- their own list.
ALTER TABLE affiliate_price_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on affiliate price overrides" ON affiliate_price_overrides;
CREATE POLICY "Service role full access on affiliate price overrides"
  ON affiliate_price_overrides FOR ALL
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Affiliates can view their own price list" ON affiliate_price_overrides;
CREATE POLICY "Affiliates can view their own price list"
  ON affiliate_price_overrides FOR SELECT
  USING (auth.uid() = affiliate_id);

COMMENT ON TABLE affiliate_price_overrides IS 'Each affiliate/client''s price list. Applied to all of the client''s customers (current and future).';
