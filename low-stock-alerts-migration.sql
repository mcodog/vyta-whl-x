-- =====================================================================
-- Low-stock alerts
-- ---------------------------------------------------------------------
-- Every product has a `low_stock_threshold` (default 10). When the
-- product's `stock_quantity` drops to or below that threshold, an alert
-- email is sent to the admin notification list
-- (site_settings.admin_emails), the product surfaces on the admin
-- dashboard, and a badge appears on the Products nav item.
--
-- `low_stock_alerted` is a dedupe flag so we email once per crossing.
-- It is reset to false when stock rises back above the threshold so the
-- next dip re-alerts.
--
-- Safe to run multiple times (also fixes up an earlier install where the
-- column was added as nullable without a default).
-- =====================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS low_stock_alerted boolean NOT NULL DEFAULT false;

-- Backfill any existing rows (and earlier nullable installs) to the default.
UPDATE products SET low_stock_threshold = 10 WHERE low_stock_threshold IS NULL;

-- Every product carries a threshold; default new rows to 10.
ALTER TABLE products ALTER COLUMN low_stock_threshold SET DEFAULT 10;
ALTER TABLE products ALTER COLUMN low_stock_threshold SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_low_stock
  ON products (low_stock_threshold);

COMMENT ON COLUMN products.low_stock_threshold IS 'Stock level at/below which a low-stock alert fires. Defaults to 10.';
COMMENT ON COLUMN products.low_stock_alerted IS 'True once a low-stock alert has been sent; reset when stock rises above the threshold.';
