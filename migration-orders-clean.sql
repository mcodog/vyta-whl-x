-- Drop existing objects if they exist
DROP TRIGGER IF EXISTS orders_updated_at ON orders;
DROP FUNCTION IF EXISTS update_orders_updated_at();
DROP TABLE IF EXISTS sol_addresses CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;

-- Orders table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  order_number TEXT UNIQUE NOT NULL,
  items JSONB NOT NULL,
  total NUMERIC NOT NULL,
  email TEXT,
  shipping_address JSONB,
  crypto TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_address TEXT,
  payment_amount_expected TEXT,
  payment_amount_received TEXT,
  payment_tx_hash TEXT,
  payment_derivation_index INTEGER,
  payment_confirmed_at TIMESTAMPTZ,
  payment_expires_at TIMESTAMPTZ,
  referral_code TEXT,
  tracking_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_orders_status_payment ON orders (status, payment_address) WHERE status = 'pending' AND payment_address IS NOT NULL;
CREATE INDEX idx_orders_customer ON orders (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_orders_order_number ON orders (order_number);

-- Order items table
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  product_id TEXT,
  quantity INTEGER NOT NULL,
  price_at_time NUMERIC NOT NULL,
  strength TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items (order_id);

-- SOL pre-generated address pool
CREATE TABLE sol_addresses (
  id SERIAL PRIMARY KEY,
  address TEXT UNIQUE NOT NULL,
  derivation_index INTEGER NOT NULL,
  used BOOLEAN DEFAULT false,
  order_id UUID REFERENCES orders(id)
);

CREATE INDEX idx_sol_unused ON sol_addresses (used) WHERE used = false;

-- Updated_at trigger for orders
CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_orders_updated_at();

-- RLS policies
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sol_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sol_addresses FOR ALL USING (true) WITH CHECK (true);
