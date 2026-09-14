# Automatic e-Transfer Invoice Email With Configurable Delay

**Date:** July 4, 2026
**Type:** Feature Addition
**Status:** Completed ✅

---

## Overview

The customer Interac e-Transfer invoice email — the one sent for every email
checkout order — now sends **automatically on a store-wide delay** measured
from when the order is placed. The delay is a single default configured in
**admin/settings**, and defaults to **instant (0 minutes)**, which preserves the
previous behaviour (the email went out immediately at checkout).

Set the delay to a positive number of minutes and the email is instead flushed
by a scheduled job once it comes due — useful for batching or for giving staff a
short window before the customer is emailed.

---

## What Changed

### 1. Settings — new default delay
**Files:** `app/(admin)/admin/settings/page.tsx`,
`app/api/admin/settings/route.ts`, `etransfer-email-automation-migration.sql`

- New **E-Transfer Email Timing** card in Site Settings: a minutes input
  (0–10080; 0 = instant) with inline validation and a live "Currently: …"
  summary.
- New `site_settings.etransfer_email_delay_minutes` column (INTEGER, default 0),
  wired through the settings GET/PUT API with validation and the existing
  progressive-column fallback.

### 2. Order API — schedule the send
**File:** `app/api/orders-email/route.ts`

- Reads the configured delay and stamps every new order with
  `etransfer_email_send_after = created_at + delay` (and `etransfer_email_sent_at
  = NULL`).
- If the delay is 0 (instant), the customer e-Transfer email is sent right away
  in the post-response `after()` hook, as before. If the delay is positive, the
  send is left for the cron.
- The **admin** notification still goes out immediately regardless of the delay.
- Pickup orders now retain the customer's name on the stored address so a later
  (delayed) email can still address them by name.

### 3. Shared send helper
**File:** `lib/etransfer-email.ts` (new)

- `buildCustomerInvoiceArgs()` reconstructs the exact `sendCustomerInvoiceSMTP`
  arguments from a stored order row (totals recovered the same way checkout
  derived them), so the instant path and the delayed cron path produce identical
  emails.
- `claimAndSendEtransferEmail()` sends exactly once: it optimistically claims the
  send by stamping `etransfer_email_sent_at` only where still NULL (so two
  overlapping runs can't double-send), then releases the claim if the email
  fails so a later run retries.

### 4. Flush job (cron)
**Files:** `app/api/cron/send-etransfer-emails/route.ts` (new),
`etransfer-email-automation-migration.sql`

- New `CRON_SECRET`-guarded route that finds due, unsent email-checkout orders
  (`etransfer_email_send_after <= now`, `etransfer_email_sent_at IS NULL`) and
  sends each via the shared helper. Doubles as a retry path for any instant send
  that failed.
- Scheduled inside Supabase via `pg_cron` + `pg_net` every minute (same pattern
  as the inactive-customer job); no external cron needed.

---

## Database Migration

Run `etransfer-email-automation-migration.sql` in the Supabase SQL editor. It:

1. Adds `site_settings.etransfer_email_delay_minutes` (default 0).
2. Adds `orders.etransfer_email_send_after` / `orders.etransfer_email_sent_at`
   plus a partial index on the unsent queue.
3. Documents the `pg_cron` schedule for `/api/cron/send-etransfer-emails`
   (edit the site host + `CRON_SECRET`, then run the `cron.schedule` block).

Backwards compatible: until the migration runs, the order API falls back to an
instant send, and the settings API omits the new column via its column
fallback.

---

**Status:** ✅ Ready
