-- Remember which courier the customer chose (and was charged for) at the
-- storefront checkout, so the Easyship shipment can be locked to that service
-- rather than to the site-wide courier preference.
--
-- Without this, an order whose shipment is created after checkout — the
-- auto-create toggle was off, or an admin retried it from the order page — has
-- no record of what the customer paid for, and Easyship is left to pick.
-- Run this in the Supabase SQL editor.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_courier_id TEXT;

COMMENT ON COLUMN orders.shipping_courier_id IS
  'Easyship courier_service id the customer selected at checkout — the service their shipping charge was quoted from. NULL for pickup, for orders placed before this column existed, and for flows with no courier picker.';
