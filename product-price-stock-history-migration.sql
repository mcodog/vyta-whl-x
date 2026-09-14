-- Product price & stock change history
-- ====================================
-- Append-only ledger of every price and stock_quantity change made to a
-- product, so the admin Products page can show:
--   * what a value was set to, and when it was set;
--   * how long that value was held (derived from the gap to the next row);
--   * who changed it (changed_by -> customers);
--   * how it was changed (change_source: create / inline / form / import /
--     revert / api).
-- It also powers the "revert" action, which simply writes the old value back
-- as a new change with change_source = 'revert'.
--
-- Rows are written server-side with the service-role key via
-- recordProductChanges() in lib/admin/product-history.ts. The table is never
-- updated or deleted by application code.

CREATE TABLE IF NOT EXISTS product_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  field text NOT NULL CHECK (field IN ('price', 'stock_quantity')),
  -- old_value is null only for the first ('create') row of a product.
  old_value numeric,
  new_value numeric NOT NULL,
  changed_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  change_source text NOT NULL DEFAULT 'form'
    CHECK (change_source IN ('create', 'inline', 'form', 'import', 'revert', 'api')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fast "history for this product/field, newest first" lookups.
CREATE INDEX IF NOT EXISTS idx_product_change_history_product
  ON product_change_history (product_id, field, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_change_history_actor
  ON product_change_history (changed_by, created_at DESC);

ALTER TABLE product_change_history ENABLE ROW LEVEL SECURITY;

-- Admin / assistant may read history; writes happen only via the service-role
-- key (API routes), so there is no client write policy.
DROP POLICY IF EXISTS product_change_history_admin_read ON product_change_history;
CREATE POLICY product_change_history_admin_read ON product_change_history
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin', 'assistant')
    )
  );

-- Seed a baseline 'create' row for every existing product that has no history
-- yet, using the product's created_at so the current value has a known start
-- time. Idempotent: re-running skips products that already have history.
INSERT INTO product_change_history (product_id, field, old_value, new_value, changed_by, change_source, created_at)
SELECT p.id, 'price', NULL, p.price, NULL, 'create', p.created_at
  FROM products p
 WHERE NOT EXISTS (
   SELECT 1 FROM product_change_history h
    WHERE h.product_id = p.id AND h.field = 'price'
 );

INSERT INTO product_change_history (product_id, field, old_value, new_value, changed_by, change_source, created_at)
SELECT p.id, 'stock_quantity', NULL, COALESCE(p.stock_quantity, 0), NULL, 'create', p.created_at
  FROM products p
 WHERE NOT EXISTS (
   SELECT 1 FROM product_change_history h
    WHERE h.product_id = p.id AND h.field = 'stock_quantity'
 );
