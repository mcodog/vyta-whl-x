-- User de-duplication: merge a plain customer record into an affiliate
-- =====================================================================
-- Run this once in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- WHY
-- ---
-- An affiliate is "a sales person with a login" (ADR 0003): creating one writes
-- three rows that SHARE ONE auth UID —
--   affiliates.id = customers.id = sales_persons.user_id = auth uid
-- so an affiliate already owns a `customers` row (role='affiliate') and can be
-- invoiced like any customer.
--
-- The discrepancy this fixes: the SAME email ends up on TWO different `customers`
-- rows with DIFFERENT ids —
--   * the affiliate's own row       (role='affiliate', id = auth uid), and
--   * a separate plain customer row  (role='customer', a GUEST with no login),
--     typically seeded by the invoice quick-add "new account" path.
-- Their invoices/orders/prices are then split across two records for one person.
--
-- Supabase Auth enforces unique emails, so at most ONE of the two rows can have a
-- login. The affiliate always does, therefore the duplicate is always the GUEST —
-- which is why the merge below never has to touch auth.users.
--
-- WHAT
-- ----
-- 1. Defines merge_customer_records(source, target): re-points every
--    customer-OWNED row from `source` onto `target` (respecting each table's
--    unique constraints), back-fills any profile field the target is missing,
--    then deletes the now-empty source `customers` row.
-- 2. Backfills: for every affiliate that shares an email with one or more plain
--    `customers` rows, merges those plain rows into the affiliate.
--
-- Going forward the create flows (POST /api/admin/customers and
-- POST /api/admin/affiliates) detect the collision up front and route the new
-- record into the existing one, so no new duplicates are minted — this script
-- reconciles the pairs that already exist.

BEGIN;

-- ---------------------------------------------------------------------------
-- merge_customer_records(p_source, p_target)
-- Folds the customer-owned data of p_source into p_target, then removes p_source.
-- Actor columns (created_by / actor_id / …) are deliberately NOT re-pointed: the
-- source is a guest that never performed staff actions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION merge_customer_records(p_source uuid, p_target uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_source IS NULL OR p_target IS NULL OR p_source = p_target THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_target) THEN
    RAISE EXCEPTION 'merge target % does not exist', p_target;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_source) THEN
    RETURN; -- nothing to merge
  END IF;

  -- Invoices & orders — no per-customer uniqueness, straight re-point.
  UPDATE invoices SET customer_id = p_target WHERE customer_id = p_source;
  UPDATE orders   SET customer_id = p_target WHERE customer_id = p_source;

  -- Customer price overrides — UNIQUE(customer_id, product_id). Keep the
  -- target's existing price for a product; move only the products it lacks.
  IF to_regclass('public.customer_price_overrides') IS NOT NULL THEN
    UPDATE customer_price_overrides s
       SET customer_id = p_target
     WHERE s.customer_id = p_source
       AND NOT EXISTS (
         SELECT 1 FROM customer_price_overrides t
          WHERE t.customer_id = p_target AND t.product_id = s.product_id
       );
    DELETE FROM customer_price_overrides WHERE customer_id = p_source;
  END IF;

  -- Saved ship-to clients — no per-customer uniqueness, straight re-point.
  IF to_regclass('public.customer_clients') IS NOT NULL THEN
    UPDATE customer_clients SET customer_id = p_target WHERE customer_id = p_source;
  END IF;

  -- Inactive-notification log — UNIQUE(customer_id, days_threshold).
  IF to_regclass('public.customer_inactive_notifications') IS NOT NULL THEN
    UPDATE customer_inactive_notifications s
       SET customer_id = p_target
     WHERE s.customer_id = p_source
       AND NOT EXISTS (
         SELECT 1 FROM customer_inactive_notifications t
          WHERE t.customer_id = p_target AND t.days_threshold = s.days_threshold
       );
    DELETE FROM customer_inactive_notifications WHERE customer_id = p_source;
  END IF;

  -- Cart snapshot — PRIMARY KEY(customer_id), one per customer. Keep target's.
  IF to_regclass('public.customer_carts') IS NOT NULL THEN
    UPDATE customer_carts s
       SET customer_id = p_target
     WHERE s.customer_id = p_source
       AND NOT EXISTS (SELECT 1 FROM customer_carts t WHERE t.customer_id = p_target);
    DELETE FROM customer_carts WHERE customer_id = p_source;
  END IF;

  -- Affiliate applications — UNIQUE(customer_id) WHERE status='pending'.
  IF to_regclass('public.affiliate_requests') IS NOT NULL THEN
    UPDATE affiliate_requests s
       SET customer_id = p_target
     WHERE s.customer_id = p_source
       AND (
         s.status <> 'pending'
         OR NOT EXISTS (
           SELECT 1 FROM affiliate_requests t
            WHERE t.customer_id = p_target AND t.status = 'pending'
         )
       );
    DELETE FROM affiliate_requests WHERE customer_id = p_source;
  END IF;

  -- Stock waitlist — unique index is (product_id, email), not customer_id, so a
  -- plain re-point is safe.
  IF to_regclass('public.stock_notifications') IS NOT NULL THEN
    UPDATE stock_notifications SET customer_id = p_target WHERE customer_id = p_source;
  END IF;

  -- Back-fill any profile field the target is missing from the source, without
  -- ever overwriting the target's own identity (name/email/role untouched).
  UPDATE customers t
     SET phone                  = COALESCE(t.phone, s.phone),
         alternate_email        = COALESCE(t.alternate_email, s.alternate_email),
         shipping_address       = COALESCE(t.shipping_address, s.shipping_address),
         shipping_city          = COALESCE(t.shipping_city, s.shipping_city),
         shipping_state         = COALESCE(t.shipping_state, s.shipping_state),
         shipping_postal_code   = COALESCE(t.shipping_postal_code, s.shipping_postal_code),
         shipping_country       = COALESCE(t.shipping_country, s.shipping_country),
         price_currency         = COALESCE(t.price_currency, s.price_currency),
         default_sales_person_id = COALESCE(t.default_sales_person_id, s.default_sales_person_id),
         affiliate_id           = COALESCE(t.affiliate_id, s.affiliate_id),
         applied_pricelist_id   = COALESCE(t.applied_pricelist_id, s.applied_pricelist_id),
         updated_at             = now()
    FROM customers s
   WHERE t.id = p_target AND s.id = p_source;

  -- The source's data now lives on the target — remove the duplicate row.
  DELETE FROM customers WHERE id = p_source;
END;
$$;

COMMENT ON FUNCTION merge_customer_records(uuid, uuid) IS
  'Fold a duplicate (guest) customer''s data into a surviving customer/affiliate, then delete the duplicate. See user-dedup-affiliate-customer-merge-migration.sql.';

-- ---------------------------------------------------------------------------
-- One-time backfill: merge existing same-email duplicates into the affiliate.
-- The affiliate row (the one whose id is also in `affiliates`) is the survivor;
-- every OTHER customers row sharing that email is folded into it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  merged_count integer := 0;
BEGIN
  FOR r IN
    SELECT dup.id AS source_id, aff_cust.id AS target_id, aff_cust.email AS email
    FROM customers aff_cust
    JOIN affiliates a ON a.id = aff_cust.id           -- target = the affiliate's own record
    JOIN customers dup
      ON lower(dup.email) = lower(aff_cust.email)      -- same email …
     AND dup.id <> aff_cust.id                         -- … different row …
     AND dup.id NOT IN (SELECT id FROM affiliates)     -- … that is a plain customer (not itself an affiliate)
    WHERE aff_cust.email IS NOT NULL
  LOOP
    PERFORM merge_customer_records(r.source_id, r.target_id);
    merged_count := merged_count + 1;
    RAISE NOTICE 'Merged customer % into affiliate % (%).', r.source_id, r.target_id, r.email;
  END LOOP;
  RAISE NOTICE 'Backfill complete: % duplicate customer record(s) merged into affiliates.', merged_count;
END $$;

COMMIT;

-- Verify (optional): should return no rows once reconciled — a plain customer
-- record still sharing an email with an affiliate.
--   SELECT c.id AS customer_id, a.id AS affiliate_id, c.email
--   FROM customers c
--   JOIN affiliates a ON lower(a.email) = lower(c.email)
--   WHERE c.id <> a.id AND c.id NOT IN (SELECT id FROM affiliates);
