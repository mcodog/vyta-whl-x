-- PuraMass hosted checkout — signed-in customer checkout
-- =====================================================================
-- Run this in the Supabase SQL editor (after the other puramass migrations).
--
-- Lets a signed-in customer complete a purchase through the PuraMass hosted
-- checkout (app.puramass.com) at THEIR OWN prices instead of PuraMass's catalog
-- prices, choosing a courier on our side before they are redirected:
--
--   1. site_settings.puramass_customer_checkout_enabled — the master toggle for
--      the whole feature. Off by default, so the hosted checkout keeps behaving
--      exactly as it does today (PuraMass prices, no courier step, no shipment)
--      until an admin turns it on.
--
--   2. site_settings.puramass_shipping_fee_* — the processing fee added on top
--      of every courier rate shown at this checkout.
--
--   3. site_settings.shipping_default_recipient_phone — the in-house phone
--      number used as the recipient contact when the customer leaves theirs
--      blank (phone is optional; email is not).
--
--   4. puramass_orders.* — the destination address, the chosen courier, and the
--      Easyship shipment created when the order is paid, so the ledger row (and
--      the invoice it produces) carries the shipment information.
--
-- Safe to run more than once. Every reader falls back when a column is missing,
-- so nothing breaks before this runs.

BEGIN;

-- 1-3. Settings -------------------------------------------------------------
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS puramass_customer_checkout_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS puramass_shipping_fee_type TEXT NOT NULL DEFAULT 'flat',
  ADD COLUMN IF NOT EXISTS puramass_shipping_fee_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_default_recipient_phone TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN site_settings.puramass_customer_checkout_enabled IS
  'Master toggle for the signed-in customer hosted checkout: the customer''s own prices and currency are sent to PuraMass, they pick a courier here, and an Easyship shipment is created when the order is paid. Off = the hosted checkout hands off SKUs only and PuraMass prices the order.';
COMMENT ON COLUMN site_settings.puramass_shipping_fee_type IS
  'How the hosted-checkout processing fee is calculated: "flat" (CAD amount) or "percent" (of the courier rate).';
COMMENT ON COLUMN site_settings.puramass_shipping_fee_value IS
  'Processing fee added on top of every courier rate shown at the hosted checkout. CAD dollars when the type is "flat", percentage points when "percent". 0 = no fee. NOTE: the general Easyship handling fee (shipping_handling_fee_*) is NOT applied at this checkout — this is the single fee for that flow, so the two can never stack.';
COMMENT ON COLUMN site_settings.shipping_default_recipient_phone IS
  'In-house phone number used as the shipment recipient contact when the customer does not give one. Phone is optional at checkout; email is required. Blank falls back to the built-in house default.';

-- 4. Hand-off ledger: destination, courier, and the resulting shipment -------
ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS shipping_address JSONB,
  ADD COLUMN IF NOT EXISTS shipping_courier_id TEXT,
  ADD COLUMN IF NOT EXISTS shipping_courier TEXT,
  ADD COLUMN IF NOT EXISTS easyship_shipment_id TEXT,
  ADD COLUMN IF NOT EXISTS tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS shipment_error TEXT,
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN puramass_orders.shipping_address IS
  'Recipient address collected at our checkout, in the same shape as orders.shipping_address (firstName, lastName, address, city, state, postalCode, country, email, phone). Used to create the Easyship shipment on payment. NULL for hand-offs where PuraMass collects the address on its own page.';
COMMENT ON COLUMN puramass_orders.shipping_courier_id IS
  'Easyship courier_service id the customer chose. The rate is always re-quoted server-side before it is charged — a client-sent cost is never trusted.';
COMMENT ON COLUMN puramass_orders.shipping_courier IS
  'Display name of the chosen courier (e.g. "UPS Standard"), recorded for the ledger and the invoice.';
COMMENT ON COLUMN puramass_orders.easyship_shipment_id IS
  'Easyship shipment created when this order was paid. NULL when no shipment was created (feature off, no address, or Easyship unavailable — see shipment_error).';
COMMENT ON COLUMN puramass_orders.shipment_error IS
  'Why the Easyship shipment could not be created, when it failed. Payment is never blocked by a shipment failure; an admin can create the label by hand from the invoice.';
COMMENT ON COLUMN puramass_orders.order_id IS
  'The order row created alongside the fulfillment invoice, carrying the shipping address and Easyship shipment so the invoice shows its shipment exactly as an in-house invoice does.';

CREATE INDEX IF NOT EXISTS idx_puramass_orders_shipment
  ON puramass_orders (easyship_shipment_id) WHERE easyship_shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_order
  ON puramass_orders (order_id) WHERE order_id IS NOT NULL;

COMMIT;
