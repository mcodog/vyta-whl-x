-- PuraMass / Stealth Health — raw webhook event log
-- =====================================================================
-- Run this in the Supabase SQL editor (after the other puramass migrations).
--
-- Records EVERY POST the Stealth Health webhook endpoint
-- (/api/webhooks/stealth-health) receives — including deliveries with an
-- invalid signature and events that don't match a local order — so you can
-- confirm whether Stealth Health is actually hitting the URL, and debug why an
-- event wasn't applied. This is an append-only diagnostic log; it does not
-- affect order processing (writes to it are best-effort).

CREATE TABLE IF NOT EXISTS puramass_webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Parsed from the payload (best effort; may be NULL on garbage/unsigned hits).
  event_id          TEXT,
  event_type        TEXT,
  transaction_id    TEXT,
  partner_reference TEXT,
  status            TEXT,
  -- Whether the X-Stealth-Signature HMAC verified against PURAMASS_WEBHOOK_SECRET.
  signature_valid   BOOLEAN NOT NULL DEFAULT false,
  -- Whether the event matched a local puramass_orders row.
  matched           BOOLEAN,
  -- What the endpoint did with it: processed | duplicate | ignored | unmatched |
  -- invalid_signature | not_configured | invalid_json | error.
  outcome           TEXT NOT NULL,
  http_status       INTEGER,
  puramass_order_id UUID REFERENCES puramass_orders(id) ON DELETE SET NULL,
  -- The parsed JSON payload, and the raw body (truncated) for unparseable hits.
  payload           JSONB,
  raw_body          TEXT,
  -- The signature header value (a hash, not the secret) + any error detail.
  signature         TEXT,
  error             TEXT
);

CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_received
  ON puramass_webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_event_id
  ON puramass_webhook_events (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_txn
  ON puramass_webhook_events (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_webhook_events_outcome
  ON puramass_webhook_events (outcome);

COMMENT ON TABLE puramass_webhook_events IS
  'Append-only log of every Stealth Health webhook delivery (incl. invalid-signature / unmatched). Diagnostic only; safe to prune old rows.';

ALTER TABLE puramass_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON puramass_webhook_events;
CREATE POLICY "Service role full access" ON puramass_webhook_events
  FOR ALL USING (true) WITH CHECK (true);
