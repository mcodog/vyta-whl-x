-- Fulfillment queue — clear-from-queue note
-- =========================================
-- When warehouse staff take an order out of the active fulfillment queue via
-- "Clear from queue", they record a short reason. That note is stored here and
-- shown in the "Fulfilled / Removed" view so anyone can see why the order was
-- cleared. Pairs with removed_from_queue / removed_at / removed_by
-- (fulfillment-queue-remove-migration.sql).
--
-- Idempotent — safe to run more than once.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS removed_note text;
