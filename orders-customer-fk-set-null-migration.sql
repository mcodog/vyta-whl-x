-- Allow deleting a customer without losing their order history.
--
-- The original orders table (migration-orders-clean.sql / migration-orders.sql)
-- created `orders.customer_id` as:
--     customer_id UUID REFERENCES customers(id)
-- with no ON DELETE action, which defaults to NO ACTION (RESTRICT). That makes
-- deleting a customer who has any orders fail with:
--     update or delete on table "customers" violates foreign key constraint
--     "orders_customer_id_fkey" on table "orders"
--
-- Orders are financial history we want to keep, so switch the constraint to
-- ON DELETE SET NULL (matching how invoices.customer_id already behaves): the
-- order row is retained and its customer link is cleared when the customer is
-- removed. Safe to re-run.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_customer_id_fkey;

ALTER TABLE orders
  ADD CONSTRAINT orders_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL;
