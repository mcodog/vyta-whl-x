-- Customer pricing mode (template vs dedicated)
-- =============================================
-- Records, per customer, whether their prices are a faithful copy of a shared
-- price list ("template") or bespoke to them ("dedicated"). This replaces the
-- expensive "diff every override against the applied list" read with a single
-- stored flag that the app maintains O(1) at each write:
--
--   * template  — prices were set by applying a shared pricelists row
--                 (customers.applied_pricelist_id) and have not been hand-edited
--                 since. Also the resting state for a customer with no custom
--                 prices at all (they simply follow the active/house list).
--   * dedicated — a price was hand-managed: a single/bulk override edit, an
--                 override delete, or a CSV price import. There is no faithful
--                 shared source for their numbers.
--
-- Applying a price list (apply-to-customer) moves a customer back to 'template';
-- any manual price write moves them to 'dedicated'. See:
--   * app/api/admin/pricelists/[id]/apply-to-customer/route.ts
--   * app/api/admin/price-overrides/route.ts (POST / DELETE)
--   * app/api/admin/price-overrides/import/route.ts (apply)
--   * lib/admin/pricing-mode.ts (the shared helper)
--   * components/admin/InvoiceForm.tsx (surfaces the badge on affiliate invoices)
--
-- Purely additive. Idempotent and safe to run multiple times. Run this in the
-- Supabase SQL editor.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Column — defaults to 'template' so an untouched customer (no custom
--    prices) reads as following the shared/house pricing.
-- ---------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'template'
  CHECK (pricing_mode IN ('template', 'dedicated'));

COMMENT ON COLUMN customers.pricing_mode IS
  'How this customer''s prices are sourced: "template" (a faithful copy of the applied shared price list, or no custom prices at all) or "dedicated" (hand-managed overrides / CSV import with no faithful shared source). Maintained by the price-override and apply-to-customer write paths; see lib/admin/pricing-mode.ts.';

-- Helpful when filtering/reporting by mode.
CREATE INDEX IF NOT EXISTS idx_customers_pricing_mode ON customers(pricing_mode);

-- ---------------------------------------------------------------------------
-- 2. Backfill — flag as 'dedicated' any customer that already carries a
--    price override which is NOT a faithful copy of their applied list.
--
--    A customer is dedicated when they have at least one price-bearing override
--    (override_price IS NOT NULL) that has no matching item at the same price in
--    their applied price list. When applied_pricelist_id is NULL the inner join
--    finds nothing, so every custom price counts as a deviation — i.e. a
--    customer with bespoke prices and no shared source is dedicated. A customer
--    with no price overrides (or whose overrides all match the applied list)
--    keeps the default 'template'.
--
--    Note: a customer who is merely a SUBSET of their list (missing some items,
--    e.g. because the list grew after it was applied) is intentionally left as
--    'template' — only a differing or extra override marks them dedicated. This
--    mirrors the going-forward rule ("a hand-edit makes you dedicated") and
--    avoids mislabeling drift as customization.
-- ---------------------------------------------------------------------------
UPDATE customers c
   SET pricing_mode = 'dedicated',
       updated_at = now()
 WHERE EXISTS (
         SELECT 1
           FROM customer_price_overrides po
          WHERE po.customer_id = c.id
            AND po.override_price IS NOT NULL
            AND NOT EXISTS (
                  SELECT 1
                    FROM pricelist_items pi
                   WHERE pi.pricelist_id = c.applied_pricelist_id
                     AND pi.product_id = po.product_id
                     AND pi.price = po.override_price
                )
       )
   AND c.pricing_mode IS DISTINCT FROM 'dedicated';

-- Report the split.
DO $$
DECLARE
  dedicated_count int;
  template_count int;
BEGIN
  SELECT count(*) INTO dedicated_count FROM customers WHERE pricing_mode = 'dedicated';
  SELECT count(*) INTO template_count  FROM customers WHERE pricing_mode = 'template';
  RAISE NOTICE 'pricing_mode backfill — dedicated: %, template: %', dedicated_count, template_count;
END $$;

COMMIT;
