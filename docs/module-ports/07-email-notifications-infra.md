# Module 7 — Email / Notifications Infrastructure

This module is the app's transactional email and notification layer. It spans **three independent delivery mechanisms**: (1) **Resend** (HTTP API) for branded customer/order/admin emails, (2) **SMTP via nodemailer** (defaults to ProtonMail) for invoice/checkout/stock emails and PDF-attached invoice sends, and (3) **Supabase Auth's own email service** for passwordless magic-link sign-in. It also covers the **editable invoice email templates** (admin-customizable subject/body with `{{merge_var}}` substitution), the **BCC / one-off recipient** flow on invoice sends, and the **invoice email audit log**. There is no single unified "send email" abstraction — each library file is a flat collection of typed `send*()` helpers. Pick the provider per use-case as documented below.

> **Affiliate note (STRIP):** `lib/email.ts` contains `sendAffiliateWelcome()`, and `lib/email-smtp.ts` contains `sendAffiliateRequestAdminNotification()` and `sendAffiliateRequestDecision()`. The `affiliate_welcome` case in `app/api/email/route.ts` and the affiliate referral/commission block in `app/api/orders-email/route.ts` are affiliate-specific. **Do not port any of these.** See Porting notes.

---

## Data model

The email infra itself has no dedicated "providers" table; configuration lives in environment variables and in the singleton `site_settings` row (see Module 11). The only tables owned by this module are the invoice-email template fields (on `site_settings`), the last-emailed tracking columns on `invoices`, and the `invoice_email_log` table. All from `invoice-email-migration.sql`.

### `site_settings` — invoice-email columns (added by `invoice-email-migration.sql`)

`ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS`:

| Column | Type | Default | Notes |
|---|---|---|---|
| `invoice_cc_emails` | `jsonb` | `NOT NULL DEFAULT '[]'::jsonb` | BCC list ("invoice copies"); array of email strings |
| `invoice_customer_email_subject` | `text` | NULL (seeded to default) | Customer-facing subject template |
| `invoice_customer_email_body` | `text` | NULL (seeded to default) | Customer-facing body template (plain text + merge vars) |
| `invoice_admin_email_subject` | `text` | NULL (seeded to default) | Admin/BCC-copy subject template |
| `invoice_admin_email_body` | `text` | NULL (seeded to default) | Admin/BCC-copy body template |

The migration runs an `UPDATE site_settings SET … = COALESCE(col, '<default>')` to pre-fill the singleton row with the default templates (the same strings exported as constants in `lib/invoice-email-templates.ts`). The app also falls back to defaults at render time, so the seed is mostly so the editor opens pre-filled.

### `invoices` — last-emailed tracking columns (added by `invoice-email-migration.sql`)

| Column | Type | Default | Constraints |
|---|---|---|---|
| `last_emailed_at` | `timestamptz` | NULL | Most recent successful send |
| `last_emailed_by` | `uuid` | NULL | `REFERENCES customers(id) ON DELETE SET NULL` |
| `last_emailed_by_email` | `text` | NULL | Snapshot of the sender's email |

Index: `idx_invoices_last_emailed_at ON invoices (last_emailed_at)`.

### `invoice_email_log` — full per-send history (new table)

```sql
CREATE TABLE IF NOT EXISTS invoice_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  sent_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  sent_by_email text,
  to_email text NOT NULL,
  bcc_emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text NOT NULL,
  message_id text,
  success boolean NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Index: `idx_invoice_email_log_invoice_id ON invoice_email_log (invoice_id, created_at DESC)`.

**RLS** (table `ENABLE ROW LEVEL SECURITY`):
- `invoice_email_log_admin_read` — `FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role IN ('admin','assistant')))`
- `invoice_email_log_admin_write` — `FOR ALL TO authenticated USING (… c.role = 'admin') WITH CHECK (… c.role = 'admin')`

TypeScript shape (`lib/supabase.ts` → `InvoiceEmailLogEntry`): `id, invoice_id, sent_by, sent_by_email, to_email, bcc_emails: string[], subject, message_id, success, error, created_at`.

---

## API endpoints

### `POST /api/email` (`app/api/email/route.ts`) — Resend dispatcher

Generic Resend email dispatcher keyed by a `type` discriminator.

- **Auth:** none (no auth check — be aware this is an open endpoint in the source).
- **Request:** `{ type: string, ...data }` where data matches the chosen sender's args.
- **Switch cases:** `order_confirmation` → `sendOrderConfirmation`; `shipping_notification` → `sendShippingNotification`; `customer_welcome` → `sendCustomerWelcome`; `affiliate_welcome` → `sendAffiliateWelcome` **(STRIP)**.
- **Responses:** `400 {error:'Missing email type'}`; `400 {error:'Unknown email type: …'}`; `500 {error}` if the send failed; `200 {success:true, id}` on success.

### `POST /api/orders-email` (`app/api/orders-email/route.ts`) — email-checkout order creation + SMTP invoice

Creates an order (email/invoice checkout flow) and sends SMTP invoice emails.

- **Auth:** none, but **rate-limited** via `checkRateLimit('orders:'+ip, RATE_LIMITS.orders)`; returns `429 {error:'Too many orders. Try again in N seconds.'}`.
- **Request body:** `{ items[], shipping{firstName,lastName,email,address,city,state,postalCode,country}, referralCode?, customerId?, fulfillmentType? }`. `fulfillmentType === 'pickup'` triggers pickup mode (no shipping cost, uses `PICKUP_ADDRESS` constant).
- **Constants:** `SHIPPING_COST = 20`; order number format `AMC-XXXXXXXX` (8 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
- **Key logic:** validates required fields; computes `subtotal`, `shippingCost` (0 for pickup), `total`; verifies `customerId` against `customers`; inserts into `orders` (`crypto:'email'`, `status:'pending_invoice'`) with up to 5 retries on duplicate order number (`error.code === '23505'`); inserts `order_items`. **Affiliate block (STRIP):** if `referralCode`, looks up `referral_codes` and inserts a 10% row into `commissions`. Then sends `sendCustomerInvoiceSMTP(...)` and reads `site_settings.admin_emails` to send `sendAdminInvoiceNotificationSMTP(...)`.
- **Responses:** `400` missing fields/address; `500` order insert failure; `200 {success, orderNumber, total, message}` (always returns success once the order exists, even if email failed — message text differs).
- **`GET /api/orders-email?orderNumber=…`:** returns `orders` row (`order_number, status, items, total, email, shipping_address, tracking_number, created_at`); `400` if missing, `404` if not found.

### `POST /api/admin/customers/magic-link` (`app/api/admin/customers/magic-link/route.ts`) — Supabase magic-link

Emails a passwordless sign-in link to a customer; **the email is generated AND sent by Supabase Auth itself** (not Resend/SMTP).

- **Auth:** Bearer token → `getCaller()` resolves `customers.role`. Rejected if no caller or `role === 'customer'` → `403 {error:'Unauthorized'}`. Admin/assistant may target any customer; **affiliate may only target customers where `customer.affiliate_id === caller.id`** (STRIP this affiliate branch).
- **Request:** `{ customer_id: string, redirect_path?: string }`.
- **Key logic:** looks up the customer (`id, email, first_name, last_name, affiliate_id, active`); rejects deactivated (`active === false` → `400 'This account is deactivated.'`) and synthetic guest emails (`@aminocan.local` → `400 "doesn't have a real email address"`). `redirect_path` is allow-listed to `{/account/dashboard, /admin, /account/set-password}` (defaults to `/account/dashboard`). Calls `sendSupabaseMagicLink(email, redirectPath)`.
- **Error mapping:** "not found / no user / signups not allowed" → `400 "doesn't have a login account yet."`; "rate limit / too many" → `429 "Too many sign-in emails requested… wait a minute"`; otherwise `500 {error}`.
- **Success:** `200 {success:true}`.

### `POST /api/admin/invoices/[id]/email` (`app/api/admin/invoices/[id]/email/route.ts`) — send invoice PDF (SMTP + editable templates + BCC)

The flagship send: renders the invoice PDF, applies the editable templates, sends to the customer (+ a separate BCC/admin-copy email), and logs everything.

- **Runtime:** `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.
- **Auth:** Bearer → `getAuth()` resolves `role` + `email`; requires `canEdit(role)` (admin only) else `403 {error:'Admin access required'}`.
- **Request body (all optional):** `{ to?: string, bcc?: string[] }`. `to` overrides the recipient; `bcc` is the **caller's checkbox selection plus one-off additions** from the send modal. When `bcc` is omitted entirely, falls back to `site_settings.invoice_cc_emails`.
- **Key logic:**
  1. Loads the invoice with joins (`customer`, `sales_person`, `line_items`, `payments`); `404` if not found.
  2. Resolves recipient: `to ?? inv.customer_email ?? inv.customer.email`; `400` if none.
  3. Loads the 5 template/CC settings columns.
  4. Computes `amount_paid` (sum of payments), `amount_due = max(0, total - paid)`, `customerName`.
  5. `buildInvoiceMergeVars(...)` then `renderTemplate(...)` for customer & admin subject/body.
  6. `renderInvoicePdf(inv)` → Buffer (`500` on failure with detailed message).
  7. Sends the customer email (`text` = rendered body, `html` = `plainTextToHtml(body)`, PDF attached). If `bccList.length > 0`, sends a **second, separate** email to the BCC list using the **admin** subject/body (so the customer never sees the BCC).
  8. Inserts an `invoice_email_log` row (success or failure, with `message_id`, `error`, `bcc_emails`).
  9. On success: updates `invoices` (`last_emailed_at/by/by_email`, and promotes `status` from `draft` → `sent`), and writes an audit log via `logAuditServer(... action:'invoice.email_sent', payload:{to, bcc_count})`.
- **Responses:** `500 {error}` on send failure; `200 {ok:true, to, bcc_count, message_id}` on success.
- **SMTP transport here is built inline** (not via `lib/email-smtp.ts`): `buildTransport()` uses `SMTP_HOST` (default `smtp.protonmail.ch`), `SMTP_PORT` (default 587), `secure:false`, `SMTP_USER`/`SMTP_PASSWORD`. `buildFrom()` = `${SMTP_FROM_NAME || 'Aminocan'} <${SMTP_FROM_EMAIL || SMTP_USER || 'info@aminocan.com'}>`.

---

## Library files (the senders)

### `lib/email.ts` — Resend senders
- Lazy singleton `getResend()` throws if `RESEND_API_KEY` unset. `fromEmail = process.env.EMAIL_FROM || 'Aminocan <orders@aminocan.com>'`.
- All return `{ success: boolean, id?: string, error?: string }`. All use inline branded HTML (VYTA header, vital `#438B9E` accent, footer "VYTA Biosciences • Canada").
- Functions: `sendOrderConfirmation` (subject `Order Confirmed - {orderNumber}`), `sendShippingNotification` (`Your Order Has Shipped - …`), `sendCustomerWelcome` (`Welcome to Aminocan!`), **`sendAffiliateWelcome` (STRIP)**, `sendPaymentConfirmed` (`Payment Confirmed - …`), `sendAdminPaymentNotification` (hard-coded `to:'info@aminocan.com'`), `sendCustomerInvoice`, `sendAdminInvoiceNotification`, and **`sendMagicLink`** — note: `sendMagicLink` here delivers a Supabase-generated `actionLink` **through Resend** (an alternate magic-link path), distinct from `lib/admin/magic-link.ts`. It logs the Resend message id and surfaces Resend errors.

### `lib/email-smtp.ts` — nodemailer/SMTP senders
- Lazy singleton `getTransporter()`: `SMTP_HOST` (default `smtp.protonmail.ch`), `SMTP_PORT` (default 587), `secure:false`, auth `SMTP_USER` (default `noreply@aminocan.com`) / `SMTP_PASSWORD`. `fromEmail = ${SMTP_FROM_NAME||'Aminocan'} <${SMTP_FROM_EMAIL||'noreply@aminocan.com'}>`.
- Functions: `sendCustomerInvoiceSMTP` (handles `fulfillmentType` pickup/shipping; "Ship To" vs "Pickup Location"; shipping shown as "Free" for pickup; subject `Invoice {orderNumber} - VYTA Biosciences`), `sendAdminInvoiceNotificationSMTP` (**accepts `adminEmails: string | string[]`**, filters empties, sends to each via `Promise.allSettled`, succeeds if ≥1 sends, returns `Sent to N/M admin emails`), `sendBackInStockNotification`, `sendLowStockAlert` (red/amber styling based on out-of-stock vs low; multi-admin), and **`sendAffiliateRequestAdminNotification` / `sendAffiliateRequestDecision` (STRIP)**.

### `lib/admin/magic-link.ts` — Supabase Auth magic-link
- `getOtpClient()` builds a dedicated Supabase client with `flowType:'implicit'`, `persistSession:false`, `autoRefreshToken:false`, `detectSessionInUrl:false`. The **implicit flow** is required because the link is generated by staff (not in the recipient's browser) — PKCE would need a `code_verifier` from the recipient's browser. Implicit returns session tokens in the URL hash; the app's browser client picks them up via `detectSessionInUrl`.
- `sendSupabaseMagicLink(email, redirectPath='/account/dashboard')`: lowercases/trims; rejects empty or `@aminocan.local` (guest) addresses. Calls `signInWithOtp({ email, options:{ emailRedirectTo: BASE_URL+redirectPath, shouldCreateUser:false } })`. `shouldCreateUser:false` ensures it never silently creates an account (accounts are created up-front by the customer/affiliate create routes). Returns `{success, error?}`.

### `lib/invoice-email-templates.ts` — editable template engine
- Default constants: `DEFAULT_CUSTOMER_SUBJECT`, `DEFAULT_CUSTOMER_BODY`, `DEFAULT_ADMIN_SUBJECT`, `DEFAULT_ADMIN_BODY` (these match the SQL seed exactly).
- `MERGE_VARS`: array of `{name, description, sample}` — `customer_name, customer_first_name, customer_last_name, customer_email, invoice_number, invoice_total, amount_due, amount_paid, due_date, issue_date, currency, sent_by_email, company_name`.
- `buildInvoiceMergeVars({invoice, amountPaid, amountDue, customerName, customerEmail, sentByEmail, currency='CAD', companyName='Aminocan'})` → `Record<string,string>`; splits name into first/last; formats totals to 2dp; formats dates via `toLocaleDateString(undefined,{year,month:'long',day})`.
- `renderTemplate(tpl, vars)`: regex `\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}` substitution; unknown keys are left as literal `{{key}}`.
- `plainTextToHtml(body)`: HTML-escapes and wraps in a `white-space: pre-wrap` div.

---

## Frontend

This module has no standalone customer-facing page; its UI surfaces live inside other admin modules:

- **Template editor** — `/admin/settings/email-templates` (`app/(admin)/admin/settings/email-templates/page.tsx`). Documented in Module 11.
- **BCC list management** — `/admin/settings` "Invoice Emails" card. Documented in Module 11.
- **Invoice send modal + email history** — on the invoice detail page `app/(admin)/admin/invoices/[id]/page.tsx` (part of the Invoices module, not in this port's scope), which posts to `/api/admin/invoices/[id]/email` with the user's `to`/`bcc` selections and renders the `invoice_email_log`.
- **Magic-link button** — surfaced from the admin customers page (calls `/api/admin/customers/magic-link`).

Data flow for an invoice send: invoice detail page collects recipient + BCC checkboxes → `POST /api/admin/invoices/[id]/email` → server renders templates + PDF → SMTP sends → writes `invoice_email_log` + bumps `invoices.last_emailed_*` → page reloads the log.

---

## UI/UX specification

The only UI strictly owned here is the **invoice send confirmation feedback** and how the **template/BCC config** behaves (full spec in Module 11). Key user-facing copy & behaviors:

- **Send result:** success returns `{ok, to, bcc_count}`; the invoice page typically shows a toast like "Invoice sent to {email}". On PDF failure the server returns `Failed to generate invoice PDF: <reason>`; on SMTP failure the raw error string.
- **Magic-link button** error messages (verbatim, surfaced as toasts/inline by the caller):
  - "This account is deactivated."
  - "This customer doesn't have a real email address on file."
  - "This customer doesn't have a login account yet."
  - "Too many sign-in emails requested for this account. Please wait a minute and try again."
- **Customer email (rendered template), default body copy:**
  > Hi {{customer_first_name}},
  > Thanks again for your order. Your invoice {{invoice_number}} is attached as a PDF — the total is ${{invoice_total}} {{currency}}, due {{due_date}}.
  > If anything looks off, just reply to this email and we'll sort it out.
  > — Aminocan
- **Admin/BCC copy default subject:** `[Copy] Invoice {{invoice_number}} sent to {{customer_email}}`.
- **Branded HTML emails** (Resend/SMTP): max-width 600–650px centered container, white background, header `VYTA` 24–28px bold `#07203A` with vital `#438B9E` uppercase subtitle ("Canadian Peptides"), monospace order numbers, totals table with `#07203A` total row, footer "VYTA Biosciences • Canada — Questions? Reply to this email." Status colors: success/payment green (`#ECFDF5`/`#065F46`), payment-instructions amber (`#FEF3C7`/`#92400E`), referral green box, low-stock red (`#B91C1C`) vs amber (`#B45309`).

There are no loading/empty/error UI states inside the email module itself beyond what the host pages render; all senders return `{success,error}` for the caller to translate.

---

## Dependencies

**npm packages:**
- `resend` ^6.9.2 — `lib/email.ts`, `lib/admin/magic-link` (alternate path in email.ts).
- `nodemailer` ^8.0.4 (+ `@types/nodemailer`) — `lib/email-smtp.ts`, invoice email route.
- `@supabase/supabase-js` ^2.83.0 — service-role client + magic-link OTP client.
- `pdfkit` ^0.15.2 (+ `@types/pdfkit`) — `lib/invoice-pdf` `renderInvoicePdf` (used by the invoice email route).

**Env vars:**
- Resend: `RESEND_API_KEY` (required for `lib/email.ts`), `EMAIL_FROM` (default `Aminocan <orders@aminocan.com>`).
- SMTP: `SMTP_HOST` (default `smtp.protonmail.ch`), `SMTP_PORT` (default `587`), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME` (default `Aminocan`), `SMTP_FROM_EMAIL` (default `noreply@aminocan.com`).
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- General: `NEXT_PUBLIC_BASE_URL` (default `https://aminocan.com`) for links in emails / magic-link redirects.
- **Supabase Auth → SMTP must be configured in the Supabase dashboard** for reliable magic-link delivery (Supabase's built-in mailer is rate-limited). See `MAGIC-LINK-SETUP.md`.

**Other modules relied on:**
- Module 11 (Settings) — owns `site_settings` and the template/BCC editor UI; `admin_emails` & `invoice_cc_emails` are read here.
- Module 12 (Sales People) — invoice send joins `sales_persons`.
- Invoices module (out of port scope) — `renderInvoicePdf`, the invoice detail page, `invoices` table.
- `lib/rate-limit` (`checkRateLimit`, `getClientIp`, `RATE_LIMITS`), `lib/permissions` (`canEdit`), `lib/admin/audit` (`logAuditServer`).

---

## Porting notes

**What to STRIP (affiliate — not being ported):**
1. `lib/email.ts`: delete `sendAffiliateWelcome()`.
2. `app/api/email/route.ts`: remove the `affiliate_welcome` case and its import.
3. `lib/email-smtp.ts`: delete `sendAffiliateRequestAdminNotification()` and `sendAffiliateRequestDecision()`.
4. `app/api/orders-email/route.ts`: remove the entire `if (referralCode) { … referral_codes … commissions … }` block and the `referralCode` mentions in the email payloads (the referral-code visual blocks in the invoice templates are harmless but tied to affiliates — drop them).
5. `app/api/admin/customers/magic-link/route.ts`: remove the `affiliate` branch (`if (caller.role === 'affiliate' && customer.affiliate_id !== caller.id)`) and drop `affiliate_id` from the customer select; collapse the caller check to admin/assistant only.

**Gotchas:**
- **Three providers, no abstraction.** Decide per-email which transport to keep. The new site can standardize on one (e.g. all SMTP), but note the invoice send route builds its **own** transport inline rather than reusing `lib/email-smtp.ts` — keep them in sync or refactor to one helper.
- **`/api/email` and `/api/orders-email` have no auth** — they are public by design (called from cart/checkout). The invoice send and magic-link routes are admin-gated.
- **Magic-link two paths:** `lib/admin/magic-link.ts` (Supabase sends) is the one wired to `/api/admin/customers/magic-link`. `lib/email.ts#sendMagicLink` (Resend sends a Supabase-generated link) is an alternate; verify which the new site wants before porting both.
- **Supabase rate-limits OTP emails.** Without custom SMTP in Supabase Auth you'll hit the cooldown quickly — the route already maps that to a friendly 429.
- **Templates seeded twice:** the SQL seeds defaults AND `lib/invoice-email-templates.ts` falls back at render time. Both must carry the same default strings.
- **PDF attachment** is generated server-side at send time (`renderInvoicePdf`) — depends on the Invoices module being ported first.

**Order of implementation:**
1. Run `invoice-email-migration.sql` (depends on `site_settings` + `invoices` existing — Modules 11 & Invoices first).
2. Port `lib/invoice-email-templates.ts` (pure, no deps).
3. Port `lib/email-smtp.ts` and/or `lib/email.ts` (strip affiliate fns) + set env vars.
4. Port `lib/admin/magic-link.ts` and the magic-link route (strip affiliate branch); configure Supabase Auth SMTP.
5. Port `/api/orders-email` (strip affiliate block) and `/api/admin/invoices/[id]/email` (needs `renderInvoicePdf`).
6. Wire the template editor / BCC UI (Module 11) and the invoice send modal (Invoices module).
