# Cluster 10 — Settings & Notification Infrastructure: Code Extraction Guide

> **What this document is.** A file-by-file walkthrough of Cluster 10 so you can extract it
> completely. For each piece: *what to open*, *what it does*, *its intricacies*, and *exactly
> how it touches the database*. Ports **second** (right after Cluster 1) because `site_settings`
> gates checkout/email/shipping behavior and the email infra backs every transactional send
> downstream (Clusters 4, 5, 6, 8).
>
> **Companion deep specs:** `docs/module-ports/11-settings-admin.md` and
> `docs/module-ports/07-email-notifications-infra.md`. This guide is the *map*; those are the *atlas*.

---

## 1. What the cluster is / does

The **global configuration singleton** + the **transactional email layer**.

- **`site_settings`** is a one-row table holding every site-wide knob: checkout mode, admin
  notification emails, invoice CC list + email templates, pickup address, guest-checkout toggle,
  and the entire **Easyship shipping config** (credentials, origin, box, rates, handling fee,
  auto-shipment toggles). It is read by checkout (Cluster 4), invoice email (Cluster 5),
  shipping/auto-shipment (Cluster 6), and low-stock/affiliate flows.
- **Email infrastructure** — two nodemailer/SMTP modules + a merge-var template engine — that
  every cluster calls to send order confirmations, invoices, shipping/fulfillment notices,
  welcome emails, back-in-stock/low-stock alerts, magic links, and affiliate decisions.
- **Email log tables** (`invoice_email_log`, `fulfillment_email_log`) — the send audit trail.
  The *tables and template defaults live here*; the *write callsites* live in Clusters 5 and 6.

**Why it ports second:** almost everything downstream reads `site_settings` or calls an email
sender. Get the singleton + transport working before building the flows that depend on them.

---

## 2. Database schema — what exists and where it comes from

### `site_settings` — the singleton (built up across 5 migrations)
Created by `migration-site-settings.sql`, then `ALTER`ed by four more. **Intricacy:** it's a true
singleton — `CREATE UNIQUE INDEX site_settings_singleton ON site_settings ((true));` plus a
`BEFORE UPDATE` trigger that bumps `updated_at`. RLS: service-role full access only.

| Migration | Columns added |
|-----------|---------------|
| `migration-site-settings.sql` | `id`, `checkout_type` (`'email'|'crypto'`, default `'crypto'`), `admin_emails jsonb`, timestamps, singleton index + trigger + seed row |
| `invoice-email-migration.sql` | `invoice_cc_emails jsonb`, `invoice_customer_email_subject/body`, `invoice_admin_email_subject/body` (+ seeds defaults) |
| `easyship-settings-migration.sql` | `easyship_enabled`, `easyship_api_key`, `shipping_origin jsonb`, `shipping_box jsonb`, `shipping_item_weight_kg`, `shipping_flat_rate` |
| `shipping-handling-fee-migration.sql` | `shipping_handling_fee_type` (`'flat'|'percent'`), `shipping_handling_fee_value` |
| `easyship-auto-shipment-migration.sql` | `easyship_auto_create_shipment`, `easyship_auto_courier_preference` (`cheapest|ups|fedex`), `easyship_auto_buy_label` |

> Also note `pickup_address` and `guest_checkout_enabled` columns exist (referenced by the route);
> they came from `migration-checkout-config.sql`. When porting, reconcile the full column list
> against the `shape()`/PUT body in the settings route (the route is the source of truth).

### Email log tables (owned here, written downstream)
- **`invoice_email_log`** (`invoice-email-migration.sql`) — `invoice_id → invoices ON DELETE
  CASCADE`, `sent_by → customers`, `to_email`, `bcc_emails jsonb`, `subject`, `message_id`,
  `success`, `error`, `created_at`. Also adds `invoices.last_emailed_at/_by/_by_email`. RLS:
  admin/assistant read, admin write. **Written by Cluster 5** (`/api/admin/invoices/[id]/email`).
- **`fulfillment_email_log`** (`warehouse-emails-orders-migration.sql`) — `invoice_id → invoices`,
  `order_id → orders`, `kind` (`'packed'|'shipped'`), `to_email`, `subject`, `message_id`,
  `success`, `error`, `sent_by`. Also adds `customers.can_send_fulfillment_emails` and
  `invoices.packed_emailed_at/shipped_emailed_at`. RLS: staff read. **Written by Cluster 6**
  (`/api/warehouse/queue/[id]/notify`).

### How the DB is reached
- **Read:** `GET /api/admin/settings` via service-role `getSupabase()`. Public-ish (no auth on GET)
  but the `easyship_api_key` is **never returned** — only a boolean `easyship_api_key_set`.
- **Write:** `PUT /api/admin/settings` — service-role, **admin only** (`assistant` explicitly
  rejected even though `canAccessAdmin` is true).
- Email senders don't read `site_settings` themselves — callers pass `admin_emails`/CC lists in;
  the senders only touch SMTP. The log tables are written via service-role from their routes.

---

## 3. The reading map (open files in this order)

### Tier A — Foundations

**`lib/invoice-email-templates.ts`** — *the merge-var template engine.* (Read in full — small.)
- Exports `DEFAULT_CUSTOMER_SUBJECT/BODY`, `DEFAULT_ADMIN_SUBJECT/BODY` (the same strings seeded by
  the SQL — app falls back to these at render time, so templates work even if columns are NULL).
- `MERGE_VARS` (the 13 supported `{{vars}}` with samples — drives the editor's clickable chips),
  `buildInvoiceMergeVars({invoice, amountPaid, amountDue, customerName, …})` → the value map,
  `renderTemplate(tpl, vars)` (regex `{{ key }}` substitution; unknown keys pass through),
  `plainTextToHtml(body)` (escapes + wraps in a styled `<div>` with `white-space: pre-wrap`).
- **Intricacy:** this is the single source of template truth — the settings route, the
  email-templates editor page, AND the invoice-email send route all import from here.

**`lib/email-smtp.ts`** — *primary transport (direct nodemailer).*
- Lazy `getTransporter()` (SMTP_HOST default `smtp.protonmail.ch:587`), `fromEmail` from
  `SMTP_FROM_NAME/EMAIL`. Senders (each returns `{success, error?, messageId?}` and builds its own
  inline HTML): `sendCustomerInvoiceSMTP`, `sendAdminInvoiceNotificationSMTP`,
  `sendBackInStockNotification`, `sendLowStockAlert`, `sendAffiliateRequestAdminNotification`,
  `sendAffiliateRequestDecision`.

**`lib/email.ts`** — *secondary transport (legacy "Resend" shim → SMTP).*
- **Intricacy worth flagging:** these helpers historically used the Resend SDK, which wasn't
  delivering in production. `getResend()` is now a **thin shim mirroring `resend.emails.send(...)`
  but routing through nodemailer** — so despite the name, **everything sends over SMTP**. Resend is
  effectively dead (env `RESEND_API_KEY`/`EMAIL_FROM` are fallback-only).
- Senders: `sendOrderConfirmation`, `sendShippingNotification`, `sendCustomerWelcome`,
  `sendAffiliateWelcome`, `sendPaymentConfirmed`, `sendAdminPaymentNotification`,
  `sendCustomerInvoice`, `sendAdminInvoiceNotification`, `sendMagicLink`.
- (`lib/admin/magic-link.ts` from Cluster 1 is the *other* email path — it uses Supabase's own
  email, not these transports.)

### Tier B — Settings API

**`app/api/admin/settings/route.ts`** — *the singleton read/write.* (Read carefully — dense.)
- **Column constants** are layered: `BASE_SETTINGS_COLUMNS` + `EASYSHIP_COLUMNS` +
  `HANDLING_FEE_COLUMNS` + `AUTO_SHIPMENT_COLUMNS`. **Key intricacy — `readSettingsRow()` does a
  progressive fallback:** it tries the full column set, then degrades (drop auto-shipment → drop
  handling-fee → drop easyship → base) so a database where an *optional* later migration hasn't run
  **never 500s**. Preserve this when porting if you allow partial migration.
- `shape(data)` is the response normalizer: forces `checkout_type:'email'` (crypto disabled),
  returns `easyship_api_key_set` boolean instead of the key, coerces numbers/enums, fills template
  defaults.
- `GET`: no auth; returns `shape()` (even returns `shape({})` on error so the UI always renders).
- `PUT`: Bearer → `auth.getUser` → `customers.role` → require admin (reject `assistant`).
  Validates each field (`normaliseEmailList` for email arrays, enum/boolean/number guards),
  **only overwrites `easyship_api_key` when a non-empty value is sent** (so saving other settings
  never wipes it; a single space clears it), writes without RETURNING then re-reads via
  `readSettingsRow` (same fallback), responds `{success, settings: shape(fresh)}`. Insert path
  used only if no row exists yet.

### Tier C — Settings UI

**`app/(admin)/admin/settings/page.tsx`** (~1095 lines) — *the settings console.*
- Sections: **Checkout type** selector (now effectively locked to email), **Admin notification
  emails** chip list (add/remove, validated), **Invoice copy (BCC) emails** chip list + link to the
  template editor, **Pickup address**, **Guest checkout** toggle, and the **Easyship** block
  (enable, API key, origin address incl. contact fields, box dims, item weight, flat rate,
  handling fee type/value, and the three **auto-shipment** toggles/courier preference).
- **Intricacy:** mix of **instant auto-save** (toggles/selectors PUT immediately) and **explicit
  save** (text fields). Read-only for `assistant`. Talks only to `/api/admin/settings`.

**`app/(admin)/admin/settings/email-templates/page.tsx`** (~320 lines) — *the template editor.*
- Two tabs (**Customer Email** / **Admin Copy**), each with a subject input + body textarea,
  clickable **`MERGE_VARS` chips** (insert at caret), a **"Reset to default"** link, and a **live
  preview** that runs `renderTemplate` against sample values + shows a mock `📎 INV-1042.pdf`
  attachment. Admin can edit; `assistant` sees read-only. Saves subject/body to `site_settings`
  via PUT. **Imports the same `lib/invoice-email-templates.ts` constants** as the backend.

### Tier D — Email senders in use (where the infra is actually called)

| Sender(s) | Called from | Transport | Notes |
|-----------|-------------|-----------|-------|
| `sendOrderConfirmation` | `app/api/orders/route.ts`, `app/api/email/route.ts` | `lib/email` | crypto order path (mostly legacy) |
| `sendOrderConfirmation`, `sendShippingNotification`, `sendCustomerWelcome`, `sendAffiliateWelcome` | `app/api/email/route.ts` (generic `{type}` dispatcher) | `lib/email` | one POST endpoint switching on `type` |
| `sendCustomerInvoiceSMTP`, `sendAdminInvoiceNotificationSMTP` | `app/api/orders-email/route.ts` | `lib/email-smtp` | **the live e-Transfer checkout** confirmation+admin-notify |
| `sendPaymentConfirmed`, `sendAdminPaymentNotification` | `app/api/orders/check-payment/route.ts`, `app/api/cron/check-payments/route.ts` | `lib/email` | payment confirmation |
| `sendBackInStockNotification` | `app/api/admin/products/[id]/route.ts` | `lib/email-smtp` | Cluster 2 restock |
| `sendLowStockAlert` | `lib/admin/low-stock.ts` | `lib/email-smtp` | Cluster 2 threshold alert |
| `sendAffiliateRequestAdminNotification` | `app/api/affiliate-requests/route.ts` | `lib/email-smtp` | Cluster 8 |
| `sendAffiliateRequestDecision` | `app/api/admin/affiliate-requests/[id]/route.ts` | `lib/email-smtp` | Cluster 8 |
| `sendMagicLink` (lib/email) / `sendSupabaseMagicLink` (lib/admin/magic-link) | Cluster 1 | SMTP / Supabase | two different mechanisms |

**`app/api/email/route.ts`** — generic POST dispatcher: `{type, ...data}` → switch over
`order_confirmation | shipping_notification | customer_welcome | affiliate_welcome`. The simplest
file to read to see the sender contract.

### Tier E — Log tables (the audit trail; reads/writes live downstream)
- `invoice_email_log` written by `app/api/admin/invoices/[id]/email/route.ts` (Cluster 5) — it
  builds vars with `buildInvoiceMergeVars`, renders the stored template, sends, then inserts a log
  row + updates `invoices.last_emailed_*`. Reads `site_settings.invoice_cc_emails` for BCC.
- `fulfillment_email_log` written by `app/api/warehouse/queue/[id]/notify/route.ts` (Cluster 6),
  gated by `customers.can_send_fulfillment_emails`.

---

## 4. End-to-end flows to trace

1. **Save a setting:** settings page (toggle auto-saves / text field explicit save) → `PUT
   /api/admin/settings` → admin check → per-field validation → service-role update (api key
   preserved unless non-empty) → re-read via fallback → `shape()` back to UI.
2. **Live checkout email:** `/api/orders-email` → `sendCustomerInvoiceSMTP` (+ admin copy via
   `sendAdminInvoiceNotificationSMTP`, recipients from `site_settings.admin_emails`). All SMTP.
3. **Admin invoice email (template-driven, Cluster 5 using Cluster 10 infra):** load
   `site_settings` templates → `buildInvoiceMergeVars` → `renderTemplate` → `plainTextToHtml` →
   send with PDF + BCC (`invoice_cc_emails`) → insert `invoice_email_log` + set
   `invoices.last_emailed_*`.
4. **Low-stock / back-in-stock:** Cluster 2 calls `sendLowStockAlert` / `sendBackInStockNotification`
   (SMTP) using admin emails from settings.

---

## 5. Extraction checklist & gotchas

- [ ] Create `site_settings` with the **singleton unique index + updated_at trigger**, run all 5
      `ALTER` migrations, seed the one row. Reconcile the full column list against the settings
      route's `shape()`/PUT body (route is source of truth; includes `pickup_address`,
      `guest_checkout_enabled` from `migration-checkout-config.sql`).
- [ ] Keep the **progressive column fallback** in `readSettingsRow` if you support partial
      migration; otherwise simplify to one select.
- [ ] **Never return `easyship_api_key`** — expose only `easyship_api_key_set`. Only overwrite it on
      a non-empty PUT value.
- [ ] `PUT` is **admin-only** (reject `assistant`); `GET` is unauthenticated by design.
- [ ] `checkout_type` is **forced to `'email'`** (crypto disabled). Decide whether the target
      re-enables crypto.
- [ ] Both email modules send over **SMTP/nodemailer**; `lib/email.ts`'s "Resend" is a shim. Set
      `SMTP_*` env; `RESEND_API_KEY`/`EMAIL_FROM` are fallback-only.
- [ ] Template defaults exist in **two places** (SQL seed + `lib/invoice-email-templates.ts`) and the
      app falls back at render time — keep both in sync or rely on the code default.
- [ ] The two log tables are **owned here but written by Clusters 5/6** — port the tables + RLS now,
      wire the writes when you port those clusters.
- [ ] Magic-link email is a **separate path** (Cluster 1, Supabase-sent) — not these transports.

---

## 6. File index (everything in Cluster 10)

```
DB        migration-site-settings.sql, migration-checkout-config.sql,
          invoice-email-migration.sql, easyship-settings-migration.sql,
          shipping-handling-fee-migration.sql, easyship-auto-shipment-migration.sql,
          warehouse-emails-orders-migration.sql (email-log + can_send flag portions)
libs      lib/invoice-email-templates.ts, lib/email-smtp.ts, lib/email.ts
API       app/api/admin/settings/route.ts, app/api/email/route.ts
UI        app/(admin)/admin/settings/page.tsx,
          app/(admin)/admin/settings/email-templates/page.tsx
log tables invoice_email_log (written by Cluster 5), fulfillment_email_log (written by Cluster 6)
docs      docs/module-ports/11-settings-admin.md, 07-email-notifications-infra.md;
          ADMIN-SETTINGS-IMPLEMENTATION.md, CHECKOUT_CONFIGURATION.md, MAGIC-LINK-SETUP.md
```

**Env vars:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME`,
`SMTP_FROM_EMAIL` (primary); `RESEND_API_KEY`, `EMAIL_FROM` (fallback only);
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (settings route);
`EASYSHIP_API_KEY` + `SHIP_*` (env defaults; admin settings take precedence — see Cluster 6).
**Dashboard:** SMTP creds for Supabase's own magic-link emails (Cluster 1).
```
