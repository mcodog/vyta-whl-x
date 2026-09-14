-- Customer-Specific Pricing Migration
-- Run this in Supabase SQL Editor

-- Create customer_price_overrides table
CREATE TABLE IF NOT EXISTS customer_price_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  override_price DECIMAL(10, 2) NOT NULL CHECK (override_price >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_customer_product UNIQUE(customer_id, product_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_overrides_customer ON customer_price_overrides(customer_id);
CREATE INDEX IF NOT EXISTS idx_overrides_product ON customer_price_overrides(product_id);
CREATE INDEX IF NOT EXISTS idx_overrides_customer_product ON customer_price_overrides(customer_id, product_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_price_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER price_overrides_updated_at
  BEFORE UPDATE ON customer_price_overrides
  FOR EACH ROW EXECUTE FUNCTION update_price_overrides_updated_at();

-- Enable RLS
ALTER TABLE customer_price_overrides ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Service role can do everything (API routes use service role)
CREATE POLICY "Service role full access on price overrides"
  ON customer_price_overrides FOR ALL
  USING (true) WITH CHECK (true);

-- Customers can view their own price overrides
CREATE POLICY "Customers can view their own price overrides"
  ON customer_price_overrides FOR SELECT
  USING (auth.uid() = customer_id);

-- Comment for documentation
COMMENT ON TABLE customer_price_overrides IS 'Stores customer-specific price overrides for products. When set, these prices override the default product price for the specified customer.';
COMMENT ON COLUMN customer_price_overrides.override_price IS 'The custom price for this customer. Must be non-negative.';
