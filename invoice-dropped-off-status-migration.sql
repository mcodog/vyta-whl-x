-- Add a "dropped_off" fulfillment status to invoices.
--
-- Extends the existing fulfillment_status workflow (pending → packed →
-- shipped / picked_up) with a "dropped_off" terminal state, meaning we handed
-- the parcel to the courier ourselves (as opposed to the courier picking it up).
-- The admin can set it from the invoices list's Shipping column.
--
-- Idempotent: safe to run more than once.

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_fulfillment_status_check;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_fulfillment_status_check
  CHECK (fulfillment_status IN ('pending', 'packed', 'shipped', 'picked_up', 'dropped_off'));
