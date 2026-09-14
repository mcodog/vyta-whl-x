-- Pre-delete data review + decisions (customers / sales people / users)
-- =====================================================================
-- Before this migration, deleting a person was an invisible, all-or-nothing
-- action:
--   * invoices.customer_id / orders.customer_id  -> ON DELETE SET NULL (kept,
--     with a name/email/phone snapshot written by trg_mark_invoices_customer_deleted),
--   * customer_clients / customer_price_overrides / customer_carts -> CASCADE (wiped),
--   * a sales person's sales_commissions -> CASCADE (wiped).
-- There was no chance to review what would be affected, and no permanent record
-- of the removed person.
--
-- This migration adds the storage the new "review & decide" delete flow needs:
--   1. entity_deletion_snapshots — an immutable in-app archive of everything a
--      deleted person owned at the moment of deletion (viewable + downloadable).
--   2. Placeholder columns on customers so a login-less "guest" record can hold
--      the kept invoices / ship-to clients of a deleted customer, keeping them
--      grouped and openable instead of orphaned with a null customer_id.
--
-- Nothing here changes the existing foreign-key behaviour; the application layer
-- (lib/admin/deletion-execute.ts) re-points rows onto the guest BEFORE the
-- delete so the SET NULL / CASCADE rules only apply to whatever the admin chose
-- to leave behind. Safe to re-run.

------------------------------------------------------------------------------
-- 1. Deletion snapshots (the stored archive)
------------------------------------------------------------------------------
-- entity_id is intentionally NOT a foreign key: the row it points at is about to
-- be (or already has been) deleted. The snapshot jsonb is the source of truth.
CREATE TABLE IF NOT EXISTS entity_deletion_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('customer', 'sales_person', 'user')),
  entity_id uuid,
  entity_label text,                 -- "John Doe <john@x.com>" for the archive list
  snapshot jsonb NOT NULL,           -- full captured profile + invoices + clients + commissions
  counts jsonb,                      -- { invoices, orders, clients, commissions, payments }
  disposition jsonb,                 -- the decisions the admin applied
  guest_customer_id uuid,            -- the placeholder created to hold kept rows, if any
  created_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_deletion_snapshots_created
  ON entity_deletion_snapshots (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_deletion_snapshots_entity
  ON entity_deletion_snapshots (entity_type, entity_id);

-- All reads/writes go through the service-role admin API, so the role check in
-- the route IS the access boundary (matches invoices/customer_clients). A
-- staff-only read policy is added for any future JWT client use.
ALTER TABLE entity_deletion_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entity_deletion_snapshots_staff_read ON entity_deletion_snapshots;
CREATE POLICY entity_deletion_snapshots_staff_read ON entity_deletion_snapshots
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin', 'assistant')
    )
  );

------------------------------------------------------------------------------
-- 2. Guest placeholder flags on customers
------------------------------------------------------------------------------
-- A placeholder is a normal customers row (role 'customer', active=false, no
-- auth user) created to inherit a deleted customer's kept invoices/clients.
-- is_deleted_placeholder lets the Customers list badge/segregate them, and
-- placeholder_source_name keeps the original person's name for display even
-- though the placeholder is renamed for clarity.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_deleted_placeholder boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS placeholder_source_name text,
  ADD COLUMN IF NOT EXISTS placeholder_created_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_customers_deleted_placeholder
  ON customers (is_deleted_placeholder)
  WHERE is_deleted_placeholder = true;
