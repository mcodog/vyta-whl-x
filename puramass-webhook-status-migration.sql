-- PuraMass hosted checkout — webhook / status columns
-- =====================================================================
-- Run this in the Supabase SQL editor (after puramass-hosted-checkout-migration.sql).
--
-- Adds the fields the PuraMass status webhook (store_order.payment_complete) and
-- the status-polling endpoint (GET /partner/store/orders/{transaction_id}) write
-- back onto each hand-off, so the admin ledger reflects live payment status.
--
--   paid_at        — when payment was captured (status = 'paid')
--   currency       — order currency reported by PuraMass (e.g. 'usd')
--   last_event_id  — id of the last processed webhook event (idempotency /
--                    at-least-once dedupe)

ALTER TABLE puramass_orders
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS last_event_id TEXT;

COMMENT ON COLUMN puramass_orders.paid_at IS
  'When PuraMass captured payment (status = paid). Set by the webhook / status refresh.';
COMMENT ON COLUMN puramass_orders.last_event_id IS
  'Last processed PuraMass webhook event_id — used to dedupe at-least-once deliveries.';
