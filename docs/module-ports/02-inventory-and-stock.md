# Module 2 — Inventory & Stock

This module covers everything related to keeping product stock levels accurate and reacting when they run low or out. It bundles five related features: (1) **low-stock alerts** with a per-product threshold (default 10) editable inline on the Products page, an admin email when stock crosses the threshold, a dashboard list, and a nav badge; (2) the **backorder workflow** — when an invoice orders more than the available stock, the shortfall is split off and recorded as a backorder that admins fulfil by raising a purchase order; (3) the **stock-notification waitlist** ("Notify me when back in stock") with a customer-facing dialog, an admin "Stock Requests" view, and automatic emails on restock; (4) the **restock confirmation dialog** that warns the admin before a restock fires waitlist emails; and (5) **stock decrement on payment** — confirmed crypto orders and fully-paid invoices atomically reduce `stock_quantity` once (idempotent). Stock-affecting events also re-evaluate low-stock alerts and (for invoices) backorders.

> NOTE ON AFFILIATES: This app has an Affiliate program that is NOT being ported. Backorders and Stock Requests are explicitly admin/assistant-only tools (the API comment reads "Backorders are an admin/assistant tool — hidden from affiliates"). All staff checks below are described as **admin/assistant** with no affiliate branch. The shared `UserRole` type still includes `'affiliate'`; you can drop that member when porting.

---

## Data model

All migrations are idempotent ("safe to run multiple times").

### `products` — added columns (`low-stock-alerts-migration.sql`, `stock-decrement-migration.sql`)

The base `products` table already exists in the catalog module. This module adds:

| Column | Type | Default | Constraints / notes |
|---|---|---|---|
| `low_stock_threshold` | `integer` | `10` | `NOT NULL`. Backfilled to 10 for existing rows. Index `idx_products_low_stock`. "Stock level at/below which a low-stock alert fires." |
| `low_stock_alerted` | `boolean` | `false` | `NOT NULL`. Dedupe flag: true once an alert was sent, reset when stock rises above threshold. |
| `stock_adjusted` | (added on `orders` / `invoices`, not products — see below) | | |

`stock_quantity` (integer) is the live stock column, defined in the catalog schema and decremented/incremented by this module.

### `orders` & `invoices` — added column (`stock-decrement-migration.sql`)

| Table | Column | Type | Default | Notes |
|---|---|---|---|---|
| `orders` | `stock_adjusted` | `boolean` | `false` | `NOT NULL`. Idempotency flag so stock is decremented at most once per order. |
| `invoices` | `stock_adjusted` | `boolean` | `false` | `NOT NULL`. Same, per invoice (survives paid→unpaid→paid toggles). |

### `invoices` — added columns for split backorders (`invoice-split-backorder-migration.sql`)

| Column | Type | Default | Notes |
|---|---|---|---|
| `is_backorder` | `boolean` | `false` | `NOT NULL`. True when this invoice holds the exceeding-stock portion of a split invoice. Index `idx_invoices_is_backorder`. |
| `parent_invoice_id` | `uuid` | `null` | `REFERENCES invoices(id) ON DELETE SET NULL`. For a backorder invoice, the primary invoice it was split from. Index `idx_invoices_parent`. |

### `backorders` (`backorders-migration.sql`)

| Column | Type | Default | Constraints |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | PK |
| `invoice_id` | `uuid` | — | `NOT NULL REFERENCES invoices(id) ON DELETE CASCADE` |
| `status` | `text` | `'open'` | `NOT NULL CHECK (status IN ('open','fulfilled','cancelled'))` |
| `purchase_order_id` | `uuid` | — | `REFERENCES purchase_orders(id) ON DELETE SET NULL` |
| `created_at` | `timestamptz` | `now()` | `NOT NULL` |
| `fulfilled_at` | `timestamptz` | — | set when fulfilled |

Indexes: `idx_backorders_status (status)`, `idx_backorders_invoice (invoice_id)`.

### `backorder_items` (`backorders-migration.sql`)

| Column | Type | Default | Constraints |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | PK |
| `backorder_id` | `uuid` | — | `NOT NULL REFERENCES backorders(id) ON DELETE CASCADE` |
| `product_id` | `uuid` | — | `REFERENCES products(id) ON DELETE SET NULL` |
| `description` | `text` | — | `NOT NULL` |
| `qty_ordered` | `numeric` | — | `NOT NULL` |
| `qty_available` | `numeric` | — | `NOT NULL` (stock at time of split) |
| `qty_backordered` | `numeric` | — | `NOT NULL` (the shortfall) |
| `unit_price` | `numeric` | `0` | `NOT NULL` |
| `created_at` | `timestamptz` | `now()` | `NOT NULL` |

Index: `idx_backorder_items_backorder (backorder_id)`.

**RLS:** Both `backorders` and `backorder_items` have RLS **enabled with NO policies** — all access is via the service role in API routes; anon/auth clients cannot read/write directly.

### `stock_notifications` (`stock-notifications-migration.sql`)

| Column | Type | Default | Constraints |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | PK |
| `product_id` | `uuid` | — | `NOT NULL REFERENCES products(id) ON DELETE CASCADE` |
| `customer_id` | `uuid` | — | `REFERENCES customers(id) ON DELETE SET NULL` |
| `email` | `text` | — | `NOT NULL` (stored lower-cased by the API) |
| `status` | `text` | `'pending'` | values used: `'pending' | 'notified' | 'cancelled'` (no CHECK constraint, just a comment) |
| `created_at` | `timestamptz` | `now()` | |
| `notified_at` | `timestamptz` | — | set when emailed |

Indexes:
- `uniq_stock_notifications_pending` — **UNIQUE** on `(product_id, email) WHERE status = 'pending'`. One active request per product/email; case-insensitive because emails are lower-cased.
- `idx_stock_notifications_product` on `(product_id) WHERE status = 'pending'`.
- `idx_stock_notifications_status` on `(status)`.

**RLS:** Not enabled by this migration; access is via service-role API routes only.

### Postgres functions (`stock-decrement-migration.sql`)

- **`adjust_stock_for_order(p_order_id uuid)`** — `SECURITY DEFINER`. Atomically claims the adjustment (`UPDATE orders SET stock_adjusted=true WHERE id=... AND stock_adjusted=false`; returns early if not found / already done), then decrements `products.stock_quantity` by the summed `order_items.quantity` per product. `order_items.product_id` is TEXT, so it is cast to uuid with a regex guard against non-uuid/null values. Uses `GREATEST(0, ...)` so stock never goes negative.
- **`adjust_stock_for_invoice(p_invoice_id uuid)`** — same pattern using `invoice_line_items` (whose `product_id` is already uuid, summing `li.qty`).

---

## API endpoints

### Customer-facing — `app/api/stock-notifications/route.ts`

Uses the **service-role** Supabase client. No auth required (public). `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/`.

- **GET `/api/stock-notifications?product_id=&email=`** — Is this email already on the waitlist?
  - 400 `{ error: "product_id and email are required" }` if either missing.
  - Email trimmed + lower-cased; if it fails the regex, returns `{ subscribed: false }` (no error).
  - Looks up a `pending` row for `(product_id, email)`. Returns `{ subscribed: boolean }`.

- **POST `/api/stock-notifications`** — Subscribe. Body `{ product_id, email, customer_id? }`.
  - 400 if product_id/email missing; 400 `{ error: "Please enter a valid email address" }` if regex fails.
  - 404 `{ error: "Product not found" }` if product doesn't exist.
  - Idempotent: if a pending row already exists → `{ success: true, alreadySubscribed: true }`.
  - Inserts `{ product_id, customer_id, email, status: 'pending' }`. On unique-index race (`code === '23505'`) → `{ success: true, alreadySubscribed: true }`. Other errors → 500 `{ error: "Could not save your request" }`. Success → `{ success: true }`.

- **DELETE `/api/stock-notifications`** — Customer removes their own alert. Body `{ product_id, email }`.
  - Same validation as POST.
  - `UPDATE ... SET status='cancelled' WHERE product_id, email, status='pending'`. Error → 500 `{ error: "Could not remove your alert" }`. Success → `{ success: true }`.

### Admin — `app/api/admin/stock-notifications/route.ts`

Service-role client. `verifyAdminRole` requires Bearer token → `auth.getUser` → `customers.role IN ('admin','assistant')`, else 403 `{ error: "Unauthorized" }`.

- **GET `/api/admin/stock-notifications`** (no params) — Waitlist aggregated per product. Selects pending rows joined to `products(name, slug, image_url, price, stock_quantity)`, aggregates in memory into `{ product_id, name, slug, image_url, price, stock_quantity, count, latest_request }`, sorted by `count` desc. Returns `{ products, totalRequests }`.
- **GET `/api/admin/stock-notifications?product_id=<id>`** — pending waitlist for one product (used by the restock confirmation dialog). Returns `{ emails: string[], count }` ordered oldest first.

### Admin — `app/api/admin/backorders/`

All use service-role client + `requireStaff` (Bearer → `auth.getUser` → role IN admin/assistant), else 403 `{ error: "Unauthorized" }`.

- **GET `/api/admin/backorders?status=open|fulfilled|cancelled`** (default `open`; invalid → `open`). Selects backorders for that status, joined to invoice (`invoice_number, customer_name, customer_email, total, status, created_at` + `customers(first_name,last_name,email)`), `backorder_items(*)`, and `purchase_orders(id, po_number, status)`. Computes per row: `customer_name_display`, `customer_email_display`, `item_count`, `total_backordered` (sum of `qty_backordered`). Returns `{ backorders }`. Error → 500.
- **GET `/api/admin/backorders/[id]`** — single backorder with `invoice(id, invoice_number)` and items; used to prefill a PO draft. 404 `{ error: "Not found" }` if missing. Returns `{ backorder }`.
- **GET `/api/admin/backorders/count`** — `{ count }` of OPEN backorders (nav badge). Uses `head: true, count: 'exact'`.

### Admin — `app/api/admin/products/[id]/route.ts` (PUT, the inline-edit + restock trigger)

The product update route is part of the catalog module, but it carries the inventory wiring:
- Accepts `stock_quantity` and `low_stock_threshold` (among others). Validates `stock_quantity >= 0` and, if provided, `low_stock_threshold` must be a number `>= 0` (or null).
- After a successful update, if the product **was out of stock** (`!existing.stock_quantity || <= 0`) and **is now in stock** (`stock_quantity > 0`), calls `notifyWaitlist(productId, product)` — emails every `pending` `stock_notifications` row via `sendBackInStockNotification`, then marks the successfully-sent rows `status='notified', notified_at=now()`. Best-effort (wrapped in try/catch).
- Always calls `checkLowStockForProducts(supabase, [id])` afterward (best-effort).
- Auth: `verifyAdminRole(request, true)` — mutation requires `canCreate(role)` which is **admin only**.

### Stock-decrement call sites (not new routes — existing payment flows)

These existing routes were extended to call the RPCs + low-stock re-check after a payment settles:
- `app/api/orders/check-payment/route.ts` and `app/api/cron/check-payments/route.ts`: on confirmed crypto order → `db.rpc('adjust_stock_for_order', { p_order_id })`, then `checkLowStockForProducts` on the order's product ids.
- `app/api/admin/invoices/[id]/payments/route.ts`, `app/api/admin/invoices/[id]/route.ts`, `app/api/admin/invoices/route.ts`: when an invoice becomes fully paid → `supabase.rpc('adjust_stock_for_invoice', { p_invoice_id })`, then `checkLowStockForProducts`.
- `app/api/admin/invoices/[id]/route.ts` also calls `syncInvoiceBackorder(...)` when invoice line items change.

---

## Frontend

State management is **local React state** (`useState`/`useEffect`) plus the shared `supabase` client. No React Query. Some admin lists use a `useSmartLoad(fn, deps)` hook that returns `{ data, loading, slow, error, reload }` and surfaces `<SlowLoadingNotice>` / `<LoadingError>`.

### Routes / pages

| Route | File | Purpose |
|---|---|---|
| `/admin/backorders` | `app/(admin)/admin/backorders/page.tsx` | Open / History tabs of backorders; "Fulfill" jumps to PO creation. |
| `/admin/stock-requests` | `app/(admin)/admin/stock-requests/page.tsx` | Waitlist per product, most-requested first. |
| `/admin/products` | `app/(admin)/admin/products/page.tsx` | Inline edit of stock + threshold; restock confirmation modal. |
| `/admin` (dashboard) | `app/(admin)/admin/page.tsx` | Low-stock list via `getLowStockProducts()`. |
| Storefront product card / detail | `components/NotifyMeButton.tsx` | "Notify me" dialog. |

### Components

- **`components/NotifyMeButton.tsx`** — client component, props `{ productId, productName, variant?: 'compact'|'full', className? }`. Uses `useCustomer()` to prefill the logged-in email. Local state: `open`, `email`, `subscribed`, `busy: null|'checking'|'subscribing'|'removing'`, `justSubscribed`, `justRemoved`, `errorMsg`. On open it prefills `customer.email` and GETs subscription status; POST subscribes, DELETE removes. Locks body scroll while open.
- **Admin layout** (`app/(admin)/admin/layout.tsx`) — nav items include `{ href: '/admin/backorders', label: 'Backorders', icon: PackageX }` and `{ href: '/admin/stock-requests', label: 'Stock Requests', icon: Bell }`. Two badge effects (admin/assistant only, re-run on `pathname`): backorder count via GET `/api/admin/backorders/count`; low-stock count via `getLowStockProducts().length`.

### Data flow notes

- Products page inline edits PUT `/api/admin/products/[id]` with a single field, optimistically updating local `products` state. Restock-with-waitlist is intercepted **client-side first**: before committing it fetches the waitlist (`fetchWaiters` → admin GET with `product_id`), and if non-empty shows the confirmation modal whose confirm callback runs the queued save. The server independently sends the emails on the 0→positive transition.

---

## UI/UX specification

Design tokens (Tailwind custom colors): `ink` (near-black text), `ink-muted` (grey), `vital` (accent ~`#438B9E`), `surface` (very light grey bg), `line` (border `#D5E2E7`), `white`. Cards are `bg-white rounded-xl border border-line`. Tables are wrapped in an overflow-x-auto container; headers `text-xs font-semibold text-ink-muted uppercase tracking-wider`.

### Backorders page (`/admin/backorders`)

- **Header:** `<PackageX>` vital icon + "Backorders" (text-xl/2xl bold). Subtitle: "Invoice line items ordered beyond available stock."
- **Tabs:** underline tabs `Open` and `History` (the `'fulfilled'` tab labelled **History**). Active tab `border-vital text-vital`.
- **Table** (`min-w-[820px]`) columns: `Invoice`, `Customer`, `Backordered items`, `Invoice total`, `Invoice status`, then `Created` (Open tab) or `Fulfilled` (History tab), then an unlabeled action column.
  - Invoice: monospace `invoice_number` link to `/admin/invoices/{id}` (hover vital), or `—`.
  - Customer: name + email (muted, break-all), or `—`.
  - Backordered items: "`N items · M units`" (pluralized) and a muted comma-joined summary `description ×qty_backordered`.
  - Invoice total: `$0.00` bold tabular, or `—`.
  - Invoice status: badge styled by `INVOICE_STATUS_META[status]` (`.badge` class + `.label`).
  - Date: `toLocaleDateString()` (Created uses `created_at`; History uses `fulfilled_at` or `—`).
  - Action: **Open tab** → dark "Fulfill" button (`<Wrench>` icon) → `router.push('/admin/purchase-orders/new?backorder={id}')`. **History tab** → if a PO is linked, a surface "{po_number}" link (`<ClipboardList>`) to the PO; else muted "PO removed" (`<ExternalLink>`).
- **Loading:** single row, colspan 7, centered spinner "Loading…".
- **Empty:** Open tab → "No open backorders 🎉"; History → "No fulfilled backorders yet".

### Stock Requests page (`/admin/stock-requests`)

- **Header:** `<Bell>` vital + "Stock Requests". Subtitle: "Products customers are waiting on. Most-requested first — restock a product and everyone on its list is emailed automatically."
- **Two summary cards** (2-col grid, shown when not loading/erroring): big number `products.length` "Products with requests"; big number `totalRequests` "Total people waiting".
- **Table** (`min-w-[700px]`) columns: `Product`, `Waiting`, `Current Stock`, `Latest Request`, (right) unlabeled.
  - Product: 40px image thumbnail (or `<Beaker>` placeholder), name (fallback "Unknown product"), `$price` muted.
  - Waiting: pill `bg-vital/10 text-vital` with `<Bell>` + count.
  - Current Stock: `{n} in stock` (emerald) if `stock_quantity > 0`, else "Out of stock" (red).
  - Latest Request: `toLocaleDateString()`.
  - Action: right-aligned link to `/admin/products` — `<Package>` "Restock" `<ArrowRight>`.
- **Loading:** 6 skeleton rows (pulsing thumbnail + two bars + pill); a `<SlowLoadingNotice>` if slow.
- **Empty:** centered `<Bell>` in a circle, "No requests yet", "When customers ask to be notified about out-of-stock products, they'll show up here."
- **Error:** `<LoadingError onRetry={reload} />`.

### Products page — inline stock / threshold cells

Two adjacent table cells per product (only editable when `canEdit`, i.e. admin):
- **Stock cell:** click value → number input (`min=0`, autoFocus). Save on blur or Enter; Escape cancels. While saving: spinner + value. Color of the value: `stock_quantity > 10` emerald, `> 0` amber, `0` red. Hover shows a small `<Pencil>` and dashed underline; tooltip "Click to edit stock".
- **Low-stock threshold cell:** same inline-edit interaction. Displays "`≤ {low_stock_threshold ?? 10}`". Amber when `stock_quantity <= threshold`, else muted. Tooltip "Click to edit low-stock alert threshold".
- The product **create/edit modal** has matching fields: a "Stock Quantity" number input and a "Low Stock Threshold" number input defaulting to `'10'` (empty input → defaults to 10 on submit).

### Restock confirmation modal (Products page)

Shown when a save would take a product from out-of-stock to in-stock **and** there is a non-empty waitlist (both inline-edit and modal-edit paths trigger it). z-index `z-[60]`, `bg-black/50` backdrop, white `rounded-xl max-w-md`.
- Header: vital `<Bell>` tile, title **"Notify waitlist?"**, subtitle = product name. Close `<X>` (disabled while saving).
- Body copy: "Restocking this product will email **N** person/people who asked to be notified:" (pluralized), followed by a scrollable (`max-h-48`) bordered list of the emails.
- Footer: **Cancel** (surface) and **Confirm & notify** (dark, `<Bell>` icon; shows `<Loader2>` "Saving..." while running). Confirm runs the queued save and closes.

### NotifyMeButton dialog (storefront)

- **Trigger button:** `variant='full'` → full-width surface button with vital `<Bell>` and label **"Notify me when back in stock"**. `variant='compact'` → small pill `<Bell>` + "Notify me" (text hidden→"Notify" on mobile).
- **Dialog:** centered modal, `bg-ink/40 backdrop-blur-sm`, white `rounded-2xl max-w-md`, `role="dialog" aria-modal`. Header: vital `<Bell>` tile, title **"Restock alerts"**, subtitle = product name (line-clamped), close `<X>` (aria-label "Close").
- **States:**
  - `checking`: centered spinner.
  - **Subscribed:** emerald `<Check>` circle, heading "You're on the list" (just subscribed) or "Alert is active", body "We'll email **{email}** as soon as {productName} is back in stock." Buttons: **"Remove alert"** (`<BellOff>`, hover red; shows spinner while removing) and **"Done"** (dark).
  - **Not subscribed (form):** copy "We'll send a one-time email to this address when it's available again." (or, after removal, "Your alert was removed. Want back on the list? Confirm your email below."). Label "Email address" (uppercase), email input placeholder `you@example.com`. Submit button **"Notify me"** (`<Bell>`; shows `<Loader2>` "Saving..." while subscribing).
  - Errors shown as small red text (`text-xs text-red-600`).

### Nav badges (admin layout)

- **Backorders** nav item: red badge (`bg-red-500`) with open backorder count.
- **Products** nav item: amber badge (`bg-amber-500`) with low-stock count.
- Badge pill: `min-w-[20px] h-5 rounded-full text-white text-[11px] font-bold`, shows `99+` when over 99.

### Emails (copy that matters)

- **Back in stock** (`sendBackInStockNotification`): heading "Back in Stock", sub "A compound from your watchlist is available again", links to `/products/{slug}`.
- **Low-stock admin alert** (`sendLowStockAlert`): sent to `site_settings.admin_emails` with product name, current stock, threshold, slug, strength.

---

## Dependencies

- **npm:** `@supabase/supabase-js`, `next` (App Router, route handlers, `next/navigation`), `react`, `lucide-react` (icons: `Bell`, `BellOff`, `PackageX`, `Wrench`, `ClipboardList`, `ExternalLink`, `Loader2`, `Beaker`, `Package`, `ArrowRight`, `Check`, `X`, `Pencil`), Tailwind CSS.
- **Internal modules:**
  - `lib/supabase.ts` — shared browser client + the `Product` type (must include `stock_quantity`, `low_stock_threshold`).
  - `lib/admin/low-stock.ts` — `checkLowStockForProducts(db, ids)`.
  - `lib/admin/backorder-sync.ts` — `syncInvoiceBackorder(db, invoiceId, lineItems)`.
  - `lib/admin/api.ts` — `getLowStockProducts()` and `LowStockProduct`.
  - `lib/email-smtp.ts` — `sendLowStockAlert(...)`, `sendBackInStockNotification(...)`.
  - `lib/permissions.ts` — `canCreate(role)` (admin-only) for the product PUT route.
  - `contexts/CustomerContext` — `useCustomer()` for email prefill.
  - `lib/hooks/useSmartLoad`, `components/LoadingFeedback` — for the Stock Requests page.
  - `lib/admin/invoice-status` — `INVOICE_STATUS_META` for backorder rows.
  - Depends on **Module 9 (Purchase Orders)** for `purchase_orders` (backorder FK + "Fulfill" flow).
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (API routes), `NEXT_PUBLIC_BASE_URL` (email links), plus the SMTP config used by `lib/email-smtp.ts`. Admin recipients come from `site_settings.admin_emails`.

---

## Porting notes

- **Migration order:** run `low-stock-alerts-migration.sql`, `stock-notifications-migration.sql`, `invoice-split-backorder-migration.sql`, `stock-decrement-migration.sql`, and `backorders-migration.sql` **after** the catalog (`products`), `invoices`/`invoice_line_items`, `orders`/`order_items`, and `purchase_orders` tables exist (backorders FK-references `invoices` and `purchase_orders`; the split migration references `invoices`).
- **Stock decrement is idempotent by design** — the `stock_adjusted` flag is claimed atomically inside the SECURITY DEFINER function. Keep both the polling route and cron job calling `adjust_stock_for_order`; the flag prevents double decrement. Note `order_items.product_id` is TEXT (uuid-as-string) and is regex-guarded; `invoice_line_items.product_id` is uuid.
- **Low-stock dedupe:** `low_stock_alerted` is set true *before* sending email (to avoid double-send under concurrency) and reset when stock recovers. Recipients come from `site_settings.admin_emails`; if empty it logs a warning and sends nothing.
- **Backorder recompute semantics:** `syncInvoiceBackorder` deletes the existing **open** backorder for an invoice and recreates it from current line items vs current stock; fulfilled backorders are left as history. It is best-effort — never fail the invoice operation if it throws.
- **Restock emails fire from the product PUT route**, not the client. The client-side restock confirmation modal is purely a warning/UX gate; do not rely on it for sending. The 0→positive transition check happens server-side.
- **Affiliate stripping:** Backorders and Stock Requests are admin/assistant-only and contain no affiliate logic to remove — just keep the `requireStaff`/`verifyAdminRole` checks as `role IN ('admin','assistant')`. The product PUT route uses `canCreate(role)` (admin-only) — unchanged. You can drop `'affiliate'` from the `UserRole` union in `lib/permissions.ts` when porting.
- **Suggested implementation order:** (1) products columns + inline editing + `checkLowStockForProducts` + dashboard/badge; (2) stock decrement RPCs + wire into payment flows; (3) stock-notifications table + customer dialog + admin waitlist + restock confirmation; (4) backorders table + invoice-split + backorders page (depends on Purchase Orders).
- **Gotcha:** `getLowStockProducts()` filters the `stock_quantity <= low_stock_threshold` comparison in JS because PostgREST can't compare two columns; it only pulls rows where `low_stock_threshold` is not null.
