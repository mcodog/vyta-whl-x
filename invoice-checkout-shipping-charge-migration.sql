-- Charge shipping on an invoice's hosted checkout (opt-in, per invoice)
--
-- An invoice's payment link hands the order to Stealth Health (PuraMass) with
-- the amounts we name: a per-line `unit_price_cents` plus an order-level
-- `shipping_total_cents`. That shipping figure used to be the invoice's own
-- `shipping_cost`, which meant a customer paying by card was billed shipping
-- twice whenever it had already been collected another way.
--
-- Shipping on the checkout is now OFF unless an admin ticks it on the invoice:
-- with this flag false (the default) the hand-off sends `shipping_total_cents:
-- 0` — a real value at the partner API, and how a hand-off switches off their
-- default $35.00 rate. Ticked, the invoice's `shipping_cost` is wired into the
-- payload instead.
--
-- Safe to run more than once. Code reads a missing column as false, so nothing
-- breaks before this runs — links simply keep behaving as "shipping not
-- charged", which is the new default anyway.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS charge_shipping_on_checkout BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN invoices.charge_shipping_on_checkout IS
  'When true, this invoice''s hosted-checkout hand-off sends its shipping_cost as shipping_total_cents. False (default) sends 0, so the payment link charges the items only.';
