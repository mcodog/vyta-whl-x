-- =====================================================================
-- Teach get_invoice_stats() about the virtual "outstanding" status
-- ---------------------------------------------------------------------
-- The admin invoices list gained an "Outstanding" filter toggle that
-- shows every invoice still owing money. Server-side this maps to
-- status IN ('sent', 'partial', 'overdue') (mark_overdue_invoices() has
-- already flipped past-due sent/partial rows to 'overdue'), which mirrors
-- the "Outstanding $" summary card's own definition (non-paid, non-draft,
-- non-cancelled).
--
-- The row query in /api/admin/invoices does this with `.in('status', ...)`.
-- This migration updates the stats RPC to recognise the same virtual value
-- so the summary cards stay accurate when the Outstanding filter is active.
-- Everything else is unchanged from invoice-stats-and-customer-rollup-rpc.
--
-- Self-contained and idempotent: safe to run multiple times.
-- =====================================================================

CREATE OR REPLACE FUNCTION get_invoice_stats(
  p_status text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_invoice_type text DEFAULT NULL,
  p_affiliate_customer_ids uuid[] DEFAULT NULL,
  p_affiliate_sales_person_id uuid DEFAULT NULL
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

REVOKE ALL ON FUNCTION get_invoice_stats(text, uuid, text, uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_invoice_stats(text, uuid, text, uuid[], uuid) TO service_role;
