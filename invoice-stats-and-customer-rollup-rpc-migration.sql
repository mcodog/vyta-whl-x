-- =====================================================================
-- RPCs: invoice list stats + per-customer invoice rollup
-- ---------------------------------------------------------------------
-- Two read-only aggregate functions that move heavy list-page rollups
-- out of the API (where they were done by fetching every row into memory,
-- silently capped at PostgREST's 1000-row limit) and into the database:
--
--   1. get_invoice_stats(...)  — the summary-card totals for the admin
--      invoices list (count / outstanding / overdue / paid), computed over
--      the full status+scope-filtered set regardless of pagination. Mirrors
--      the previous in-API reduce exactly, including the "effective overdue"
--      rule (status='overdue' OR (sent/partial AND past due)).
--
--   2. get_customer_invoice_rollup(...) — per-customer invoice_count +
--      gross invoiced_total, so the admin customers list can sort by invoice
--      volume / spend without scanning the invoices table page by page.
--
-- Both are SECURITY DEFINER and executable only by service_role (the API
-- calls them through the service-role client). EXECUTE is revoked from
-- PUBLIC so the anon/authenticated keys cannot read these financials
-- directly.
--
-- Self-contained and idempotent: safe to run multiple times.
-- =====================================================================

-- 1. Invoice list stats ----------------------------------------------
-- Params mirror the invoices GET filters. Affiliate scoping: pass a
-- (possibly empty) array of the affiliate's customer ids AND/OR their
-- sales_person id; when BOTH scope params are NULL the caller is treated
-- as unscoped (admin/assistant) and every invoice is considered.
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
    WHERE (p_status IS NULL OR i.status = p_status)
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

-- 2. Per-customer invoice rollup -------------------------------------
-- invoice_count excludes backorder child invoices; invoiced_total is the
-- gross of non-backorder, non-cancelled invoices. Pass p_customer_ids to
-- scope (an affiliate's bound customers); NULL = all customers.
CREATE OR REPLACE FUNCTION get_customer_invoice_rollup(
  p_customer_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  customer_id uuid,
  invoice_count bigint,
  invoiced_total numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.customer_id,
    COUNT(*) FILTER (WHERE NOT COALESCE(i.is_backorder, false))::bigint AS invoice_count,
    COALESCE(SUM(
      CASE
        WHEN NOT COALESCE(i.is_backorder, false) AND i.status <> 'cancelled'
        THEN i.total
        ELSE 0
      END
    ), 0)::numeric AS invoiced_total
  FROM invoices i
  WHERE i.customer_id IS NOT NULL
    AND (p_customer_ids IS NULL OR i.customer_id = ANY(p_customer_ids))
  GROUP BY i.customer_id;
$$;

-- 3. Lock down execution ---------------------------------------------
-- Only the server (service_role client) may call these; they expose
-- aggregate financials and bypass RLS (SECURITY DEFINER).
REVOKE ALL ON FUNCTION get_invoice_stats(text, uuid, text, uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_customer_invoice_rollup(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_invoice_stats(text, uuid, text, uuid[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION get_customer_invoice_rollup(uuid[]) TO service_role;
