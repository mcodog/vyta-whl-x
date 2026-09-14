-- Scheduled Stock Report email
-- =====================================================================
-- Run this in the Supabase SQL editor.
--
-- Adds an opt-in scheduled email that sends the (money-free) Stock Report to a
-- configured set of recipients on a daily / weekly / monthly cadence. The
-- recipients + cadence are configured from admin/products.
--
-- Adds:
--   1. site_settings columns holding the schedule configuration + a last-sent
--      marker (used by the cron to decide whether a send is due).
--   2. A Supabase-native schedule (pg_cron + pg_net) that calls the app's
--      /api/cron/stock-report-email route once a day. The route itself checks
--      the configured frequency and last-sent time to decide whether to send —
--      so "weekly"/"monthly" are enforced in the app, not the cron expression.

------------------------------------------------------------------------------
-- 1. Schedule configuration (singleton site_settings row)
------------------------------------------------------------------------------
ALTER TABLE site_settings
  -- Master on/off for the scheduled Stock Report email.
  ADD COLUMN IF NOT EXISTS stock_report_email_enabled BOOLEAN NOT NULL DEFAULT false,
  -- Who receives it.
  ADD COLUMN IF NOT EXISTS stock_report_email_recipients TEXT[] NOT NULL DEFAULT '{}',
  -- How often: 'daily' | 'weekly' | 'monthly'.
  ADD COLUMN IF NOT EXISTS stock_report_email_frequency TEXT NOT NULL DEFAULT 'weekly',
  -- When the report was last sent (used for the due-check + shown in the UI).
  ADD COLUMN IF NOT EXISTS stock_report_email_last_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN site_settings.stock_report_email_enabled IS
  'Whether the scheduled Stock Report email is active.';
COMMENT ON COLUMN site_settings.stock_report_email_recipients IS
  'Email addresses that receive the scheduled Stock Report.';
COMMENT ON COLUMN site_settings.stock_report_email_frequency IS
  'Cadence for the scheduled Stock Report email: daily | weekly | monthly.';
COMMENT ON COLUMN site_settings.stock_report_email_last_sent_at IS
  'When the scheduled Stock Report email was last sent (drives the cron due-check).';

------------------------------------------------------------------------------
-- 2. Schedule the send job inside Supabase (pg_cron + pg_net)
------------------------------------------------------------------------------
-- pg_cron fires the schedule; pg_net makes the outbound HTTPS call to the app
-- route, which sends the Stock Report if (a) the feature is enabled, (b) there
-- are recipients, and (c) a send is due for the configured frequency.
--
-- One-time setup — enable the extensions (safe to re-run):
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- Then create/replace the schedule. EDIT the two placeholders below:
--   * the URL host must be your deployed site (e.g. https://aminocan.com)
--   * the Bearer token must equal the app's CRON_SECRET env var
--
-- Runs once a day at 13:00 UTC (~8–9am Eastern). The app decides whether to
-- actually send based on the configured frequency + last-sent time, so change
-- only the hour here if you want a different delivery time. Un-comment and run
-- once (re-running with the same job name first unschedules the old one).
--
-- select cron.unschedule('stock-report-email')
--   where exists (select 1 from cron.job where jobname = 'stock-report-email');
--
-- select cron.schedule(
--   'stock-report-email',
--   '0 13 * * *',
--   $$
--     select net.http_post(
--       url     := 'https://aminocan.com/api/cron/stock-report-email',
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
