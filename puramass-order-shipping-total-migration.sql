-- PuraMass hand-off shipping total
-- Invoice payment links now name their own amounts on the partner order (a
-- per-line unit_price_cents plus an order-level shipping_total_cents), so the
-- hosted checkout charges what the invoice says instead of PuraMass's catalog
-- price. This records the shipping figure we sent alongside the priced items
-- already stored in `items`.
--
-- It is what lets the payment page tell a reusable link from a stale one: if
-- the invoice's shipping changed after the link was minted, the pending link
-- would charge the old amount, so a fresh hand-off is created instead.
--
-- Safe to run more than once. The code falls back to inserting without this
-- column if the migration hasn't been run, so nothing breaks in the meantime.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS shipping_total_cents INTEGER;

COMMENT ON COLUMN puramass_orders.shipping_total_cents IS
  'Shipping total (in cents) sent to PuraMass with this hand-off; 0 means free shipping was requested. NULL for hand-offs that let PuraMass apply its own rate.';
