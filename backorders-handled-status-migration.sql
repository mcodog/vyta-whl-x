-- =====================================================================
-- Backorders: "handled" status
-- ---------------------------------------------------------------------
-- Adds a manual "handled" state for backorders. An admin/assistant can
-- move an open backorder to Handled straight from the Backorders table
-- when it's been dealt with outside the create-a-PO flow (resolved by
-- hand, cancelled item, restocked elsewhere, etc.).
--
-- "handled" is distinct from "fulfilled":
--   fulfilled -> flushed by creating a purchase order (has purchase_order_id)
--   handled   -> manually cleared by staff (no PO required)
--
-- Only the backorder row's own status changes. The linked invoice,
-- purchase order and stock are untouched. syncInvoiceBackorder /
-- clearOpenInvoiceBackorder only ever touch OPEN backorders, so a
-- handled row is preserved as history exactly like a fulfilled one.
--
-- Safe to run multiple times.
-- =====================================================================

-- 1. Allow the 'handled' status -------------------------------------
-- The original CHECK (from backorders-migration.sql) is the inline
-- column check, auto-named backorders_status_check.
ALTER TABLE backorders
  DROP CONSTRAINT IF EXISTS backorders_status_check;
ALTER TABLE backorders
  ADD CONSTRAINT backorders_status_check
  CHECK (status IN ('open', 'fulfilled', 'cancelled', 'handled'));

-- 2. Record when a backorder was handled ----------------------------
ALTER TABLE backorders
  ADD COLUMN IF NOT EXISTS handled_at timestamptz;
