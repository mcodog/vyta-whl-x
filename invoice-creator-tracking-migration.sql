-- Invoice creator tracking — who entered each invoice
-- ===================================================
-- Invoices reach the admin list from three places:
--   • an ADMIN / assistant in the back office,
--   • a CLIENT (affiliate) through their client portal, and
--   • the STORE itself, auto-generated from a customer's online checkout.
--
-- Until now the row carried no record of which. This migration adds two columns
-- so the invoices list can tag each row with its source and filter by it:
--
--   created_by       uuid  — the customers.id of the person who entered it
--                            (NULL for store/system-generated invoices).
--   created_by_role  text  — 'admin' | 'assistant' | 'affiliate' | 'system'.
--                            Drives the Source tag/filter; 'affiliate' renders
--                            as "Client", 'system' as "Online".
--
-- The application stamps these on every new invoice (see the invoices POST route
-- and autoCreateInvoiceFromOrder). This migration also backfills existing rows
-- from the data model: store-checkout invoices → 'system', invoices whose sales
-- person is an affiliate → 'affiliate' (Client), and the remaining
-- manually-entered ones → 'admin'. Every backfill pass only fills rows still
-- NULL, so the whole file is idempotent and safe to re-run (re-running after an
-- earlier version applies just the newer passes).

------------------------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_role text
    CHECK (created_by_role IN ('admin', 'assistant', 'affiliate', 'system'));

-- Filter/scan support for the Source filter on the invoices list.
CREATE INDEX IF NOT EXISTS idx_invoices_created_by_role ON invoices (created_by_role);
CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON invoices (created_by);

------------------------------------------------------------------------------
-- 2. Backfill existing invoices by source (runs in order; each pass only fills
--    rows still NULL, so the whole block is idempotent and order-safe).
------------------------------------------------------------------------------

-- 2a. 'system' (store checkout) -------------------------------------------
-- Invoices the app spawns from an admin/affiliate entry create their linked
-- order with crypto = 'invoice' (see createOrderForInvoice), and checkout
-- invoices (autoCreateInvoiceFromOrder) never carry a sales person. Every
-- linked order whose crypto is NOT 'invoice' is a real customer checkout, so
-- its invoice is a store ('system') invoice.
UPDATE invoices i
SET created_by_role = 'system'
FROM orders o
WHERE i.order_id = o.id
  AND i.created_by_role IS NULL
  AND COALESCE(o.crypto, '') <> 'invoice';

-- 2b. 'affiliate' (Client) ------------------------------------------------
-- A client (affiliate) entering an invoice through their portal is always
-- locked to themselves as the sales person (see the invoices POST route:
-- effectiveSalesPersonId = the affiliate's own sales_persons id). Checkout
-- invoices never set a sales person, so an affiliate sales person on an
-- untagged invoice identifies it as client-entered. Also stamp created_by with
-- that affiliate's user id so the Source tag can name them.
UPDATE invoices i
SET created_by_role = 'affiliate',
    created_by = COALESCE(i.created_by, sp.user_id)
FROM sales_persons sp
JOIN customers c ON c.id = sp.user_id
WHERE i.sales_person_id = sp.id
  AND c.role = 'affiliate'
  AND i.created_by_role IS NULL;

-- 2c. 'admin' (staff-entered) ---------------------------------------------
-- By elimination, every invoice still untagged was entered manually in the
-- back office: it isn't a store checkout (2a) and isn't client-entered (2b).
-- Affiliate-entered invoices always have a sales person, so none are missed
-- here. The actual staff member who keyed it is recovered from the audit log
-- in 2d below.
UPDATE invoices
SET created_by_role = 'admin'
WHERE created_by_role IS NULL;

-- 2d. Backfill created_by (who keyed it) from the audit log ----------------
-- Every invoice entered via the back office or the client portal writes an
-- 'invoice.create' audit row stamped with the actor (see logAuditServer in the
-- invoices POST route). Recover that actor so the Source tag can name the
-- admin/client who created the invoice — for admin rows especially, this is the
-- only record of who did it (2b already set created_by for client rows from the
-- sales person, and this won't overwrite it). Store-checkout ('system') rows
-- have no such audit entry and no human creator, so they keep no name. Uses the
-- earliest create event per invoice, and only fills rows whose creator isn't
-- already known — so it stays idempotent.
UPDATE invoices i
SET created_by = a.actor_id
FROM (
  SELECT DISTINCT ON (entity_id) entity_id, actor_id
  FROM audit_log
  WHERE entity_type = 'invoice'
    AND action = 'invoice.create'
    AND actor_id IS NOT NULL
  ORDER BY entity_id, created_at ASC
) a
WHERE a.entity_id = i.id
  AND i.created_by IS NULL
  AND i.created_by_role <> 'system';

------------------------------------------------------------------------------
-- 3. Extend get_invoice_stats with a created-source filter
------------------------------------------------------------------------------
-- The summary cards must stay accurate when the list is filtered by Source, so
-- the stats RPC gains a p_created_source param mirroring the API filter:
--   'admin'  → created_by_role IN ('admin','assistant')
--   'client' → created_by_role = 'affiliate'
--   'online' → created_by_role = 'system'
-- Dropped-and-recreated (not just replaced) because the argument list changes.
-- Everything else (including the virtual "outstanding" status handling from
-- invoice-outstanding-filter-migration.sql) is carried over unchanged.
DROP FUNCTION IF EXISTS get_invoice_stats(text, uuid, text, uuid[], uuid);

CREATE OR REPLACE FUNCTION get_invoice_stats(
  p_status text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_invoice_type text DEFAULT NULL,
  p_affiliate_customer_ids uuid[] DEFAULT NULL,
  p_affiliate_sales_person_id uuid DEFAULT NULL,
  p_created_source text DEFAULT NULL
)
RETURNS TABLE (
  count bigint,
  outstanding numeric,
  overdue_count bigint,
  paid bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT
      i.status,
      i.total,
      i.due_date,
      COALESCE((
        SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id
      ), 0) AS paid_amt
    FROM invoices i
    WHERE (
        p_status IS NULL
        -- Virtual "outstanding" = still owes money (sent/partial/overdue).
        OR (p_status = 'outstanding' AND i.status IN ('sent', 'partial', 'overdue'))
        OR (p_status <> 'outstanding' AND i.status = p_status)
      )
      AND (p_customer_id IS NULL OR i.customer_id = p_customer_id)
      AND (p_invoice_type IS NULL OR i.invoice_type = p_invoice_type)
      AND (
        p_created_source IS NULL
        OR (p_created_source = 'admin'  AND i.created_by_role IN ('admin', 'assistant'))
        OR (p_created_source = 'client' AND i.created_by_role = 'affiliate')
        OR (p_created_source = 'online' AND i.created_by_role = 'system')
      )
      AND (
        -- Unscoped (admin/assistant): both scope params NULL.
        (p_affiliate_customer_ids IS NULL AND p_affiliate_sales_person_id IS NULL)
        -- Affiliate: customers bound to them, OR invoices they're the rep on.
        OR (p_affiliate_customer_ids IS NOT NULL AND i.customer_id = ANY(p_affiliate_customer_ids))
        OR (p_affiliate_sales_person_id IS NOT NULL AND i.sales_person_id = p_affiliate_sales_person_id)
      )
  )
  SELECT
    COUNT(*)::bigint AS count,
    COALESCE(SUM(
      CASE
        WHEN status NOT IN ('paid', 'draft', 'cancelled')
        THEN GREATEST(0, total - paid_amt)
        ELSE 0
      END
    ), 0)::numeric AS outstanding,
    COUNT(*) FILTER (
      WHERE status = 'overdue'
         OR (status IN ('sent', 'partial') AND due_date < CURRENT_DATE)
    )::bigint AS overdue_count,
    COUNT(*) FILTER (WHERE status = 'paid')::bigint AS paid
  FROM scoped;
$$;

REVOKE ALL ON FUNCTION get_invoice_stats(text, uuid, text, uuid[], uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_invoice_stats(text, uuid, text, uuid[], uuid, text) TO service_role;
