-- Fulfillment queue: "expired" (aged) threshold
-- =====================================================================
-- Run this in the Supabase SQL editor.
--
-- The fulfillment queue can hide older ("expired") queue cards by default and
-- reveal them behind a "Show expired" toggle. "Expired" here just means aged —
-- often an invoice whose feature/queue entry was created well after the order,
-- so it reads as an old straggler rather than fresh work. This is a way to
-- segregate the old ones, not a hard status.
--
-- Adds:
--   site_settings.fulfillment_expired_days — a queue card is considered
--   "expired" once it is at least this many days old (by created_at).
--   Defaults to 3.

ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS fulfillment_expired_days INTEGER NOT NULL DEFAULT 3;

COMMENT ON COLUMN site_settings.fulfillment_expired_days IS
  'Fulfillment queue: a queue card is treated as "expired" (aged) once it is at least this many days old. Hidden by default in the warehouse queue; revealed with the "Show expired" toggle.';
