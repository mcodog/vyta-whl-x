-- Pricelist System Migration
-- Run this in Supabase SQL Editor.
--
-- Adds a configurable pricelist system on top of the existing products table.
-- Two tables:
--   1. pricelists       — the pricelist itself (you can create multiple). One can
--                         be flagged active; the active one drives invoice line
--                         item pricing.
--   2. pricelist_items  — join table binding products to a pricelist, each row
--                         storing the price for that product within the list.
--
-- This is purely additive — no existing schema is removed. When a product is not
-- present in a pricelist, callers fall back to products.price.

-- ---------------------------------------------------------------------------
-- Table 1: pricelists (the list header — create as many as you like)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricelists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- At most one active pricelist at a time.
CREATE UNIQUE INDEX IF NOT EXISTS pricelists_single_active
  ON pricelists (is_active)
  WHERE is_active;

-- ---------------------------------------------------------------------------
-- Table 2: pricelist_items (products bound to a pricelist + their price)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricelist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricelist_id UUID NOT NULL REFERENCES pricelists(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_pricelist_product UNIQUE (pricelist_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_pricelist_items_pricelist ON pricelist_items(pricelist_id);
CREATE INDEX IF NOT EXISTS idx_pricelist_items_product ON pricelist_items(product_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_pricelists_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pricelists_updated_at ON pricelists;
CREATE TRIGGER pricelists_updated_at
  BEFORE UPDATE ON pricelists
  FOR EACH ROW EXECUTE FUNCTION update_pricelists_updated_at();

DROP TRIGGER IF EXISTS pricelist_items_updated_at ON pricelist_items;
CREATE TRIGGER pricelist_items_updated_at
  BEFORE UPDATE ON pricelist_items
  FOR EACH ROW EXECUTE FUNCTION update_pricelists_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — mirror the existing admin tables: service role (used by API routes)
-- has full access; authenticated staff may read.
-- ---------------------------------------------------------------------------
ALTER TABLE pricelists ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricelist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on pricelists" ON pricelists;
CREATE POLICY "Service role full access on pricelists"
  ON pricelists FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on pricelist items" ON pricelist_items;
CREATE POLICY "Service role full access on pricelist items"
  ON pricelist_items FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE pricelists IS 'Named pricelists. The row with is_active = true drives invoice line item pricing.';
COMMENT ON TABLE pricelist_items IS 'Per-product prices within a pricelist. Falls back to products.price when a product is absent.';
