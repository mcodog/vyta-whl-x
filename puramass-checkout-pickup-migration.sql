-- PuraMass hosted checkout — pickup instead of a courier
-- =====================================================================
-- Run this in the Supabase SQL editor (after puramass-customer-checkout-migration.sql).
--
-- A customer at the hosted checkout can now collect their order in person
-- instead of choosing a courier. Such a hand-off sends PuraMass
-- `shipping_total_cents: 0` (which is also what switches off PuraMass's own
-- default rate) and carries no address, so no Easyship shipment is created when
-- it is paid.
--
-- Without somewhere to record that, a pickup row is indistinguishable from a
-- hand-off that let PuraMass collect the address on its own page — and the
-- invoice raised for it would tell the warehouse to pack a parcel for an order
-- the customer is coming to fetch. This column is that record.
--
-- Safe to run more than once. The hand-off falls back to inserting without this
-- column, and the webhook to reading without it, so nothing breaks before it is
-- run — a pickup is then simply invoiced as a shipment with no address.

ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS fulfillment_type TEXT;

COMMENT ON COLUMN puramass_orders.fulfillment_type IS
  'How the customer is getting this order: ''shipment'' (a courier they chose and paid for at our checkout) or ''pickup'' (collected in person — shipping_total_cents 0, no address, no Easyship shipment). NULL for hand-offs that predate the choice, or that let PuraMass handle shipping on its own page; both are treated as shipments.';
