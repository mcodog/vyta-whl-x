# Module 11 — Settings (Admin)

The admin settings area lets an administrator configure global, site-wide behavior stored in a **singleton `site_settings` row**: the **checkout type** (email-invoice vs cryptocurrency), the list of **admin notification emails**, a **pickup address** for local pickup, a **guest-checkout** toggle, an **invoice BCC ("copy") list**, and the **editable invoice email templates** (subject/body for the customer email and the admin copy, with `{{merge_var}}` substitution and live preview). There are two pages: `/admin/settings` (the main settings page) and `/admin/settings/email-templates` (the template editor). Both read/write through one API route, `/api/admin/settings`. Reads are public-ish (used by the cart to know the checkout type); writes are admin-only (assistants are read-only).

---

## Data model

One singleton table, `site_settings`, built up across three migrations.

### `migration-site-settings.sql` — base table

```sql
CREATE TABLE IF NOT EXISTS site_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_type TEXT NOT NULL DEFAULT 'crypto'
    CHECK (checkout_type IN ('email', 'crypto')),
  admin_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX site_settings_singleton ON site_settings ((true));  -- only one row ever
```

- **Singleton enforcement:** the unique index on the constant expression `(true)` allows exactly one row.
- **`updated_at` trigger:** `update_site_settings_updated_at()` sets `NEW.updated_at = now()` `BEFORE UPDATE`.
- **RLS:** `ENABLE ROW LEVEL SECURITY`; policy `"Service role full access"` `FOR ALL USING (true) WITH CHECK (true)`. (All actual write auth happens in the API via the service-role client + role check — RLS is effectively wide open to the service role.)
- **Seed:** `INSERT (checkout_type, admin_emails) VALUES ('email', '["codogmjo@gmail.com"]') ON CONFLICT DO NOTHING`. (Replace the seeded admin email when porting.)

### `migration-checkout-config.sql` — checkout enhancements

```sql
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS pickup_address TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS guest_checkout_enabled BOOLEAN DEFAULT true;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS allow_pickup BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_shipping BOOLEAN DEFAULT true;
```

- `pickup_address` (`text`, default `''`) — shown to customers who pick local pickup at checkout.
- `guest_checkout_enabled` (`boolean`, default `true`) — allow checkout without an account.
- (Also adds per-customer `allow_pickup` / `allow_shipping` flags to `customers` — these belong to the customer/checkout module but ship in this migration.)

### `invoice-email-migration.sql` — invoice email columns (shared with Module 7)

Adds to `site_settings`: `invoice_cc_emails jsonb NOT NULL DEFAULT '[]'`, `invoice_customer_email_subject text`, `invoice_customer_email_body text`, `invoice_admin_email_subject text`, `invoice_admin_email_body text` — and seeds them with the default templates via `COALESCE`. Full detail (plus the `invoices` tracking columns and `invoice_email_log` table) is in **Module 7**.

### TypeScript `SiteSettings` shape (`lib/supabase.ts`)

```ts
interface SiteSettings {
  checkout_type: 'email' | 'crypto';
  admin_emails: string[];
  pickup_address: string;
  guest_checkout_enabled: boolean;
  invoice_cc_emails: string[];
  invoice_customer_email_subject: string;
  invoice_customer_email_body: string;
  invoice_admin_email_subject: string;
  invoice_admin_email_body: string;
}
```

---

## API endpoints

### `app/api/admin/settings/route.ts`

`SETTINGS_COLUMNS` selected/returned = `checkout_type, admin_emails, pickup_address, guest_checkout_enabled, invoice_cc_emails, invoice_customer_email_subject, invoice_customer_email_body, invoice_admin_email_subject, invoice_admin_email_body`.

A `shape(data)` helper normalizes the response: missing values default to `checkout_type:'crypto'`, `admin_emails:[]`, `pickup_address:''`, `guest_checkout_enabled:true`, `invoice_cc_emails:[]`, and the four template fields fall back to the `DEFAULT_*` constants from `lib/invoice-email-templates.ts`.

`normaliseEmailList(value)` — requires an array of strings, trims, drops empties, validates each against `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, returns the cleaned array or `{error}`.

#### `GET /api/admin/settings`
- **Auth:** none (intentionally public — the cart reads `checkout_type`). Uses the regular `getSupabase()` client.
- **Logic:** selects the singleton row; on DB error returns `shape({})` (defaults) so the cart still works.
- **Response:** `200` with the full shaped `SiteSettings` object.

#### `PUT /api/admin/settings`
- **Auth:** Bearer token → service-role `getUser` → `customers.role`. Requires `canAccessAdmin(role)` **and** `role !== 'assistant'` (i.e. **admin only**; assistants are blocked) else `403 {error:'Admin access required'}`. Missing/invalid token → `401 {error:'Not authenticated'}`.
- **Request body (all fields optional / partial update):** `checkout_type, admin_emails, pickup_address, guest_checkout_enabled, invoice_cc_emails, invoice_customer_email_subject, invoice_customer_email_body, invoice_admin_email_subject, invoice_admin_email_body`.
- **Validation:** `checkout_type` must be `'email'|'crypto'` else `400`. `admin_emails` / `invoice_cc_emails` run through `normaliseEmailList` (`400 "{field} {error}"` e.g. `Invalid email format: x`). `guest_checkout_enabled` must be boolean. The four template fields must be strings.
- **Persist:** finds the existing singleton (`select('id')`); if present, `update(updates)` by id; otherwise `insert` a full row with defaults filled in. Returns the shaped row. Uses `getSupabase()` for the read/write of the row but the service-role `createClient` for the auth check.
- **Response:** `200 {success:true, settings: SiteSettings}`; `500 {error}` on failure.

> **Consumers:** `app/api/orders-email/route.ts` reads `site_settings.admin_emails`; `app/api/admin/invoices/[id]/email/route.ts` reads the `invoice_cc_emails` + the four template columns; the cart page reads `checkout_type`.

---

## Frontend

### Page 1 — `/admin/settings` (`app/(admin)/admin/settings/page.tsx`, `'use client'`)
- **Role gating:** `useUserRole()` from the admin layout; `isReadOnly = userRole === 'assistant'`. Read-only disables all inputs/buttons; attempting to save shows "You have read-only access".
- **State:** a `settings` object (the full `SiteSettings`), `pickupAddressInput` (separate buffer for the address field), `loading`, `saving`, `error`, `success`, plus per-input buffers `newEmail`/`emailError` and `newInvoiceCc`/`invoiceCcError`.
- **Data flow:** `fetchSettings()` GETs `/api/admin/settings` on mount. `saveSettings(updates)` grabs the Supabase session, PUTs the partial `updates` with `Authorization: Bearer`, then updates local state and shows a 3-second success toast. **Every mutation auto-saves immediately** (no global Save button on this page) — toggling checkout type, adding/removing an email, saving the pickup address, toggling guest checkout each call `saveSettings`.
- **Handlers:** `handleCheckoutTypeChange`, `handleSavePickupAddress`, `handleGuestCheckoutToggle`, `addEmail`/`removeEmail` (admin emails), `addInvoiceCc`/`removeInvoiceCc` (BCC list). The add-email handlers validate empty / format (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) / duplicate before saving.

### Page 2 — `/admin/settings/email-templates` (`app/(admin)/admin/settings/email-templates/page.tsx`, `'use client'`)
- **Role gating:** `isReadOnly = userRole !== 'admin'` (only admins can edit templates; assistants & others are read-only).
- **State:** `active: 'customer'|'admin'` tab, a `TemplateState {customerSubject, customerBody, adminSubject, adminBody}`, `loading/saving/error/success`.
- **Data flow:** on mount GETs `/api/admin/settings` and seeds the four fields (falling back to `DEFAULT_*`). `save()` PUTs only the four template fields. There **is** an explicit "Save templates" button here (unlike page 1).
- **Live preview:** `sampleVars` built from `MERGE_VARS` samples; `previewSubject`/`previewBody` = `renderTemplate(text, sampleVars)` (memoized). `insertVar(name)` inserts `{{name}}` at the caret of the focused subject/body field (driven through the React change handlers).
- **Reset:** `resetActive()` restores the active tab's subject+body to the `DEFAULT_*` constants.

---

## UI/UX specification

### `/admin/settings` — "Site Settings" page (`max-w-4xl`)
- **Header:** `Settings` icon + h1 "Site Settings"; subtitle "Configure checkout type and admin notification emails".
- **Status banners:** error = red (`bg-red-50 border-red-200`, `AlertCircle`); success = green (`bg-green-50 border-green-200`, `Check`), auto-clears after 3s.

**Card: Checkout Type** (`CreditCard` icon, "Select which checkout system to use for customer orders"). Two selectable cards in a 2-col grid:
- **Email Invoice** (`Send` icon) — "Send invoices via email and process payments manually".
- **Cryptocurrency** (`CreditCard` icon) — "Accept Bitcoin, Ethereum, and Solana payments".
- Selected card: bronze border + `bg-bronze/5` + a bronze check circle (top-right). Disabled/dimmed while saving or read-only.

**Card: Admin Email Notifications** (`Mail` icon, "Add email addresses that will receive order notifications and low-stock alerts").
- Input (`type=email`, placeholder `admin@example.com`) + **Add** button (`Plus`). Enter key adds. Inline red error under the input (`Email cannot be empty` / `Invalid email format` / `Email already added`).
- Empty state: "No admin emails configured. Add at least one email address."
- List: each row = bronze mail-icon chip + the email (break-all) + a trash button (hover red) to remove.

**Card: Invoice Emails** (`FileText` icon). Copy: "When an admin sends an invoice from the invoice page, a copy (BCC, hidden from the customer) goes to every address below."
- Input (placeholder `finance@example.com`) + **Add** button; same validation errors as above.
- Empty state: "No copy recipients. Invoice copies won't be sent."
- List rows identical style to admin emails.
- Footer: a full-width dark button **"Edit invoice email templates"** (`FileText` + `ChevronRight`) linking to `/admin/settings/email-templates`.

**Card: Pickup Address** (`MapPin` icon, "The address shown to customers who select local pickup at checkout").
- Text input (placeholder `e.g. 123 Main St, Toronto, ON M5V 1A1`) + **Save** button (`Check`). Enter saves. Below: `Current: <value>` when set.

**Card: Guest Checkout** (`Users` icon, "Allow customers to checkout without creating an account"). Two selectable cards:
- **Enabled** (`ToggleRight`) — "Anyone can checkout without an account".
- **Disabled** (`ToggleLeft`) — "Customers must sign in to place an order".
- Same selected styling (bronze border + check circle).

**Info box** (blue `bg-blue-50 border-blue-200`, `AlertCircle`), "Important Notes:" bulleted list:
- "Changes to checkout type take effect immediately"
- "All admin emails receive order notifications and low-stock alerts"
- "Email checkout requires SMTP configuration in .env.local"
- "Crypto checkout requires blockchain wallet setup"

**Loading state:** centered pulsing "Loading settings...".

### `/admin/settings/email-templates` — "Invoice email templates" page (`max-w-6xl`)
- **Header:** back arrow (→ `/admin/settings`), h1 "Invoice email templates", subtitle "Drafts used when sending invoices. Live preview uses sample data." Right: dark **"Save templates"** button (`Save`/`Loader2` when saving, disabled while saving or read-only).
- **Banners:** red error / green success ("Templates saved", auto-clears 3s).
- **Tab switcher** (pill group): **Customer email** (`Send` icon) and **Admin copy** (`Mail` icon); active tab gets white bg + shadow.
- **Two-column grid (`lg:grid-cols-2`):**
  - **Editor card:** header shows "Customer email" / "Admin copy" + a **"Reset to default"** link (`RotateCcw`). **Subject** input (`id=tpl-subject`). **Body** textarea (`id=tpl-body`, `rows=16`, monospace) with helper "Use {{merge_vars}} below. The PDF is attached automatically." Below: "Available merge vars (click to insert)" — a wrap of clickable monospace chips, one per `MERGE_VARS` entry, each `title` = its description; clicking inserts the token at the caret.
  - **Preview card:** "Preview" heading; a framed mock email — Subject bar (renders `previewSubject`), body (renders `previewBody`, `whitespace-pre-wrap`), and a footer chip "📎 INV-1042.pdf (attached)". Caption: "Preview uses sample values. Actual sends will substitute real invoice data."
- **Loading state:** centered pulsing "Loading templates...".

**Merge vars available** (with sample preview values): `customer_name` (Alex Brown), `customer_first_name` (Alex), `customer_last_name` (Brown), `customer_email` (alex@example.com), `invoice_number` (INV-1042), `invoice_total` (249.50), `amount_due` (249.50), `amount_paid` (0.00), `due_date` (June 14, 2026), `issue_date` (May 28, 2026), `currency` (CAD), `sent_by_email` (admin@aminocan.com), `company_name` (Aminocan).

**Responsive:** settings page is single-column `max-w-4xl`; selectable card grids collapse to 1-col on mobile (`sm:grid-cols-2`). Template editor is single-column on mobile, 2-up on `lg`.

---

## Dependencies

- **npm:** `@supabase/supabase-js` (service-role for auth check + `getSupabase()` for row I/O), `lucide-react` (icons), `next` (`Link`).
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auth check), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client session). `checkout_type:'email'` additionally relies on SMTP env (Module 7); `'crypto'` relies on wallet env (out of scope).
- **Other modules / files:**
  - `lib/permissions` → `canAccessAdmin`.
  - `lib/invoice-email-templates` → `DEFAULT_CUSTOMER_SUBJECT/BODY`, `DEFAULT_ADMIN_SUBJECT/BODY`, `MERGE_VARS`, `renderTemplate` (shared with Module 7).
  - The admin layout's `useUserRole()` context.
  - Consumers: cart page (checkout_type), `/api/orders-email` (admin_emails), `/api/admin/invoices/[id]/email` (cc + templates).

---

## Porting notes

- **No affiliate entanglement in this module** — settings are clean to port. (The only role nuance is the standard admin/assistant/affiliate enum from `lib/permissions`; assistants are read-only here, affiliates never reach these pages.)
- **Singleton pattern is load-bearing:** keep the `UNIQUE INDEX site_settings_singleton ON site_settings ((true))` — the PUT handler relies on there being one row (it does `select('id').single()` then update-or-insert).
- **Replace the seeded admin email** `codogmjo@gmail.com` in `migration-site-settings.sql` and the brand-specific defaults (Aminocan / template copy) for the new site.
- **GET is unauthenticated by design** (cart needs `checkout_type`). If the new site wants the template/cc fields private, split the public read (checkout_type only) from the admin read. As written, GET returns everything including templates.
- **Two different read-only rules:** settings page treats `assistant` as read-only but admins edit; the template page treats anyone who isn't `admin` as read-only. The PUT endpoint enforces admin-only server-side regardless.
- **Auto-save vs explicit save:** the main settings page saves on every change; the templates page has an explicit Save button. Preserve both behaviors for parity.
- **Defaults live in two places** (SQL seed + `lib/invoice-email-templates.ts`); keep them identical.
- **Order of implementation:** (1) run `migration-site-settings.sql`, then `migration-checkout-config.sql`, then `invoice-email-migration.sql`; (2) port `lib/invoice-email-templates.ts` + `SiteSettings` type; (3) port `/api/admin/settings`; (4) port the two pages; (5) wire consumers (cart, orders-email, invoice email).
