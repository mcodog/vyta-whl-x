# Global Config Singleton + Transactional Email Layer — Build Spec

> Definitive spec for rebuilding this feature cluster in a Next.js + Supabase codebase.
> Generated from: `lib/invoice-email-templates.ts`, `lib/email-smtp.ts`, `lib/email.ts`,
> `app/api/admin/settings/route.ts`, `app/(admin)/admin/settings/page.tsx`,
> `app/(admin)/admin/settings/email-templates/page.tsx`, the 5 `site_settings` migrations,
> and the two email-log migrations, plus the downstream sender call-sites.
> Stack: **Next.js 15 App Router** + **Supabase** (`@supabase/supabase-js` v2) +
> **nodemailer** (SMTP) + **Tailwind** (custom theme) + **lucide-react**.
>
> Describes the code **as it exists**. This cluster is foundational: almost everything
> downstream reads `site_settings` (via `GET /api/admin/settings`) or calls one of the
> email senders. Port it **second**, right after the auth/RBAC cluster.

---

## 1. Overview

Two concerns live together here:

1. **The global config singleton — `site_settings`.** A true one-row table
   (`UNIQUE INDEX … ((true))` + an `updated_at` trigger) built up across **5 migrations**:
   base/checkout config → invoice email templates + CC list → Easyship config → handling
   fee → auto-shipment toggles. It holds checkout mode, admin notification emails, pickup
   address, guest-checkout toggle, invoice email templates + BCC list, and the full
   Easyship/shipping/auto-shipment configuration. Read by storefront checkout, the admin
   settings UI, the shipping layer, and every email sender that needs admin recipients.

2. **The transactional email layer.** Three foundation modules:
   `invoice-email-templates.ts` (merge-var engine + default templates),
   `email-smtp.ts` (primary nodemailer transport + a set of hand-built HTML senders), and
   `email.ts` (the legacy "Resend" module — now a **shim** that mirrors the Resend SDK call
   shape but routes through the same SMTP transport). Two API routes build their own inline
   transport and use the template engine: the invoice-send route (Cluster 5) and the
   warehouse fulfillment-notify route (Cluster 6) — they own the **two email-log tables**
   defined here (`invoice_email_log`, `fulfillment_email_log`) but write them downstream.

The settings UI is the admin **Site Settings** page plus a dedicated **invoice email
template editor** with live merge-var preview.

---

## 2. Database schema

### `site_settings` — the singleton (live DDL, verbatim)

```sql
create table public.site_settings (
  id uuid not null default gen_random_uuid (),
  checkout_type text not null default 'crypto'::text,
  admin_emails jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  pickup_address text null default ''::text,
  guest_checkout_enabled boolean null default true,
  invoice_cc_emails jsonb not null default '[]'::jsonb,
  invoice_customer_email_subject text null,
  invoice_customer_email_body text null,
  invoice_admin_email_subject text null,
  invoice_admin_email_body text null,
  easyship_enabled boolean null default false,
  easyship_api_key text null default ''::text,
  shipping_origin jsonb null default '{}'::jsonb,
  shipping_box jsonb null default '{}'::jsonb,
  shipping_item_weight_kg numeric null default 0.05,
  shipping_flat_rate numeric null default 20,
  shipping_handling_fee_type text null default 'flat'::text,
  shipping_handling_fee_value numeric null default 0,
  easyship_auto_create_shipment boolean null default false,
  easyship_auto_courier_preference text null default 'cheapest'::text,
  easyship_auto_buy_label boolean null default false,
  constraint site_settings_pkey primary key (id),
  constraint site_settings_checkout_type_check check (
    (checkout_type = any (array['email'::text, 'crypto'::text]))
  )
) TABLESPACE pg_default;

-- The singleton guarantee: a unique index on a constant expression means at most one row.
create unique INDEX IF not exists site_settings_singleton
  on public.site_settings using btree ((true)) TABLESPACE pg_default;

create trigger site_settings_updated_at BEFORE update on site_settings
  for EACH row execute FUNCTION update_site_settings_updated_at ();
```

`update_site_settings_updated_at()` (from `migration-site-settings.sql`) simply sets
`NEW.updated_at = now()` before each UPDATE.

> **Note:** the live table defaults `checkout_type` to `'crypto'`, but the application
> **force-coerces it to `'email'` everywhere** (crypto is disabled site-wide — see §5). The
> live singleton row's `checkout_type` is `'email'`.

#### Migration order (each `ALTER TABLE … ADD COLUMN IF NOT EXISTS`)

| # | File | Adds to `site_settings` |
|---|---|---|
| 1 | `migration-site-settings.sql` | Creates the table (`id`, `checkout_type` CHECK `('email','crypto')`, `admin_emails`, timestamps), the **singleton unique index**, the `updated_at` trigger+function, RLS (`Service role full access` `USING(true) WITH CHECK(true)`), and seeds one row `('email', '["codogmjo@gmail.com"]')`. |
| 2 | `migration-checkout-config.sql` | `pickup_address text DEFAULT ''`, `guest_checkout_enabled boolean DEFAULT true`. (Also adds `allow_pickup`/`allow_shipping` to `customers` — owned by the customers cluster.) |
| 3 | `invoice-email-migration.sql` | `invoice_cc_emails jsonb DEFAULT '[]'`, `invoice_customer_email_subject/body`, `invoice_admin_email_subject/body`; **seeds default templates** via `UPDATE … COALESCE(...)`. Also adds `last_emailed_at/by/by_email` to `invoices` and creates `invoice_email_log` (below). |
| 4 | `easyship-settings-migration.sql` | `easyship_enabled bool`, `easyship_api_key text DEFAULT ''`, `shipping_origin jsonb`, `shipping_box jsonb`, `shipping_item_weight_kg numeric DEFAULT 0.05`, `shipping_flat_rate numeric DEFAULT 20`. (Also adds tracking columns to `orders`.) |
| 5a | `shipping-handling-fee-migration.sql` | `shipping_handling_fee_type text DEFAULT 'flat'`, `shipping_handling_fee_value numeric DEFAULT 0`. |
| 5b | `easyship-auto-shipment-migration.sql` | `easyship_auto_create_shipment bool`, `easyship_auto_courier_preference text DEFAULT 'cheapest'`, `easyship_auto_buy_label bool`. (Also adds `auto_shipment_*` to `orders` + a `shipment_auto_logs` table — shipping cluster.) |

#### Column groups (mirror the API's progressive fallback — §5)

- **BASE:** `checkout_type, admin_emails, pickup_address, guest_checkout_enabled, invoice_cc_emails, invoice_customer_email_subject, invoice_customer_email_body, invoice_admin_email_subject, invoice_admin_email_body`
- **EASYSHIP:** `easyship_enabled, easyship_api_key, shipping_origin, shipping_box, shipping_item_weight_kg, shipping_flat_rate`
- **HANDLING_FEE:** `shipping_handling_fee_type, shipping_handling_fee_value`
- **AUTO_SHIPMENT:** `easyship_auto_create_shipment, easyship_auto_courier_preference, easyship_auto_buy_label`

`shipping_origin` shape: `{ line_1, city, state, postal_code, country_alpha2, company_name, contact_name, contact_email, contact_phone }`. `shipping_box` shape: `{ length, width, height }` (cm).

The `SiteSettings` TS interface in `lib/supabase.ts` describes the BASE subset; the settings
page declares a fuller local interface (including all Easyship fields + `easyship_api_key_set`).

### `invoice_email_log` (`invoice-email-migration.sql`) — owned here, written by Cluster 5

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `invoice_id` | `uuid` | `NOT NULL` FK → `invoices(id) ON DELETE CASCADE` |
| `sent_by` | `uuid` | FK → `customers(id) ON DELETE SET NULL` |
| `sent_by_email` | `text` | |
| `to_email` | `text` | `NOT NULL` |
| `bcc_emails` | `jsonb` | `NOT NULL DEFAULT '[]'` |
| `subject` | `text` | `NOT NULL` |
| `message_id` | `text` | nodemailer message id |
| `success` | `boolean` | `NOT NULL` |
| `error` | `text` | |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

Index `idx_invoice_email_log_invoice_id (invoice_id, created_at DESC)`. RLS: read for
`admin`/`assistant`; write (`FOR ALL`) for `admin` only.

### `fulfillment_email_log` (`warehouse-emails-orders-migration.sql`) — owned here, written by Cluster 6

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `invoice_id` | `uuid` | FK → `invoices(id) ON DELETE CASCADE` |
| `order_id` | `uuid` | FK → `orders(id) ON DELETE SET NULL` |
| `kind` | `text` | `NOT NULL CHECK (kind IN ('packed','shipped'))` |
| `to_email` | `text` | `NOT NULL` |
| `subject` / `message_id` / `error` | `text` | |
| `success` | `boolean` | `NOT NULL DEFAULT false` |
| `sent_by` | `uuid` | FK → `customers(id) ON DELETE SET NULL` |
| `sent_by_email` | `text` | |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

Index `idx_fulfillment_email_log_invoice (invoice_id, created_at DESC)`. RLS: SELECT for
`admin`/`assistant`/`warehouse`. (Same migration also adds `can_send_fulfillment_emails` to
`customers` and `packed_emailed_at`/`shipped_emailed_at` to `invoices`.)

> **Port both log tables + RLS now; wire the writes later** (they belong to the invoice and
> fulfillment clusters). No app code in *this* cluster writes them.

### Schema usage map

| Table.column(s) | Read by | Written by |
|---|---|---|
| `site_settings.*` | `GET /api/admin/settings` (→ shape), settings UI, `lib/shipping/*`, `lib/admin/low-stock.ts`, checkout, orders-email route | `PUT /api/admin/settings` only |
| `site_settings.admin_emails` | every admin-notification sender (order/low-stock/affiliate-request) | settings page |
| `site_settings.invoice_*` templates + `invoice_cc_emails` | invoice email route (Cluster 5), template editor | settings page / template editor |
| `site_settings.easyship_*` / `shipping_*` | shipping layer + checkout | settings page (shipping section) |
| `invoice_email_log` | (RLS admin read; no UI here) | `POST /api/admin/invoices/[id]/email` (Cluster 5) |
| `fulfillment_email_log` | (RLS staff read) | `POST /api/warehouse/queue/[id]/notify` (Cluster 6) |

---

## 3. Components

### Tier A — Foundations

#### `lib/invoice-email-templates.ts` — merge-var engine + defaults
- **Default templates** (exported consts; identical to the SQL seed):
  `DEFAULT_CUSTOMER_SUBJECT` = `Your Aminocan invoice {{invoice_number}}`;
  `DEFAULT_CUSTOMER_BODY` (greeting + PDF/total/due line + sign-off);
  `DEFAULT_ADMIN_SUBJECT` = `[Copy] Invoice {{invoice_number}} sent to {{customer_email}}`;
  `DEFAULT_ADMIN_BODY` (totals block + `Sent by`).
- `MERGE_VARS: MergeVarSpec[]` — 13 vars, each `{ name, description, sample }`:
  `customer_name`, `customer_first_name`, `customer_last_name`, `customer_email`,
  `invoice_number`, `invoice_total`, `amount_due`, `amount_paid`, `due_date`, `issue_date`,
  `currency`, `sent_by_email`, `company_name`.
- `buildInvoiceMergeVars({ invoice, amountPaid, amountDue, customerName, customerEmail,
  sentByEmail, currency='CAD', companyName='Aminocan' })` → `Record<string,string>`. Splits
  `customerName` into first/last; formats totals with `.toFixed(2)`; formats `due_date`/
  `issue_date` via `toLocaleDateString(undefined, {year:'numeric',month:'long',day:'numeric'})`.
- `renderTemplate(tpl, vars)` — replaces `{{ var }}` (regex `/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi`);
  **unknown vars are left intact** as `{{key}}` (graceful fallback, not blanked).
- `escapeHtml(s)` and `plainTextToHtml(body)` — wraps escaped text in a `<div>` with inline
  styles `font-family: -apple-system…; font-size:14px; line-height:1.55; color:#07203A;
  white-space:pre-wrap;` (so plain-text templates render as HTML email with preserved newlines).

#### `lib/email-smtp.ts` — primary SMTP transport + hand-built senders
- Lazy singleton `getTransporter()` → `nodemailer.createTransport({ host: SMTP_HOST ||
  'smtp.protonmail.ch', port: SMTP_PORT || 587, secure:false, auth:{ user: SMTP_USER ||
  'noreply@aminocan.com', pass: SMTP_PASSWORD } })`.
- `fromEmail` = `${SMTP_FROM_NAME||'Aminocan'} <${SMTP_FROM_EMAIL||'noreply@aminocan.com'}>`.
- Exports (each builds a full inline-styled HTML email and returns `{success, id?|message?, error?}`):
  - `sendCustomerInvoiceSMTP(...)` — e-Transfer invoice to customer (items table, totals,
    pickup vs ship address, optional referral badge). Subject `Invoice {orderNumber} - VYTA Biosciences`.
  - `sendAdminInvoiceNotificationSMTP({ adminEmails, ... })` — new-order notification; sends
    to **all** admin emails via `Promise.allSettled`; succeeds if ≥1 send succeeds. Subject
    `New Order {orderNumber} - ${total} {currency}`.
  - `sendBackInStockNotification(...)` — watchlist restock email.
  - `sendLowStockAlert({ adminEmails, ... })` — fan-out to all admin emails; out-vs-low color.
  - `sendAffiliateRequestAdminNotification(...)`, `sendAffiliateRequestDecision({approved})`.
- All emails share the brand styling: `VYTA` wordmark, vital eyebrow `#438B9E`,
  `#07203A` text, `#F7FAFB`/`#DCE7EB` cards, `#07203A` CTA buttons, `${baseUrl}` from
  `NEXT_PUBLIC_BASE_URL || 'https://aminocan.com'`.

#### `lib/email.ts` — the legacy "Resend" module (now an SMTP shim)
- **Intricacy:** historically used the Resend SDK, which wasn't delivering in production.
  `getResend()` now returns a **thin shim** exposing `emails.send({from,to,subject,html})`
  that mirrors the Resend return shape `{ data:{id}|null, error:{message}|null }` but
  routes through its **own** lazy nodemailer transport (same `smtp.protonmail.ch:587`
  config as `email-smtp.ts`, auth from `SMTP_USER`/`SMTP_PASSWORD`). **Everything sends over
  SMTP; `RESEND_API_KEY` is not used here** (Resend is fallback/legacy only).
- `fromEmail` prefers `SMTP_FROM_EMAIL` (with `SMTP_FROM_NAME`), falling back to `EMAIL_FROM`,
  then `'Aminocan <orders@aminocan.com>'`.
- Exports (all call `getResend().emails.send(...)`): `sendOrderConfirmation`,
  `sendShippingNotification`, `sendCustomerWelcome`, `sendAffiliateWelcome`,
  `sendPaymentConfirmed`, `sendAdminPaymentNotification`, `sendCustomerInvoice`,
  `sendAdminInvoiceNotification`, `sendMagicLink`. (See §7 for the unused ones.)

### Tier B — Settings API: `app/api/admin/settings/route.ts`

Service-role client (`createClient(url, SERVICE_ROLE_KEY)` for auth checks; `getSupabase()`
for the row I/O).

- **`shape(data)`** — normalizes a raw row into the public response. Key transforms:
  - `checkout_type` **always returned as `'email'`** (crypto disabled).
  - `easyship_api_key` is **never returned**; instead `easyship_api_key_set: Boolean(data.easyship_api_key)`.
  - Defaults applied for every field; template fields fall back to the TS `DEFAULT_*` consts;
    numeric fields coerced; `shipping_handling_fee_type` normalized to `'flat'|'percent'`;
    `easyship_auto_courier_preference` normalized to `'cheapest'|'ups'|'fedex'`.
- **`readSettingsRow(db)`** — **progressive column fallback**: tries the full column set, then
  `BASE+EASYSHIP+HANDLING_FEE`, then `BASE+EASYSHIP`, then `BASE`, returning the first that
  succeeds. So a partially-migrated DB never 500s. Used by both GET and the PUT re-read.
- **`GET()`** — **unauthenticated by design**. Reads via `readSettingsRow`; on error returns
  `shape({})` (all defaults) rather than erroring; wraps in try/catch → 500 only on a thrown
  exception. Returns the shaped object directly (not wrapped).
- **`PUT(req)`** — requires `Authorization: Bearer <token>`; resolves the caller's role from
  `customers`. **Rejects unless `canAccessAdmin(role) && role !== 'assistant'`** → i.e.
  **admin (and affiliate by `canAccessAdmin`) may write, assistant is explicitly blocked**
  with `403 'Admin access required'`. Validates and whitelists each field:
  - `checkout_type` → coerced to `'email'`.
  - `admin_emails` / `invoice_cc_emails` → `normaliseEmailList` (must be string array; each
    trimmed; regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`; 400 on bad entry).
  - `guest_checkout_enabled`, `easyship_enabled`, `easyship_auto_create_shipment`,
    `easyship_auto_buy_label` → must be boolean.
  - Template fields → must be strings.
  - **`easyship_api_key` → only written when a non-empty string is supplied** (so saving
    other settings never wipes it; "send a single space to intentionally clear").
  - `shipping_origin`/`shipping_box` → re-built from a fixed key set (string/number coercion).
  - `shipping_handling_fee_type` ∈ `{flat,percent}`; `easyship_auto_courier_preference` ∈
    `{cheapest,ups,fedex}`; numeric fields must be finite ≥ 0.
  - Write path: if a row exists → `UPDATE … WHERE id` (no RETURNING), then re-read with the
    progressive fallback; else `INSERT` a fully-defaulted row. Returns
    `{ success:true, settings: shape(fresh) }`.

### Tier C — Settings UI

#### `app/(admin)/admin/settings/page.tsx` — **Client**
- `useUserRole()`; `isReadOnly = role === 'assistant'` (disables every control & shows
  "You have read-only access" on save attempts).
- `fetchSettings()` → `GET /api/admin/settings` (no auth header). `saveSettings(updates)` →
  `PUT` with bearer token; most controls **auto-save on change** (checkout type, guest
  toggle, easyship toggles, courier select, add/remove email) — there's no single Save for
  those; the shipping section and pickup address have explicit Save buttons.
- Sections (each a `bg-white rounded-xl border border-line p-5 sm:p-6` card):
  1. **Checkout Type** — two big radio-cards; **Email Invoice** selectable, **Cryptocurrency**
     permanently disabled (greyed, `Disabled` pill, `aria-disabled`).
  2. **Admin Email Notifications** — add/remove chips (`admin_emails`); client-side email
     regex + duplicate guard; empty state copy.
  3. **Invoice Emails** — BCC list (`invoice_cc_emails`) add/remove + a full-width link to
     the template editor (`/admin/settings/email-templates`).
  4. **Pickup Address** — single input + Save.
  5. **Guest Checkout** — Enabled/Disabled radio-cards.
  6. **Shipping (Easyship)** — Live-rates/Flat-rate toggle; password API-key input (placeholder
     reflects `easyship_api_key_set`, helper "Leave blank to keep the current token");
     origin address; sender contact; default parcel (L/W/H cm) + weight/flat-rate; handling-fee
     type+value; one **Save shipping settings** button (`handleSaveShipping` only includes the
     API key in the payload when the input is non-empty).
  7. **Automatic shipments** — auto-create toggle, courier `<select>`, auto-buy-label toggle.
  8. **Info box** (blue) — reiterates crypto-disabled / SMTP required / auto-buy charges note.
- Selected radio-cards: `border-vital bg-vital/5` with a `bg-vital` check dot; unselected
  `border-line bg-white hover:border-ink/20`.

#### `app/(admin)/admin/settings/email-templates/page.tsx` — **Client**
- `isReadOnly = role !== 'admin'` (**stricter than the settings page** — only admin can edit
  templates; assistant/affiliate are read-only).
- Loads current templates from `GET /api/admin/settings` (falling back to `DEFAULT_*`). Tabs:
  **Customer email** / **Admin copy**. Editor has Subject input (`#tpl-subject`) + Body
  textarea (`#tpl-body`, `font-mono`, 16 rows), a **Reset to default** button per tab, and a
  row of clickable **merge-var chips** (`insertVar` inserts `{{name}}` at the cursor).
- **Live preview** pane renders `renderTemplate(subject/body, sampleVars)` (sample values from
  `MERGE_VARS`), styled as an email with a `📎 INV-1042.pdf (attached)` footer.
- **Save** → `PUT /api/admin/settings` with all four template fields.

### Tier D — Sender call-site map (sender → route → transport)

| Sender | Module / transport | Called by (route/file) |
|---|---|---|
| `sendCustomerInvoiceSMTP`, `sendAdminInvoiceNotificationSMTP` | `email-smtp.ts` (SMTP) | `app/api/orders-email/route.ts` |
| `sendOrderConfirmation` | `email.ts` (shim→SMTP) | `app/api/orders/route.ts`, `app/api/email/route.ts` |
| `sendShippingNotification`, `sendCustomerWelcome`, `sendAffiliateWelcome` | `email.ts` (shim→SMTP) | `app/api/email/route.ts` |
| `sendPaymentConfirmed`, `sendAdminPaymentNotification` | `email.ts` (shim→SMTP) | `app/api/orders/check-payment/route.ts`, `app/api/cron/check-payments/route.ts` |
| `sendBackInStockNotification` | `email-smtp.ts` (SMTP) | `app/api/admin/products/[id]/route.ts` |
| `sendLowStockAlert` | `email-smtp.ts` (SMTP) | `lib/admin/low-stock.ts` |
| `sendAffiliateRequestAdminNotification` | `email-smtp.ts` (SMTP) | `app/api/affiliate-requests/route.ts` |
| `sendAffiliateRequestDecision` | `email-smtp.ts` (SMTP) | `app/api/admin/affiliate-requests/[id]/route.ts` |
| *(inline transport + template engine)* | nodemailer built in-route | `app/api/admin/invoices/[id]/email/route.ts` → writes `invoice_email_log` (Cluster 5) |
| *(inline transport + `plainTextToHtml`)* | nodemailer built in-route | `app/api/warehouse/queue/[id]/notify/route.ts` → writes `fulfillment_email_log` (Cluster 6) |

> **Every path ultimately sends over the same SMTP transport** (`smtp.protonmail.ch:587` by
> default). The two log-writing routes don't use the `email-smtp.ts`/`email.ts` senders — they
> construct their own `nodemailer` transport inline, render with `buildInvoiceMergeVars` +
> `renderTemplate` + `plainTextToHtml`, send the customer mail (BCC to `invoice_cc_emails`)
> and optional admin copy, then insert a log row recording `success`/`message_id`/`error`.

### Tier E — Log tables

Defined in §2; written downstream (Clusters 5/6). No reader UI ships in this cluster; both
are RLS-readable by staff for future tooling.

---

## 4. UI/UX design overview

### Design tokens (admin area)
Same custom Tailwind theme as the rest of admin: `ink #07203A`, `ink-muted #4E6E85`,
`vital #438B9E`, `surface #F7FAFB`, `line #D5E2E7`; status accents `red-50/500/700`,
`green-50/500/600/700`, `blue-50/200/500/700`. Icons from `lucide-react`.

### Settings page recipes
- **Section card:** `bg-white rounded-xl border border-line p-5 sm:p-6`, header = a `w-5 h-5`
  lucide icon + `text-lg font-semibold text-ink`, then a muted `text-sm` description.
- **Radio-card (toggle):** `p-4 rounded-xl border-2 transition-all text-left`; selected
  `border-vital bg-vital/5` + a `w-5 h-5 bg-vital rounded-full` containing a white `Check`;
  unselected `border-line bg-white hover:border-ink/20`; disabled `opacity-50 cursor-not-allowed`.
- **Input:** `px-4 py-2.5 bg-surface rounded-lg border border-line focus:outline-none
  focus:ring-2 focus:ring-vital/40 text-sm text-ink disabled:opacity-50 disabled:cursor-not-allowed`.
- **Primary button:** `bg-ink hover:bg-ink/90 text-white rounded-lg … text-sm font-medium
  disabled:opacity-50`.
- **Email chip row:** `flex items-center justify-between gap-2 p-3 bg-surface rounded-lg
  border border-line`, leading `w-8 h-8 bg-vital/10 rounded-lg` icon, trailing `Trash2`
  (hover `text-red-500`).
- **Status banners:** error `bg-red-50 border border-red-200` + `AlertCircle text-red-500` +
  `text-red-700`; success `bg-green-50 border border-green-200` + `Check text-green-500` +
  `text-green-700` (auto-clears after 3 s).
- **Disabled crypto card:** `border-line bg-surface/50 opacity-60 cursor-not-allowed` with a
  `Disabled` pill (`bg-line/40 text-ink-muted`, `text-[10px] uppercase tracking-wider`).
- Page width `max-w-4xl`; loading state `animate-pulse text-ink-muted text-sm "Loading settings..."`.

### Template editor recipes
- Page width `max-w-6xl`; header has a back-arrow button (`w-9 h-9 … bg-white border border-line`)
  and a `Save templates` button (`Loader2` spinner while saving).
- **Tab switcher:** `inline-flex p-1 bg-surface border border-line rounded-lg`; active tab
  `bg-white text-ink shadow-sm`, inactive `text-ink-muted hover:text-ink`.
- **Two-column `grid lg:grid-cols-2 gap-6`:** editor card (Subject input, `font-mono` Body
  textarea `rows={16}`, merge-var chip buttons `px-2 py-1 text-xs font-mono bg-surface border
  border-line rounded-md`) + preview card (subject header on `bg-surface`, `whitespace-pre-wrap`
  body, attached-PDF footer).
- Field labels: `text-xs font-medium text-ink-muted uppercase tracking-wider`.

### Email (sent) styling
Hand-built inline-styled HTML (max-width 600–650px, `-apple-system` font stack), brand
`VYTA` header with vital `#438B9E` eyebrow, `#F7FAFB`/`#F7FAFB` cards bordered `#DCE7EB`
(some with a 2px `#438B9E` accent), `#07203A` text and CTA buttons, totals tables, amber
payment-instruction box (`#FFFBEB`/`#FDE68A`), green referral badge (`#F0FDF4`/`#86EFAC`),
muted footer. `plainTextToHtml` (for the template-driven invoice/fulfillment mails) is far
simpler: a single `white-space:pre-wrap` div.

### Responsive
Cards stack single-column; radio-card grids `grid sm:grid-cols-2`; parcel inputs `grid-cols-3`;
template editor `lg:grid-cols-2` (stacks below `lg`).

---

## 5. Data flow & behavior

- **Read:** anyone (server or client) calls `GET /api/admin/settings` — **unauthenticated by
  design** — and gets the shaped, secret-free settings. Downstream code (checkout, shipping,
  email senders pulling `admin_emails`) reads the row directly with the service-role client.
- **Write:** the settings UI `PUT`s partial updates with the caller's bearer token. The route
  re-verifies role and **rejects `assistant`** (even though `canAccessAdmin('assistant')` is
  true) — settings are admin/affiliate-write only; the template editor is admin-only.
- **Send:** a downstream route imports a sender (or builds an inline transport), pulls
  `admin_emails`/templates from settings as needed, renders, and sends over SMTP. The two
  invoice/fulfillment routes additionally insert a log row.

### Intricacies (each verified in code)
1. **`email.ts` "Resend" is a shim.** Resend wasn't delivering in prod, so `getResend()`
   mimics `resend.emails.send(...)` but routes through nodemailer/SMTP. `RESEND_API_KEY` is
   not consumed here. Keep the shim shape so the many template functions don't need rewriting.
2. **`readSettingsRow()` progressive fallback** — 4 descending column sets so a partially
   migrated DB never 500s; used by GET and the PUT re-read.
3. **`easyship_api_key` is write-only** — GET returns only `easyship_api_key_set: boolean`;
   PUT overwrites it only on a non-empty value (saving other settings won't wipe it).
4. **`checkout_type` is force-coerced to `'email'`** in both `shape()` and PUT — crypto is
   disabled site-wide; the UI shows crypto as a permanently-disabled card.
5. **PUT rejects `assistant`** despite `canAccessAdmin` being true; **GET is unauthenticated**.
6. **Template defaults live in two places** — the SQL seed (`invoice-email-migration.sql`
   `UPDATE … COALESCE`) **and** the TS `DEFAULT_*` consts — with **render-time fallback**
   (`shape()` and both UIs fall back to the TS consts when a column is null/empty).
7. **The two email-log tables are owned here but written by Clusters 5 & 6** — port
   tables + RLS now, wire writes later.

---

## 6. Edge cases & states

- **Pre-migration DB:** GET degrades through column sets; on total failure returns all-defaults
  (`shape({})`) rather than 500. PUT INSERTs a fully-defaulted singleton row if none exists.
- **No settings row:** GET → defaults; PUT → INSERT.
- **Unauthorized PUT:** missing/invalid token → 401; non-admin or assistant → 403.
- **Invalid PUT payloads:** per-field 400 with a specific message (bad email, wrong type,
  negative number, bad enum value).
- **Read-only UI:** assistant sees the settings page fully disabled; non-admins see the
  template editor disabled.
- **Email send failure:** senders catch and return `{success:false, error}`; multi-recipient
  senders (`Promise.allSettled`) succeed if ≥1 recipient succeeds, else report failure;
  log-writing routes still insert a row with `success:false` + `error`.
- **Empty `admin_emails`:** notification senders return `{success:false, error:'No admin emails configured'}`.
- **Unknown merge var:** left literally as `{{var}}` in the rendered output.

---

## 7. Open questions & unverified items

- **`email.ts` dormant exports:** `sendCustomerInvoice`, `sendAdminInvoiceNotification`, and
  `sendMagicLink` are exported but no caller was found under `app/` (the live invoice send
  path is the inline-transport route; the live magic link is `lib/admin/magic-link.ts` from
  the auth cluster). Treat them as legacy/dormant — confirm before deleting.
- **`update_site_settings_updated_at()`** body is in `migration-site-settings.sql`; the live
  trigger is assumed to use that function (the provided live DDL references it by name).
- **`lib/shipping/easyship.ts` / `auto-shipment.ts`** read `site_settings` and consume the
  Easyship config/handling fee/auto-shipment toggles — they belong to the **shipping cluster**
  and were not examined here beyond confirming they read the singleton.
- **Invoice send route (`/api/admin/invoices/[id]/email`)** and **fulfillment notify route
  (`/api/warehouse/queue/[id]/notify`)** are documented only at the boundary (they own the log
  writes); their full request/permission flow belongs to Clusters 5 & 6.
- **Env vars:** `SMTP_HOST` (def `smtp.protonmail.ch`), `SMTP_PORT` (def `587`), `SMTP_USER`
  (def `noreply@aminocan.com` in email-smtp), `SMTP_PASSWORD`, `SMTP_FROM_NAME` (def `Aminocan`),
  `SMTP_FROM_EMAIL` (def `noreply@aminocan.com`), `EMAIL_FROM` (legacy fallback in email.ts),
  `NEXT_PUBLIC_BASE_URL` (def `https://aminocan.com`), `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`. `RESEND_API_KEY` is referenced historically but not used by the
  current SMTP path.
- **`migrate-site-settings` seed email** (`codogmjo@gmail.com`) is the bootstrap admin
  recipient; the live row's `admin_emails` differs (configured via the UI).
