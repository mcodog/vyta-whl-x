# Module 1 — Invoices

The Invoices module is the admin-facing accounts-receivable system: it lets staff build invoices line-by-line (with a customer picker, product autocomplete, an active-pricelist-driven default unit price, an optional salesperson + commission, tax/shipping, and notes), persist them with a sequential human-readable number (`INV-1000`, `INV-1001`, …), email a branded PDF to the customer with editable templates and per-send BCC/one-off recipients, record partial/full payments, view an aging (A/R) report, and manage status. It also implements **split-on-backorder**: when a line item's quantity exceeds on-hand stock at creation time, the invoice is automatically split into an in-stock primary invoice and a linked "backorder" invoice. Marking an invoice **paid** decrements product stock once (idempotently) and re-checks low-stock alerts. The list view is server-paginated with skeleton loading and live summary stats.

> **Affiliate note (stripped):** This codebase has an Affiliate program where affiliates can view/create/edit invoices scoped to the customers bound to them. **That scoping is NOT being ported.** Throughout this doc, behavior is documented for **admin** and **assistant** roles only. Each place where affiliate logic was removed is flagged with a `> AFFILIATE STRIPPED` callout so you know what to skip.

---

## Data model

All tables live in Postgres (Supabase). The base invoice schema is in `ecommerce-backend-migration.sql`; the feature migrations layer columns/tables on top. Transcribed accurately below.

### Sequence

```sql
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 1000;
```

### `invoices` (base: `ecommerce-backend-migration.sql`)

| Column | Type | Default / Constraint |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `invoice_number` | `text` | `UNIQUE NOT NULL`, default `'INV-' || nextval('invoice_number_seq')::text` |
| `order_id` | `uuid` | FK → `orders(id)` `ON DELETE SET NULL` |
| `customer_id` | `uuid` | FK → `customers(id)` `ON DELETE SET NULL` |
| `customer_name` | `text` | nullable (guest/denormalized name) |
| `customer_email` | `text` | nullable |
| `customer_phone` | `text` | nullable |
| `issue_date` | `date` | `NOT NULL DEFAULT CURRENT_DATE` |
| `due_date` | `date` | `NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days')` |
| `subtotal` | `numeric(10,2)` | `NOT NULL DEFAULT 0` |
| `tax_rate` | `numeric(5,2)` | `NOT NULL DEFAULT 0` |
| `tax_total` | `numeric(10,2)` | `NOT NULL DEFAULT 0` |
| `shipping_cost` | `numeric(10,2)` | `NOT NULL DEFAULT 0` |
| `total` | `numeric(10,2)` | `NOT NULL DEFAULT 0` |
| `status` | `text` | `NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partial','paid','overdue'))` |
| `notes` | `text` | nullable |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` (bumped by `invoices_updated_at` trigger calling `set_updated_at()`) |

Indexes: `idx_invoices_customer_id`, `idx_invoices_order_id`, `idx_invoices_status`, `idx_invoices_due_date`, and a partial unique index `uniq_invoices_order_id ON invoices (order_id) WHERE order_id IS NOT NULL` (one invoice per order, for `autoCreateInvoiceFromOrder` idempotency).

**Columns added by `invoice-sales-features-migration.sql`:**

| Column | Type | Default / Constraint |
|---|---|---|
| `sales_person_id` | `uuid` | FK → `sales_persons(id)` `ON DELETE SET NULL` |
| `sales_person_commission_rate` | `numeric(5,2)` | `NOT NULL DEFAULT 0` |
| `sales_person_commission_amount` | `numeric(10,2)` | `NOT NULL DEFAULT 0` |

Index: `idx_invoices_sales_person_id`.

**Columns added by `invoice-email-migration.sql`:**

| Column | Type | Default / Constraint |
|---|---|---|
| `last_emailed_at` | `timestamptz` | nullable |
| `last_emailed_by` | `uuid` | FK → `customers(id)` `ON DELETE SET NULL` |
| `last_emailed_by_email` | `text` | nullable |

Index: `idx_invoices_last_emailed_at`.

**Columns added by `invoice-split-backorder-migration.sql`:**

| Column | Type | Default / Constraint |
|---|---|---|
| `is_backorder` | `boolean` | `NOT NULL DEFAULT false` (true = the exceeding-stock portion of a split) |
| `parent_invoice_id` | `uuid` | FK → `invoices(id)` `ON DELETE SET NULL` (backorder → its primary) |

Indexes: `idx_invoices_is_backorder`, `idx_invoices_parent`.

**Column added by `stock-decrement-migration.sql`:**

| Column | Type | Default |
|---|---|---|
| `stock_adjusted` | `boolean` | `NOT NULL DEFAULT false` (idempotency flag; set once when stock is decremented) |

### `invoice_line_items` (`ecommerce-backend-migration.sql`)

| Column | Type | Default / Constraint |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `invoice_id` | `uuid` | `NOT NULL` FK → `invoices(id)` `ON DELETE CASCADE` |
| `product_id` | `uuid` | FK → `products(id)` `ON DELETE SET NULL` (null = custom/free-text line) |
| `description` | `text` | `NOT NULL` |
| `qty` | `integer` | `NOT NULL DEFAULT 1 CHECK (qty > 0)` |
| `unit_price` | `numeric(10,2)` | `NOT NULL DEFAULT 0` |
| `discount_pct` | `numeric(5,2)` | `NOT NULL DEFAULT 0` |
| `line_total` | `numeric(10,2)` | `NOT NULL DEFAULT 0` |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

Indexes: `idx_invoice_line_items_invoice_id`, `idx_invoice_line_items_product_id`.

### `payments` (`ecommerce-backend-migration.sql`)

| Column | Type | Default / Constraint |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `invoice_id` | `uuid` | `NOT NULL` FK → `invoices(id)` `ON DELETE CASCADE` |
| `amount` | `numeric(10,2)` | `NOT NULL CHECK (amount > 0)` |
| `method` | `text` | `NOT NULL CHECK (method IN ('card','e-transfer','cash','other'))` |
| `reference_note` | `text` | nullable |
| `paid_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `recorded_by` | `uuid` | FK → `customers(id)` `ON DELETE SET NULL` |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

Index: `idx_payments_invoice_id`.

### `sales_persons` (`invoice-sales-features-migration.sql`)

| Column | Type | Default / Constraint |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `first_name` | `text` | `NOT NULL` |
| `last_name` | `text` | `NOT NULL` |
| `email` | `text` | nullable |
| `phone` | `text` | nullable |
| `commission_rate` | `numeric(5,2)` | `NOT NULL DEFAULT 5.00` |
| `notes` | `text` | nullable |
| `active` | `boolean` | `NOT NULL DEFAULT true` |
| `total_earnings` | `numeric(10,2)` | `NOT NULL DEFAULT 0` |
| `created_at` / `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()`; `sales_persons_updated_at` trigger → `set_updated_at()` |

Indexes: `idx_sales_persons_active`, `idx_sales_persons_name (lower(last_name), lower(first_name))`.

> **AFFILIATE STRIPPED:** the affiliate flow looks up a salesperson by a `user_id` column (`sales_persons.user_id`) to bind an affiliate to their salesperson row. That column is not part of this migration and is only used by affiliate code — skip it.

### `sales_commissions` (`invoice-sales-features-migration.sql`)

| Column | Type | Default / Constraint |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `sales_person_id` | `uuid` | `NOT NULL` FK → `sales_persons(id)` `ON DELETE CASCADE` |
| `invoice_id` | `uuid` | FK → `invoices(id)` `ON DELETE SET NULL` |
| `amount` | `numeric(10,2)` | `NOT NULL` |
| `invoice_total` | `numeric(10,2)` | `NOT NULL` |
| `commission_rate` | `numeric(5,2)` | `NOT NULL` |
| `status` | `text` | `NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled'))` |
| `paid_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

Indexes: `idx_sales_commissions_sales_person_id`, `idx_sales_commissions_invoice_id`, `idx_sales_commissions_status`.

### `invoice_email_log` (`invoice-email-migration.sql`)

Audit trail of every send (success or failure).

| Column | Type | Default / Constraint |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `invoice_id` | `uuid` | `NOT NULL` FK → `invoices(id)` `ON DELETE CASCADE` |
| `sent_by` | `uuid` | FK → `customers(id)` `ON DELETE SET NULL` |
| `sent_by_email` | `text` | nullable |
| `to_email` | `text` | `NOT NULL` |
| `bcc_emails` | `jsonb` | `NOT NULL DEFAULT '[]'::jsonb` |
| `subject` | `text` | `NOT NULL` |
| `message_id` | `text` | nullable |
| `success` | `boolean` | `NOT NULL` |
| `error` | `text` | nullable |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` |

Index: `idx_invoice_email_log_invoice_id (invoice_id, created_at DESC)`.

### `site_settings` — invoice-email columns (`invoice-email-migration.sql`)

Added to the existing singleton `site_settings` row:

| Column | Type | Default |
|---|---|---|
| `invoice_cc_emails` | `jsonb` | `NOT NULL DEFAULT '[]'::jsonb` (the BCC / "invoice copies" list) |
| `invoice_customer_email_subject` | `text` | seeded with default template (see below) |
| `invoice_customer_email_body` | `text` | seeded |
| `invoice_admin_email_subject` | `text` | seeded |
| `invoice_admin_email_body` | `text` | seeded |

The migration `UPDATE`s the singleton row to seed defaults via `COALESCE` (only if NULL); the app **also** falls back to defaults at render time (`lib/invoice-email-templates.ts`), so the DB seed is only so the editor opens pre-filled.

### `backorders` / `backorder_items` (`backorders-migration.sql`)

Used by split-on-backorder; the backorder row is created against the **backorder invoice**.

`backorders`: `id uuid PK`, `invoice_id uuid NOT NULL FK→invoices ON DELETE CASCADE`, `status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','fulfilled','cancelled'))`, `purchase_order_id uuid FK→purchase_orders ON DELETE SET NULL`, `created_at timestamptz`, `fulfilled_at timestamptz`.

`backorder_items`: `id uuid PK`, `backorder_id uuid NOT NULL FK→backorders ON DELETE CASCADE`, `product_id uuid FK→products ON DELETE SET NULL`, `description text NOT NULL`, `qty_ordered numeric NOT NULL`, `qty_available numeric NOT NULL`, `qty_backordered numeric NOT NULL`, `unit_price numeric NOT NULL DEFAULT 0`, `created_at timestamptz`.

Both have RLS enabled with **no public policies** (service-role only).

### RPC functions

- **`mark_overdue_invoices() RETURNS integer`** (`ecommerce-backend-migration.sql`): `UPDATE invoices SET status='overdue', updated_at=now() WHERE due_date < CURRENT_DATE AND status IN ('sent','partial')`; returns row count. Called at the top of `GET /api/admin/invoices` and `GET /api/admin/invoices/aging` on every request.
- **`adjust_stock_for_invoice(p_invoice_id uuid) RETURNS void`** (`stock-decrement-migration.sql`, `SECURITY DEFINER`): atomically claims the adjustment by setting `invoices.stock_adjusted = true WHERE id = p_invoice_id AND stock_adjusted = false`; if `NOT FOUND` (already adjusted), returns. Otherwise decrements `products.stock_quantity` by the summed `qty` per `product_id` across the invoice's line items (`GREATEST(0, ...)`).
- **`set_updated_at()`** shared trigger function.

### RLS policies (transcribe exactly)

Pattern used by `invoices`, `invoice_line_items`, `payments`, `sales_persons`, `sales_commissions`, `invoice_email_log`:

- **`*_admin_read`** — `FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM customers c WHERE c.id = auth.uid() AND c.role IN ('admin','assistant')))`
- **`*_admin_write`** — `FOR ALL TO authenticated USING (...c.role = 'admin') WITH CHECK (...c.role = 'admin')`

RLS is enabled on every table. Note: the API routes use the **service-role** key (which bypasses RLS), so RLS is the secondary defense for any direct-from-client reads; the role gate in each route handler is the primary one. `backorders`/`backorder_items` have RLS enabled with no policies (service-role only).

---

## API endpoints

All routes live under `app/api/admin/invoices/`. Each instantiates a **service-role** Supabase client (`createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`) and authenticates the caller from the `Authorization: Bearer <access_token>` header via `supabase.auth.getUser(token)`, then looks up the caller's `customers.role`. Audit logging goes through `logAuditServer()`.

> **AFFILIATE STRIPPED (applies to every route below):** each handler currently allows `role === 'affiliate'` and scopes results to the affiliate's bound customers (via `lib/admin/invoice-access.ts` helpers `affiliateCustomerIds`, `affiliateCanAccessInvoice`, and an `affiliateScope`/`affiliateOwnsInvoice` helper). When porting, **delete all affiliate branches** and reduce the role checks to: read = `admin`/`assistant`, write/create/delete/email/payments = `admin`. You can drop `lib/admin/invoice-access.ts` entirely (or keep just the `getInvoiceCaller` token→role resolver, which is generic).

### `GET /api/admin/invoices`
- **Auth:** admin or assistant (read).
- **Logic:** calls `mark_overdue_invoices()` first. Reads query params: `status` (a status or `all`), `customer_id`, `q` (search), `limit` (clamped 1–100), `offset`.
- **Search (`q`):** matches `invoice_number`, `customer_name`, `customer_email` via `ilike`, plus invoices whose `customer_id` is in the set of customers matching the term (`first_name`/`last_name`/`email ilike`), so linked-customer invoices (where name isn't denormalized) still match.
- **Page query** selects invoices with `customer:customers!customer_id (id, first_name, last_name, email, phone)`, `sales_person:sales_persons (id, first_name, last_name)`, `line_items:invoice_line_items (id)`, `payments (amount)`, ordered by `created_at DESC`, with `{ count: 'exact' }` and `.range(offset, offset+limit-1)`.
- **Per row it computes:** `amount_paid` (sum of payments), `amount_due = max(0, total - amount_paid)`, `status_effective` (via `effectiveStatus`), `customer_name_display`, `customer_email_display`, `sales_person_name`.
- **Aggregate `stats`** is a *second* query over the same status/scope filters (ignoring search + pagination): `{ count, outstanding, overdueCount, paid }`. `outstanding` sums `amount_due` for invoices whose status is not `paid` and not `draft`; `overdueCount` counts effective-overdue; `paid` counts `status === 'paid'`.
- **Response:** `{ invoices: InvoiceListItem[], total: number, stats: InvoiceStats }`.

### `POST /api/admin/invoices`
- **Auth:** admin only (`verifyAdmin(request, true)` → `canCreate(role)` which is `role === 'admin'`).
- **Request body (`InvoiceInput`):** `customer_id?`, `customer_name?`, `customer_email?`, `customer_phone?`, `order_id?`, `issue_date?`, `due_date?`, `tax_rate?` (default 0), `shipping_cost?` (default 0), `status?` (default `'draft'`), `notes?`, `sales_person_id?`, `sales_person_commission_rate?` (default 0), `line_items: [{ product_id, description, qty, unit_price, discount_pct }]` (required, ≥1).
- **Validation:** rejects empty `line_items` (400). Per line: `qty` finite & > 0, `unit_price` finite & ≥ 0 (throws → 500). Computes `line_total = qty * unit_price * (1 - discount_pct/100)` rounded to 2 dp.
- **Split-on-backorder:** loads current `stock_quantity` for all referenced `product_id`s, runs `computeStockSplit(cleaned, stockMap)` (`lib/admin/invoice-split.ts`). If nothing is backordered → inserts a single invoice (status as requested). Otherwise:
  1. If there are in-stock lines, insert a **primary** invoice (status as requested, shipping on it).
  2. Always insert a **backorder** invoice with the exceeding quantities: `status: 'draft'` (always — no stock decremented), `is_backorder: true`, `parent_invoice_id: primary?.id ?? null`, shipping `0` if a primary exists else the requested shipping.
  3. Insert a `backorders` row (`status: 'open'`) against the backorder invoice + `backorder_items` from the split detail.
- **Per inserted invoice** (`insertInvoice`): computes `subtotal`, `tax_total = subtotal * taxRate/100`, `total = subtotal + tax_total + shipping`, `commission_amount = total * commissionRate/100`; inserts the invoice, its line items, and (if `sales_person_id` set & commission > 0) a `sales_commissions` row (`status: 'pending'`). If `status === 'paid'`, calls `adjust_stock_for_invoice` RPC then `checkLowStockForProducts`. Writes an `invoice.create` audit entry.
- **Response:** `201` with `{ invoice }` (no split) or `{ invoice: primary ?? backInvoice, backorder_invoice, split: true }`.

### `GET /api/admin/invoices/:id`
- **Auth:** admin or assistant.
- Selects the invoice with `customer (*)`, `sales_person (*)`, `line_items (*)`, `payments (*)`. Computes `amount_paid`, `amount_due`, `status_effective`. `404` if not found. **Response:** `{ invoice }`.

### `PATCH /api/admin/invoices/:id`
- **Auth:** admin only.
- **Body:** any subset of `customer_id`, `customer_name`, `customer_email`, `customer_phone`, `issue_date`, `due_date`, `status`, `notes`, `sales_person_id`, plus `tax_rate`, `shipping_cost`, and optionally `line_items` (full replace).
- **Line items:** if `line_items` supplied, deletes all existing rows for the invoice and re-inserts the cleaned set (same validation as POST). For non-backorder invoices, calls `syncInvoiceBackorder` to recompute the OPEN backorder from new lines.
- **Totals:** recomputes `subtotal`/`tax_total`/`total` when items, `tax_rate`, or `shipping_cost` change.
- **Commission:** when salesperson/rate/totals change, deletes only **pending** `sales_commissions` for the invoice (never paid ones) and re-inserts if applicable.
- **Stock:** if `status` transitions to `paid` (and wasn't paid), calls `adjust_stock_for_invoice` + `checkLowStockForProducts`.
- Writes `invoice.update` audit entry. **Response:** `{ invoice }` (freshly re-selected with joins + derived fields).

### `DELETE /api/admin/invoices/:id`
- **Auth:** admin only (`canDelete`). Deletes the invoice (cascades to line items + payments). Writes `invoice.delete` audit. **Response:** `{ ok: true }`.

### `POST /api/admin/invoices/:id/payments`
- **Auth:** admin only (`canCreate`).
- **Body:** `{ amount, method, reference_note?, paid_at? }`. `amount` must be finite & > 0 (400). `method` must be in `card|e-transfer|cash|other` (400).
- **Overpayment guard:** loads invoice + existing payments; `due = total - paidSoFar`; if `amount > due + 0.001` returns **422** with `"Amount $X exceeds the $Y still due on this invoice"`.
- Inserts the payment (`recorded_by = userId`). Recomputes status: `paid` if `newPaidTotal + 0.001 >= total`, else `partial` if `> 0`. If newly `paid`, calls `adjust_stock_for_invoice` + low-stock check. Writes `invoice.payment` audit. **Response:** `201 { payment }`.

### `GET /api/admin/invoices/:id/pdf`
- **Auth:** admin or assistant (returns plain-text `Unauthorized`/`Not found` strings, not JSON).
- Query `?download=1` enables `autoPrint`. Selects invoice with full joins, builds **HTML** via `buildInvoiceHtml(inv, { autoPrint })` (`lib/admin/invoice-html.ts`), returns `text/html`. (The browser-facing "PDF" view/download is actually a print-optimized HTML page; `window.print()` fires when `download=1`.)
- **Note:** the *attached* PDF in emails is a true PDF rendered by `pdfkit` (`lib/invoice-pdf.ts`), not this HTML route.

### `POST /api/admin/invoices/:id/email`
- **Auth:** admin/assistant (`canEdit`? — actually gated by `canEdit(auth.role)`; in this app `canEdit === admin only`, so effectively **admin only**). `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.
- **Body:** `{ to?: string, bcc?: string[] }`. `to` overrides the recipient (falls back to invoice `customer_email`/`customer.email`); if no recipient resolvable → **400** `"No customer email on invoice. Provide a recipient."`. `bcc` (filtered to non-empty strings) **wins** when present; if omitted entirely, falls back to `site_settings.invoice_cc_emails`.
- Loads the invoice with full joins + `site_settings` template columns. Builds merge vars via `buildInvoiceMergeVars(...)` and renders subject/body for **customer** and **admin-copy** templates via `renderTemplate`.
- Renders the **PDF** (`renderInvoicePdf`) — on failure returns 500 with the error.
- Sends via **nodemailer** SMTP: one mail to the customer (`text` + `html` via `plainTextToHtml`, PDF attached as `<invoice_number>.pdf`). If `bccList` non-empty, sends a *separate* admin-copy mail `to: bccList` using the admin subject/body + same attachment (failure here is logged but non-fatal).
- Always inserts an `invoice_email_log` row (success or failure). On success, updates the invoice's `last_emailed_at`/`last_emailed_by`/`last_emailed_by_email` and bumps `status` from `draft`→`sent`. Writes `invoice.email_sent` audit. On failure returns **500** with the error.
- **Response:** `{ ok: true, to, bcc_count, message_id }`.

### `GET /api/admin/invoices/aging`
- **Auth:** admin or assistant.
- Calls `mark_overdue_invoices()`. Selects invoices `WHERE status != 'paid' AND status != 'draft'` (`total, due_date, status, customer_id, sales_person_id, payments(amount)`). For each, computes `due = total - paid`; skips if `due <= 0`. Buckets by `daysOverdue` (today − due_date): `< 1 → current`, `≤30 → 1-30`, `≤60 → 31-60`, `≤90 → 61-90`, else `90+`. **Response:** `{ buckets: [{ label, count, total }] }` in fixed order.

### Server helper — `autoCreateInvoiceFromOrder` (`lib/admin/invoices.ts`)
Idempotent helper (not an HTTP route) used by order-confirm flows: short-circuits if an invoice already exists for the order, else builds line items from `order_items` and inserts a draft invoice. Takes a caller-provided service-role client. (Ports over unchanged if you also port the orders module; otherwise omit.)

---

## Frontend

### Routes / pages
- **`app/(admin)/admin/invoices/page.tsx`** — list view (also hosts the Pricelists sub-tab, see Module 8).
- **`app/(admin)/admin/invoices/new/page.tsx`** — wraps `<InvoiceForm mode="create" />`.
- **`app/(admin)/admin/invoices/[id]/page.tsx`** — invoice detail (status, payments, email, delete, PDF).
- **`app/(admin)/admin/invoices/[id]/edit/page.tsx`** — loads the invoice, renders `<InvoiceForm mode="edit" invoiceId initial />`.

### Components
- **`components/admin/InvoiceForm.tsx`** — the builder (create + edit). Self-contained with internal `Card`/`Field`/`Row`/`Modal`/`ModalActions`/`ModalError` helpers.
- **`components/admin/MultiSelectCustomer.tsx`**, **`ProductToggleSelector.tsx`**, **`NumericStepper.tsx`** — generic selectors. (Used by the Pricing module; `InvoiceForm` uses its own inline pickers, not these.)

### State management
- **No React Query** for invoices despite `@tanstack/react-query` being installed. Everything uses local `useState`/`useEffect` and the thin fetch wrappers in `lib/admin/invoices.ts` (`getInvoices`, `getInvoice`, `createInvoice`, `replaceInvoice`, `updateInvoiceStatus`, `deleteInvoice`, `recordPayment`, `getAgingReport`). Those wrappers attach the bearer token from `supabase.auth.getSession()`.
- The current role comes from a React context: `useUserRole()` exported from `app/(admin)/admin/layout.tsx` (a `UserRoleContext` provider). Permission helpers live in `lib/permissions.ts`.

### Data flow
1. **List:** debounced search (300 ms) + status filter + page → `getInvoices({status,q,limit,offset})` → renders rows + stats; aging is fetched once. PDF buttons fetch the PDF route with the bearer token, blob it, and `window.open` it.
2. **Create/Edit:** `InvoiceForm` loads active products (`supabase.from('products').eq('active',true)`) and the active pricelist (`getActivePricelist()`); on submit calls `createInvoice` (→ on split, routes to `/admin/backorders`; else to the new invoice) or `replaceInvoice`.
3. **Detail:** `getInvoice(id)`; status edit / payment / email / delete go through the lib wrappers / fetch and then `refresh()`.

---

## UI/UX specification

Design tokens (Tailwind theme): `ink` (near-black text), `ink-muted`, `vital` (accent gold `#438B9E`-ish), `surface` (light bg), `line` (border). Status badge colors come from `INVOICE_STATUS_META` (`lib/admin/invoice-status.ts`).

### Status badges (`INVOICE_STATUS_META`)
| Status | Label | Badge classes | PDF bg / fg |
|---|---|---|---|
| `draft` | Draft | `bg-gray-500/10 text-gray-600` | `#F3F4F6` / `#4B5563` |
| `sent` | Sent | `bg-blue-500/10 text-blue-600` | `#DBEAFE` / `#1E40AF` |
| `partial` | Partial | `bg-amber-500/10 text-amber-600` | `#FEF3C7` / `#92400E` |
| `paid` | Paid | `bg-emerald-500/10 text-emerald-600` | `#D1FAE5` / `#065F46` |
| `overdue` | Overdue | `bg-red-500/10 text-red-600` | `#FEE2E2` / `#991B1B` |

`effectiveStatus(status, due_date)`: if status is `sent` or `partial` and `due_date < today` → renders as `overdue` (virtual, computed client- and server-side; the row's effective status drives the badge and the red "Due" date).

### List page (`/admin/invoices`)
- **Tabs** at top (bottom-border style): **Invoices** (FileText icon) and **Pricelists** (Tag icon). Active tab uses `border-vital text-vital`.
- **Header:** `Invoices` (FileText, vital) + sub-line `"{n} invoice(s)"`. Right side buttons: **Aging** toggle (BarChart2 icon; active state `bg-vital/10 border-vital text-vital`) and **New Invoice** (Plus, dark `bg-ink` button) linking to `/admin/invoices/new`.
- **Stats cards** (grid, 2 cols mobile / 4 desktop): **Total** (count), **Outstanding** (`$x.xx`, vital highlight border), **Overdue** (count; red when > 0), **Paid** (count).
- **Aging panel** (toggled): heading **"Accounts Receivable Aging"**; 5 cells (`current`, `1-30`, `31-60`, `61-90`, `90+`) each showing `$total` and `"{n} inv."`; a right-aligned **"Grand total: $x.xx"**.
- **Toolbar:** search input (Search icon) `"Search by invoice # or customer..."`; status `<select>` (Filter icon) with `All Statuses` + each status label.
- **Table** (min-width 720px, horizontal scroll on mobile): columns **Invoice, Customer, Issue, Due, Total, Status, (actions)**.
  - Invoice cell: mono invoice number (links to detail); a `Backorder` pill (`bg-amber-100 text-amber-700`) appears when `is_backorder`.
  - Customer: name + email below.
  - Due: red+bold when the row is effectively overdue.
  - Total: `$x.xx`, bold tabular.
  - Status: badge with effective-status meta.
  - Actions: three icon buttons — **View** (ExternalLink → detail), **View PDF** (FileText → opens PDF), **Download / Print** (Download → opens PDF with `?download=1`).
- **Loading:** 8 `SkeletonRow`s (animate-pulse gray bars matching each column).
- **Empty:** if filters active → `"No invoices match your filters"`, else `"No invoices yet"`.
- **Pagination footer** (when not loading and total > 0): `"Showing X–Y of Z"`, `"Page p of n"`, **Prev** (ChevronLeft) / **Next** (ChevronRight) buttons (disabled at ends, `opacity-40`). `PAGE_SIZE = 20`.

### New / Edit (`InvoiceForm`)
Two-column layout (left = 2/3, right = 1/3). Field input class: `bg-surface border border-line rounded-lg ... focus:ring-vital/40`.

**Left column cards:**
- **Invoice Details** (User icon):
  - *Customer* picker: if linked, a vital-tinted chip with avatar, name, email, an `emerald` "Linked" pill, and a **Change** button. If not linked, a search input `"Search customers or type a name for a guest invoice..."` with a dropdown of matches; the bottom row offers **`Create new customer "<query>"`** (UserPlus, vital). When a query is typed with no selection, a hint shows: *`"<query>" will be saved as the customer name (guest invoice).`*
  - *Issue Date* / *Due Date* date inputs (Due defaults to today + 30 days).
- **Sales Person** (Briefcase icon): if selected, a purple chip showing name + `"Commission $x.xx (r%)"` and a **Change** button. Otherwise a search `"Search salespeople..."` with results (name, email · rate%) and a **`Create new salesperson "<query>"`** option (purple). Below: **Commission %** input and a read-only **Commission $** display.
- **Line Items** (no icon): a helper line — if an active pricelist exists: *`Prices default from active pricelist <name> (editable per line).`*; else *`No active pricelist — using product default prices.`* Each line is a bordered `surface` card with a 12-col grid:
  - Description / product search input (`"Description / search products..."`). Typing shows a product dropdown (name; sub-line `strength · $price · stock N`). Selecting fills description (`name — strength`), `unit_price` from `priceForProduct`, and stock.
  - **Stock badge** under the input: `stock: N` colored **red** (`<= 0`), **amber** (`< 5`), or **emerald** (`>= 5`). If the qty for that product exceeds stock, an amber soft-warning **`Only N in stock — will backorder`** appears. Admins also get a **`Quick edit`** link (Pencil) next to the badge.
  - **Qty** (min 1; gets amber border + ring when over stock), **Unit $**, **Disc %**, line total `$x.xx`, and a trash icon to remove the line.
  - **`+ Add another item`** dashed button.
- **Notes** card: textarea `"Internal notes shown on the invoice (optional)"`.

**Right column:**
- **Summary** card: **Tax Rate (%)** + **Shipping ($)** inputs, then a live breakdown: Subtotal, `Tax (r%)`, Shipping, **Total** (bold).
- **Action buttons:**
  - Create mode: **Create & Send** (dark, check icon) and **Save as Draft** (white).
  - Edit mode: **Save Changes** (dark, save icon) and **Cancel** (back to detail).
- Inline error box (red) under the buttons when submit validation/server fails.

**Validation / messages:**
- `"Add at least one line item"` if every line description is blank.
- Quick stock: `"Enter a valid stock quantity (0 or more)"`.
- New customer modal: `"Enter a name or email for the new customer"`; new salesperson modal: `"First and last name are required for the salesperson"`.

**Modals (shared `Modal`/`ModalActions` look — dark overlay, white rounded card):**
- **New Customer** (emerald accent): First name*, Last name*, Email, Phone → **Create Customer**. (Created via the service-role admin API `createCustomer`, because the `customers` table has no client INSERT policy.)
- **New Salesperson** (purple accent): First*, Last*, Email, Phone, Commission % → **Create Salesperson**.
- **Quick edit stock** (emerald): copy *`Update on-hand stock for <name>. This changes the product's inventory immediately.`*; stock number input (Enter submits) → **Save stock**. Calls `PUT /api/admin/products/:id { stock_quantity }`, then patches the local product + all lines using it.
- **Backorder confirmation** (emerald): shown when submitting a "sent" (or editing a non-draft) invoice while a line exceeds stock. Copy: *`One or more line items exceed available stock. Sending this invoice now will create a backorder.`* + an amber list of `"<desc> — Only N in stock — will backorder"`. Button **Send and backorder** (dark). Drafts skip this (drafts always allow over-stock). On a real split, the user is redirected to `/admin/backorders`.

### Detail page (`/admin/invoices/[id]`)
- **Header:** back arrow, mono invoice number, `"Issued <date> · Due <date>"`. Action buttons (when viewable): **View PDF** (FileText), **Download** (Download), **Edit** (Edit2 → edit page), **Send Email** (vital, Send icon — admin only), **Record Payment** (emerald, DollarSign — admin only, hidden when paid).
- **Left:** line-items table (Description, Qty, Unit $, Disc, Total) with a footer: Subtotal, `Tax (r%)`, Shipping, **Total**, `Paid` (− amount, when any), **Amount Due** (vital). Below: **Payment History** card (method, optional `· reference`, timestamp, green amount) when payments exist. Bottom: **Delete invoice** (admin only) — inline confirm copy `"Delete this invoice and its line items + payments?"` with **Confirm delete** (red) / **Cancel**.
- **Right (SideCards):**
  - **Status** card: badge + Pencil to edit; editing shows a `<select>` (all status labels) + check (apply) / X (cancel). If applying `paid` will decrement stock, an amber note: *`Marking this paid will reduce stock for N product(s).`* Success toast (inline emerald box): *`Status updated — product stock has been reduced.`* or *`Status updated.`* (auto-clears after 5 s); error → red box.
  - **Customer** card (name/email/phone).
  - **Sales Person** card (when set): name + purple `"Commission $x.xx (r%)"`.
  - **Email** card: if sent, an emerald "Sent" pill (Mail icon) + timestamp + `"by <email>"`; else `"Not sent yet"`.
  - **Dates** card (Issue / Due; Due red when overdue).
  - **Notes** card (when present, preserves whitespace).
- **Mark-paid stock confirm modal:** title **"Confirm payment & stock update"** (AlertCircle amber); lists each stock-affected line with `− qty`; copy *`Marking <invoice_number> as paid will reduce inventory for the following product(s):`*; buttons **Cancel** / **Mark paid & reduce stock** (emerald).
- **Send email modal:** title **"Send invoice email"** (Send, vital).
  - **To** input (prefilled from customer email; editable — supports a one-off recipient).
  - **"Also send a copy to (BCC)"**: lists configured copy recipients as checkboxes (all checked by default); ad-hoc additions are tagged **`one-off`** with an X to remove. If none configured: *`No admin copy recipients configured. Add some or paste one below to send just for this email.`* A row to **Add another email (won't be saved)** (Enter or **Add** button); errors `"Invalid email format"` / `"Already in the list"`. Helper: *`Configured under Settings → Invoice Emails. Adding here only affects this send.`*
  - **Template preview** (rendered with this invoice's merge vars): a card showing Subject, the body (whitespace-preserved, scrollable), and a footer `📎 <invoice_number>.pdf (attached)`. While loading: *`Loading template…`*. Helper link: *`Edit the template under Settings → Email templates.`*
  - Error (red) / success (green: `"Sent to <to> (+N copy)"`) boxes; **Cancel** / **Send** (vital). Modal auto-closes ~1.2 s after success.
- **Payment modal:** title **"Record Payment"** (emerald). **Amount** (number, prefilled to amount due, placeholder = due, helper `"Outstanding: $x.xx"`), **Method** select (Card / E-Transfer / Cash / Other), **Reference (optional)** (`"Txn ID / cheque #"`). Validation `"Enter a payment amount"`; server overpayment error surfaces in the red box. **Cancel** / **Record Payment** (emerald).

### PDF / printable invoice
- **HTML route** (`buildInvoiceHtml`) is the on-screen "View PDF"/print page: A4, brand `VYTA` + `aminocan.com · info@aminocan.com`, right-side `Invoice` + mono number + status pill (uses `pdfBg`/`pdfFg`), **Bill To** + optional **Sales Person**, a dates strip (Issue / Due / Invoice #), an items table (Description, Qty, Unit Price, Disc %, Total), totals (Subtotal, `Tax (r%)`, Shipping, **Total**, optional `Paid − $`, **Amount Due** in vital), optional **Payment History**, optional **Notes**, footer `"Thank you for your business."` + `"Generated <datetime>"`. When `?download=1`, JS auto-calls `window.print()`.
- **True PDF** (`renderInvoicePdf`, pdfkit) mirrors that layout (A4, 50pt margins, Helvetica/Courier fonts, vital `#438B9E` amount-due, status pill via rounded rect) and is what's attached to emails.

### Email templates & merge vars (`lib/invoice-email-templates.ts`)
Defaults (also seeded in DB):
- **Customer subject:** `Your Aminocan invoice {{invoice_number}}`
- **Customer body:** `Hi {{customer_first_name}},\n\nThanks again for your order. Your invoice {{invoice_number}} is attached as a PDF — the total is ${{invoice_total}} {{currency}}, due {{due_date}}.\n\nIf anything looks off, just reply to this email and we'll sort it out.\n\n— Aminocan`
- **Admin-copy subject:** `[Copy] Invoice {{invoice_number}} sent to {{customer_email}}`
- **Admin-copy body:** lists Total, Amount due, Due date, Sent by + `PDF attached.`

Merge vars (`MERGE_VARS`, with sample values): `customer_name`, `customer_first_name`, `customer_last_name`, `customer_email`, `invoice_number`, `invoice_total`, `amount_due`, `amount_paid`, `due_date`, `issue_date`, `currency` (`CAD`), `sent_by_email`, `company_name` (`Aminocan`). `renderTemplate` replaces `{{var}}` (case-insensitive, whitespace-tolerant); unknown vars are left as `{{var}}`. `plainTextToHtml` wraps the body in a `white-space: pre-wrap` div with HTML escaping.

---

## Dependencies

- **npm:** `@supabase/supabase-js`, `next` (15, App Router), `nodemailer` (+ `@types/nodemailer`), `pdfkit` (+ `@types/pdfkit`), `lucide-react` (all icons), `tailwindcss`. (`@tanstack/react-query` is installed but **not** used here.)
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (every route), and SMTP for emailing: `SMTP_HOST` (default `smtp.protonmail.ch`), `SMTP_PORT` (default `587`, non-secure/STARTTLS), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_NAME` (default `Aminocan`), `SMTP_FROM_EMAIL` (falls back to `SMTP_USER` then `info@aminocan.com`). (The `.env.example` also lists Resend vars, but invoice email uses **nodemailer/SMTP**, not Resend.)
- **Internal modules relied on:**
  - `lib/permissions.ts` (`canCreate`/`canEdit`/`canDelete`/`canViewInvoices`/`canEditInvoice`).
  - `lib/admin/audit.ts` (`logAuditServer`) → requires the `audit_log` table (`audit-log-migration.sql`).
  - `lib/admin/low-stock.ts` (`checkLowStockForProducts`) → needs `products.low_stock_threshold` / `low_stock_alerted`, `site_settings.admin_emails`, and `lib/email-smtp.ts`'s `sendLowStockAlert`.
  - `lib/admin/backorder-sync.ts` + `backorders`/`backorder_items` tables.
  - `lib/admin/sales-persons.ts` (`searchSalesPersons`, `createSalesPerson`) and `lib/admin/api.ts` (`createCustomer`) for the form's quick-create flows.
  - `products` table (for catalog, prices, stock) and `customers` table (for role lookups + linking).
  - `useUserRole()` from `app/(admin)/admin/layout.tsx`.
- **Cross-module:** see **Module 8 — Pricing & Pricelists** (`getActivePricelist()` provides default line prices). The split flow writes into the **Backorders** module; marking paid touches **Products** stock; the email feature reads **Settings** (`site_settings`).

---

## Porting notes

**What to strip (affiliate):**
1. Delete every `role === 'affiliate'` branch in all five route files (`route.ts`, `[id]/route.ts`, `[id]/email/route.ts`, `[id]/payments/route.ts`, `[id]/pdf/route.ts`, `aging/route.ts`). Collapse the role gates to admin/assistant (read) and admin (write/create/delete/email/payments).
2. Remove `lib/admin/invoice-access.ts`'s affiliate helpers (`affiliateCustomerIds`, `affiliateCanAccessInvoice`) and the in-route `affiliateScope`/`affiliateOwnsInvoice` helpers. You may keep a trimmed `getInvoiceCaller` (token→{id, role}) or inline it.
3. In `lib/permissions.ts`, simplify `canViewInvoices` → `admin || assistant` and `canEditInvoice` → `admin`. Drop the `affiliate` role from `UserRole` if the target app has no affiliates.
4. In `InvoiceForm.tsx`, remove `isAffiliate`, `boundCustomers`, `salesLocked`, the `/api/affiliate/me` + bound-customer preload effect, and the affiliate-only customer-filtering branch. The form then always queries all active customers and lets you pick/clear a salesperson freely.
5. In the list/detail pages remove affiliate considerations from `canSeeAging` and the role-derived flags (aging becomes admin/assistant only; edit/email/payments admin only). Drop `sales_persons.user_id` (affiliate-only).

**Gotchas:**
- The "PDF" the user opens from the UI is **HTML** (`/pdf` route); the **emailed** PDF is a real pdfkit PDF. Keep both code paths — they share `INVOICE_STATUS_META` colors.
- `pdfkit` needs `runtime = 'nodejs'` (already set on the email route). It bundles its own AFM fonts; on some serverless platforms you may need to ensure the `pdfkit` font data ships (test the build).
- Invoice numbers come from a DB **sequence default**, not app code — create `invoice_number_seq` before the table.
- Stock decrement is **idempotent via `stock_adjusted`** + the RPC's atomic claim. Don't decrement in app code; always call `adjust_stock_for_invoice`.
- `mark_overdue_invoices()` is a sweep, but the UI/API never trusts it alone — it also computes `status_effective` live. Port both.
- The overpayment guard returns **422** (not 400); the UI surfaces the exact server message.
- Email send uses **two separate `sendMail` calls** (customer, then admin-copy/BCC) so the admin copy uses different subject/body — it's intentionally not a true BCC header.

**Suggested order of implementation:**
1. SQL: `set_updated_at()` + `invoice_number_seq` + `invoices` / `invoice_line_items` / `payments` + RLS + `mark_overdue_invoices()`. Then `stock-decrement-migration.sql` (`adjust_stock_for_invoice`).
2. `sales_persons` / `sales_commissions` (+ the three `invoices` columns).
3. `backorders` / `backorder_items`, then the split columns (`is_backorder`, `parent_invoice_id`).
4. `site_settings` invoice-email columns + `invoice_email_log`.
5. `lib/admin/invoice-status.ts`, `invoice-split.ts`, `invoice-html.ts`, `lib/invoice-pdf.ts`, `lib/invoice-email-templates.ts`, `lib/admin/invoices.ts`.
6. API routes (admin-only), then the list page, `InvoiceForm`, detail page, edit page.
7. Wire up dependencies: pricelists (Module 8), products/stock, settings, audit log.
