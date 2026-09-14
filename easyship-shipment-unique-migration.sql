-- Enforce one order per Easyship shipment id.
--
-- The original index (easyship-settings-migration.sql) was a plain, NON-unique
-- partial index. That allowed two different orders to bind to the same Easyship
-- shipment (e.g. via the easyship-sync path) and gave no protection against
-- duplicate shipments. Making it UNIQUE closes that gap; combined with the
-- conditional "claim only if unclaimed" update in the create-shipment route, an
-- order can no longer be double-attached to shipments.
--
-- NOTE: if any duplicate non-null easyship_shipment_id values already exist in
-- prod, deduplicate them first — this CREATE will fail until they're resolved.

DROP INDEX IF EXISTS idx_orders_easyship_shipment;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_easyship_shipment
  ON orders (easyship_shipment_id) WHERE easyship_shipment_id IS NOT NULL;
