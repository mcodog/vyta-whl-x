-- E-Transfer email automation
-- =====================================================================
-- Run this in the Supabase SQL editor.
--
-- Makes the customer Interac e-Transfer invoice email an automatic, delayed
-- send after an order is placed. The delay (in minutes) is a store-wide default
-- configured in admin/settings; 0 = send instantly (the default, and the
-- behaviour before this migration).
--
-- Adds:
--   1. site_settings.etransfer_email_delay_minutes — the default delay.
--   2. orders.etransfer_email_send_after / etransfer_email_sent_at — per-order
--      scheduling + idempotency for the sending job.
--   3. A Supabase-native schedule (pg_cron + pg_net) that calls the app's
--      /api/cron/send-etransfer-emails route every minute to flush any due
--      (delayed) emails — no external cron needed.

------------------------------------------------------------------------------
-- 1. Default delay (singleton site_settings row)
------------------------------------------------------------------------------
ALTER TABLE site_settings
  -- Minutes to wait after an order is placed before the customer e-Transfer
  -- invoice email is sent. 0 = instant.
  ADD COLUMN IF NOT EXISTS etransfer_email_delay_minutes INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN site_settings.etransfer_email_delay_minutes IS
  'Default minutes to delay the customer Interac e-Transfer invoice email after an order is placed. 0 = instant.';

------------------------------------------------------------------------------
-- 2. Per-order scheduling + sent marker
------------------------------------------------------------------------------
ALTER TABLE orders
  -- When the customer e-Transfer invoice email becomes due (created_at + delay).
  ADD COLUMN IF NOT EXISTS etransfer_email_send_after TIMESTAMPTZ,
  -- When it was actually sent. NULL = still pending / not yet sent.
  ADD COLUMN IF NOT EXISTS etransfer_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.etransfer_email_send_after IS
  'When the customer e-Transfer invoice email is due to send (created_at + configured delay).';
COMMENT ON COLUMN orders.etransfer_email_sent_at IS
  'When the customer e-Transfer invoice email was sent. NULL = still pending.';

-- Index the queue the cron scans: due + unsent.
CREATE INDEX IF NOT EXISTS idx_orders_etransfer_email_due
  ON orders (etransfer_email_send_after)
  WHERE etransfer_email_sent_at IS NULL;

------------------------------------------------------------------------------
-- 3. Schedule the flush job inside Supabase (pg_cron + pg_net)
------------------------------------------------------------------------------
-- pg_cron fires the schedule; pg_net makes the outbound HTTPS call to the app
-- route, which sends any due (delayed) e-Transfer emails. Instant (0-minute)
-- orders are sent by the order API itself; this job is the safety net for
-- delayed sends and for retrying any instant send that failed.
--
-- One-time setup — enable the extensions (safe to re-run):
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- Then create/replace the schedule. EDIT the two placeholders below:
--   * the URL host must be your deployed site (e.g. https://aminocan.com)
--   * the Bearer token must equal the app's CRON_SECRET env var
--
-- Runs every minute. Un-comment and run once (re-running with the same job
-- name first unschedules the old one).
--
-- select cron.unschedule('send-etransfer-emails')
--   where exists (select 1 from cron.job where jobname = 'send-etransfer-emails');
--
-- select cron.schedule(
--   'send-etransfer-emails',
--   '* * * * *',
--   $$
--     select net.http_post(
--       url     := 'https://aminocan.com/api/cron/send-etransfer-emails',
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
