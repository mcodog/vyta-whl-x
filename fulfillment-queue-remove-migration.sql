-- Fulfillment queue — manual removal
-- ==================================
-- Lets warehouse staff/admins take an invoice out of the active fulfillment
-- queue (e.g. cancelled, on hold, or a draft that won't be fulfilled). Removed
-- invoices move to the "Fulfilled / Removed" view and can be restored.
--
-- Idempotent — safe to run more than once.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS removed_from_queue boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES customers (id) ON DELETE SET NULL;

-- Partial index for the common "active queue" lookup (removed = false).
CREATE INDEX IF NOT EXISTS idx_invoices_removed_from_queue
  ON invoices (removed_from_queue);
