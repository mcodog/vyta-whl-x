-- Supplier Pricelists
-- ===================
-- Each supplier carries its own price for every product we stock. The PO line
-- unit price is sourced from this list (falling back to products.price when a
-- supplier has no row), and the PO creation page uses it to flag when a cheaper
-- supplier exists for a product.
--
--   supplier_prices(supplier_id, product_id, price)  — one row per product/supplier
--
-- Seeding:
--   * Existing suppliers are seeded here with every active product at the
--     default products.price.
--   * New suppliers are seeded by the POST /api/admin/suppliers route.
--   * Products that appear later fall back to products.price until synced.
--
-- Safe to run multiple times.

------------------------------------------------------------------------------
-- set_updated_at (idempotent — also defined by the purchase-orders migration)
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

------------------------------------------------------------------------------
-- 1. supplier_prices
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  price numeric(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_prices_supplier ON supplier_prices (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_prices_product ON supplier_prices (product_id);

DROP TRIGGER IF EXISTS trg_supplier_prices_updated_at ON supplier_prices;
CREATE TRIGGER trg_supplier_prices_updated_at
  BEFORE UPDATE ON supplier_prices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

------------------------------------------------------------------------------
-- 2. Seed existing suppliers with every active product at the default price
------------------------------------------------------------------------------
INSERT INTO supplier_prices (supplier_id, product_id, price)
SELECT s.id, p.id, COALESCE(p.price, 0)
  FROM suppliers s
  CROSS JOIN products p
 WHERE p.active = true
ON CONFLICT (supplier_id, product_id) DO NOTHING;

------------------------------------------------------------------------------
-- 3. Row Level Security
------------------------------------------------------------------------------
ALTER TABLE supplier_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_prices_admin_read ON supplier_prices;
CREATE POLICY supplier_prices_admin_read ON supplier_prices
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin', 'assistant')
    )
  );

DROP POLICY IF EXISTS supplier_prices_admin_write ON supplier_prices;
CREATE POLICY supplier_prices_admin_write ON supplier_prices
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'admin'
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role = 'admin'
    )
  );
-- service_role (used by the API routes) bypasses RLS.
