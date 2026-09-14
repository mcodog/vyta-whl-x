-- Manually recorded order payments (admin)
-- Lets an admin record a payment against an order from the order detail page,
-- capturing how it was paid, when it was received, and whether it covered the
-- order in full or only partially.
--   * payment_method          — how the payment came in: 'etransfer', 'crypto',
--                               'credit_card' or 'other'.
--   * payment_received_at      — the date/time the payment was received.
--   * payment_received_status  — 'full' when the whole order total was paid, or
--                               'partial' when only part of it was.
--   * payment_received_amount  — the dollar amount recorded as received. Equals
--                               the order total for a full payment; the entered
--                               figure for a partial one.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_received_status text,
  ADD COLUMN IF NOT EXISTS payment_received_amount numeric(10,2);

COMMENT ON COLUMN orders.payment_method IS 'Manually recorded payment method: etransfer, crypto, credit_card or other.';
COMMENT ON COLUMN orders.payment_received_at IS 'Date/time the recorded payment was received.';
COMMENT ON COLUMN orders.payment_received_status IS 'Whether the recorded payment covered the order in full or partially: full | partial.';
COMMENT ON COLUMN orders.payment_received_amount IS 'Dollar amount recorded as received (order total for a full payment, entered amount for a partial one).';
