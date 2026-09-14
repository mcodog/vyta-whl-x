-- Inactive-customer notifications + customer takeover / contact tracking
-- =====================================================================
-- Run this in the Supabase SQL editor.
--
-- Adds:
--   1. Settings for the "customer registered but hasn't ordered" admin alert
--      (an enable flag + a list of day thresholds — the admin can configure
--      several, e.g. remind at 3, 7 and 14 days).
--   2. A per-customer / per-threshold log so each nudge fires exactly once.
--   3. Takeover / assignment columns on `customers` so an admin can claim a
--      customer for contacting, and everyone can see who owns them.
--   4. A lightweight snapshot of each logged-in customer's current cart, so the
--      takeover page can show whether they've added anything to their cart.
--   5. A Supabase-native schedule (pg_cron + pg_net) that calls the app's
--      /api/cron/inactive-customers route daily — no external cron needed.

------------------------------------------------------------------------------
-- 1. Inactive-customer notification settings (singleton site_settings row)
------------------------------------------------------------------------------
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS inactive_customer_notification_enabled BOOLEAN DEFAULT false,
  -- Day thresholds after registration at which to alert admins if the customer
  -- still has no order. e.g. '{3,7,14}'. Empty = no alerts.
  ADD COLUMN IF NOT EXISTS inactive_customer_notify_days INTEGER[] DEFAULT '{}';

COMMENT ON COLUMN site_settings.inactive_customer_notification_enabled IS
  'Whether admins are emailed when a customer registers but has not ordered.';
COMMENT ON COLUMN site_settings.inactive_customer_notify_days IS
  'Days-after-registration thresholds that each trigger one no-order alert.';

------------------------------------------------------------------------------
-- 2. Per-customer / per-threshold sent-log (idempotency for the cron)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_inactive_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  -- Which configured day-threshold this row records having sent.
  days_threshold integer NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, days_threshold)
);

CREATE INDEX IF NOT EXISTS idx_customer_inactive_notifications_customer
  ON customer_inactive_notifications (customer_id);

ALTER TABLE customer_inactive_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON customer_inactive_notifications;
CREATE POLICY "Service role full access" ON customer_inactive_notifications
  FOR ALL USING (true) WITH CHECK (true);

------------------------------------------------------------------------------
-- 3. Customer takeover / assignment (who is contacting this customer)
------------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS assigned_admin_id uuid REFERENCES customers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_admin_name text,
  ADD COLUMN IF NOT EXISTS assigned_admin_email text,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

COMMENT ON COLUMN customers.assigned_admin_id IS
  'The admin (customers.id) who has taken over this customer for contacting.';

CREATE INDEX IF NOT EXISTS idx_customers_assigned_admin
  ON customers (assigned_admin_id) WHERE assigned_admin_id IS NOT NULL;

------------------------------------------------------------------------------
-- 4. Cart snapshot per customer (for the "added to cart" indicator)
------------------------------------------------------------------------------
-- One row per customer holding the latest cart contents. Written by the store
-- whenever a signed-in customer's cart changes; read by the takeover page.
CREATE TABLE IF NOT EXISTS customer_carts (
  customer_id uuid PRIMARY KEY REFERENCES customers (id) ON DELETE CASCADE,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  item_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_carts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON customer_carts;
CREATE POLICY "Service role full access" ON customer_carts
  FOR ALL USING (true) WITH CHECK (true);

------------------------------------------------------------------------------
-- 5. Schedule the daily no-order check inside Supabase (pg_cron + pg_net)
------------------------------------------------------------------------------
-- This replaces any external/Vercel cron for the inactive-customer alert.
-- pg_cron fires the schedule; pg_net makes the outbound HTTPS call to the app
-- route, which does the real work (queries + nodemailer email send).
--
-- One-time setup — enable the extensions (safe to re-run):
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- Then create/replace the schedule. EDIT the two placeholders below:
--   * the URL host must be your deployed site (e.g. https://puramass.com)
--   * the Bearer token must equal the app's CRON_SECRET env var
--
-- Runs daily at 09:00 UTC. Un-comment and run once (re-running with the same
-- job name first unschedules the old one).
--
-- select cron.unschedule('inactive-customer-notify')
--   where exists (select 1 from cron.job where jobname = 'inactive-customer-notify');
--
-- select cron.schedule(
--   'inactive-customer-notify',
--   '0 9 * * *',
--   $$
--     select net.http_post(
--       url     := 'https://puramass.com/api/cron/inactive-customers',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer REPLACE_WITH_CRON_SECRET'
--       ),
--       body    := '{}'::jsonb
--     );
--   $$
-- );
--
-- To inspect runs:   select * from cron.job;   select * from cron.job_run_details order by start_time desc limit 20;
