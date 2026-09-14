-- =====================================================================
-- Backorders
-- ---------------------------------------------------------------------
-- When an invoice line item's quantity exceeds the product's current
-- stock, the shortfall is recorded as a backorder. Admins see open
-- backorders in the Backorders tab and fulfil them by creating a
-- purchase order (which "flushes" the backorder to fulfilled).
--
-- Safe to run multiple times.
-- =====================================================================

CREATE TABLE IF NOT EXISTS backorders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'cancelled')),
  purchase_order_id uuid REFERENCES purchase_orders (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_at timestamptz
);

CREATE TABLE IF NOT EXISTS backorder_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backorder_id uuid NOT NULL REFERENCES backorders (id) ON DELETE CASCADE,
  product_id uuid REFERENCES products (id) ON DELETE SET NULL,
  description text NOT NULL,
  qty_ordered numeric NOT NULL,
  qty_available numeric NOT NULL,
  qty_backordered numeric NOT NULL,
  unit_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backorders_status ON backorders (status);
CREATE INDEX IF NOT EXISTS idx_backorders_invoice ON backorders (invoice_id);
CREATE INDEX IF NOT EXISTS idx_backorder_items_backorder ON backorder_items (backorder_id);

-- Service role handles all access from API routes; enable RLS with no public
-- policies so anon/auth clients can't read/write directly.
ALTER TABLE backorders ENABLE ROW LEVEL SECURITY;
ALTER TABLE backorder_items ENABLE ROW LEVEL SECURITY;
