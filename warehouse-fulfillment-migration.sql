-- Warehouse role + fulfillment tracking
-- =====================================
-- 1. Adds the 'warehouse' role: a staff account that handles packaging and
--    getting orders out the door (shipment or self-pickup).
-- 2. Makes the fulfillment method (shipment vs pickup) a first-class column on
--    both orders and invoices, replacing the implicit `orders.notes = 'PICKUP'`
--    convention used by checkout/shipping today.
-- 3. Adds a fulfillment_status workflow column to invoices so warehouse staff
--    can advance each order through pending -> packed -> shipped / picked_up.
--
-- Warehouse access is mediated entirely by the service-role /api/warehouse
-- routes (which bypass RLS), exactly like the orders table, so no warehouse RLS
-- policies are added here.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside the same transaction that
-- later uses the value. Run section 1 on its own first if your SQL client wraps
-- the whole file in a single transaction.

------------------------------------------------------------------------------
-- 1. New role value (safe to re-run).
------------------------------------------------------------------------------
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'warehouse';

------------------------------------------------------------------------------
-- 2. Fulfillment method on orders. Backfill from the legacy notes flag.
------------------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfillment_type text
    CHECK (fulfillment_type IN ('shipment', 'pickup'));

UPDATE orders
   SET fulfillment_type = CASE WHEN notes = 'PICKUP' THEN 'pickup' ELSE 'shipment' END
 WHERE fulfillment_type IS NULL;

------------------------------------------------------------------------------
-- 3. Fulfillment method + workflow status on invoices.
------------------------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS fulfillment_type text NOT NULL DEFAULT 'shipment'
    CHECK (fulfillment_type IN ('shipment', 'pickup'));

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'pending'
    CHECK (fulfillment_status IN ('pending', 'packed', 'shipped', 'picked_up'));

-- Inherit the fulfillment method from the linked order where one exists.
UPDATE invoices i
   SET fulfillment_type = o.fulfillment_type
  FROM orders o
 WHERE i.order_id = o.id
   AND o.fulfillment_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_fulfillment_status
  ON invoices (fulfillment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_fulfillment_type
  ON invoices (fulfillment_type);
