# Product Catalog + Inventory Lifecycle — Build Spec

> Definitive spec for rebuilding this feature cluster in a Next.js + Supabase codebase.
> Generated from: `products-schema.sql` / `update-products.sql` / `product-sku-migration.sql` /
> `low-stock-alerts-migration.sql` / `stock-notifications-migration.sql` /
> `stock-decrement-migration.sql` / `storage-products-bucket-setup.sql`; the `Product` type in
> `lib/supabase.ts`; `app/api/products/route.ts` (+ `featured`), `app/api/stock-notifications/route.ts`,
> `app/api/admin/products/{route,[id],upload,upload-certificate,import,report}`; `lib/admin/low-stock.ts`;
> `components/NotifyMeButton.tsx`; and the storefront + admin product pages.
> Stack: **Next.js 15 App Router** + **Supabase** (service-role server clients, anon browser) +
> **Supabase Storage** + **xlsx** (CSV) + **Tailwind** + **lucide-react**.
>
> Describes the code **as it exists**. Port **third**: `products.id` is referenced by ~11 FKs, and
> `products.stock_quantity` is mutated by Cluster 5 (order/invoice decrement) and Cluster 7
> (purchase-order receiving increment).

---

## 0. The traps, up front (read before touching anything)

1. **`stock_qty` vs `stock_quantity`.** The original `products-schema.sql` defines `stock_qty`.
   `update-products.sql` (and everything after) uses **`stock_quantity`** — the **entire app
   reads/writes `stock_quantity`**. `stock_qty` is **vestigial**; ignore it. This is the #1 trap.
2. **`coa_url` is a `text[]`** despite the singular name. Every path coerces/filters non-strings
   (`normalizeCoa` in featured; the array `.filter(...)` in POST/PUT). Treat it as an array always.
3. **`order_items.product_id` is `TEXT`** (a UUID stored as a string) while
   **`invoice_line_items.product_id` is `uuid`**. The two stock RPCs handle each differently
   (the order RPC regex-guards + casts `::uuid`; the invoice RPC uses it directly). **Don't "fix" it.**
4. **`stock_notifications` uses a partial-unique index** `(product_id, email) WHERE status='pending'`;
   emails are stored lowercased; Postgres `23505` is treated as "already subscribed."
5. **Restock + low-stock side-effects in the product update are awaited but error-wrapped** — an
   email failure never fails the product write. `low_stock_alerted` is set **before** sending to
   prevent double-sends, and cleared on recovery to re-arm.
6. **`adjust_stock_for_order` / `adjust_stock_for_invoice` are idempotent** via a `stock_adjusted`
   claim flag (atomic `UPDATE … WHERE stock_adjusted=false`).
7. **Storage buckets are created in the dashboard, not SQL** — `products` and `certificate` (and a
   third, `product-imports`, used by the CSV importer). Service-role uploads bypass RLS.
8. **`inventory_log` has no `.from()` in app code** — it's written by RPC/trigger only (defined in
   the purchase-orders migration, Cluster 7).

---

## 1. Overview

A single `products` table backs the public catalog and admin inventory management. The public
surface (storefront list + detail, `/api/products`, `/api/products/featured`) reads only `active`
products (featured additionally requires `stock_quantity > 0`) and optionally applies per-customer
price overrides. A **"Notify me when back in stock"** waitlist (`stock_notifications` +
`/api/stock-notifications` + `NotifyMeButton`) lets customers subscribe to out-of-stock products;
when an admin edits a product's stock from 0 → positive, all pending subscribers are emailed and
marked `notified`. Admins manage products through `/admin/products` (table with inline stock/price
editing, an Add/Edit modal, image + COA uploads to Storage, and a CSV importer with a preview step)
plus a printable HTML report. Stock itself is mutated by **RPCs** downstream: decremented when an
order's payment confirms or an invoice is paid (Cluster 5), incremented when a purchase order is
received (Cluster 7). A `low_stock_threshold` + `low_stock_alerted` pair drives admin low-stock
emails (one per threshold crossing, re-armed on recovery).

---

## 2. Schema & types

### `products` — live DDL (verbatim, the source of truth)

```sql
create table public.products (
  id uuid not null default extensions.uuid_generate_v4 (),
  name character varying not null,
  description text null,
  price numeric not null,
  stock_quantity integer not null default 0,          -- the column the app uses
  category character varying null,
  image_url text null,
  strength character varying null,
  purity character varying null,
  form character varying null,
  featured boolean null default false,
  active boolean null default true,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  slug character varying null,
  description_short text null,
  benefits text null,
  mechanism text null,
  coa_url text[] null,                                 -- ARRAY despite singular name
  sku text null,
  cost_price numeric null,
  sale_price numeric null,
  weight_grams integer null,
  length_cm numeric null,
  width_cm numeric null,
  height_cm numeric null,
  supplier_id uuid null,
  warehouse_location text null,
  is_active boolean not null default true,             -- distinct from `active` (see note)
  low_stock_threshold integer null,                   -- migration sets DEFAULT 10 + NOT NULL
  low_stock_alerted boolean not null default false,
  box_image_url text null,
  constraint products_pkey primary key (id),
  constraint products_supplier_id_fkey foreign KEY (supplier_id) references suppliers (id) on delete set null
) TABLESPACE pg_default;

create index IF not exists idx_products_category on public.products using btree (category);
create index IF not exists idx_products_slug on public.products using btree (slug);
create index IF not exists idx_products_active on public.products using btree (active);
create index IF not exists idx_products_low_stock on public.products using btree (low_stock_threshold)
  where (low_stock_threshold is not null);
create index IF not exists idx_products_sku on public.products using btree (sku);
```

> Notes: `active` is the flag the app filters on everywhere; `is_active` also exists (NOT NULL
> default true) but the cluster code uses **`active`**. `stock_qty` from the original schema is
> **not** in the live table (replaced by `stock_quantity`). `slug` is effectively unique (a UNIQUE
> index is created by `update-products.sql`).

### Migration order

| File | Effect |
|---|---|
| `products-schema.sql` | Original table with **`stock_qty`**, RLS `Products are viewable by everyone (SELECT USING true)`, seed data. **Superseded** by the live DDL above; reproduce the live DDL, not this. |
| `update-products.sql` | `DELETE FROM products`; adds `slug`/`description_short`/`benefits`/`mechanism`; **unique slug index**; re-seeds ~67 products using **`stock_quantity`**. |
| `product-sku-migration.sql` | `ADD COLUMN sku VARCHAR(50)` + `idx_products_sku`; back-fills SKUs by product id (6 left NULL). |
| `low-stock-alerts-migration.sql` | `low_stock_threshold integer` (back-filled to 10, then `DEFAULT 10` + `NOT NULL`) and `low_stock_alerted boolean NOT NULL DEFAULT false`; `idx_products_low_stock`. |
| `stock-notifications-migration.sql` | Creates `stock_notifications` (below). |
| `stock-decrement-migration.sql` | Adds `stock_adjusted` to `orders` & `invoices`; defines the two stock-decrement RPCs (below). |
| `storage-products-bucket-setup.sql` | **Instructions only — do NOT run.** Create the `products` Storage bucket (public) in the dashboard. |
| *(dashboard)* | `cost_price`, `sale_price`, `weight_grams`, dimensions, `supplier_id` (+ FK), `warehouse_location`, `is_active`, `box_image_url` were added in the dashboard / other migrations. |

### `stock_notifications` (`stock-notifications-migration.sql`)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `product_id` | `uuid` | `NOT NULL` FK → `products(id) ON DELETE CASCADE` |
| `customer_id` | `uuid` | FK → `customers(id) ON DELETE SET NULL` (nullable; guests subscribe by email) |
| `email` | `text` | `NOT NULL` (stored lowercased by the API) |
| `status` | `text` | `NOT NULL DEFAULT 'pending'` — `'pending' | 'notified' | 'cancelled'` |
| `created_at` / `notified_at` | `timestamptz` | |

```sql
-- One active request per (product, email); also dedupes case-insensitively (API lowercases).
CREATE UNIQUE INDEX uniq_stock_notifications_pending
  ON stock_notifications (product_id, email) WHERE status = 'pending';
CREATE INDEX idx_stock_notifications_product ON stock_notifications (product_id) WHERE status = 'pending';
CREATE INDEX idx_stock_notifications_status  ON stock_notifications (status);
```

### Stock-adjustment RPCs (`stock-decrement-migration.sql`) — SECURITY DEFINER, idempotent

```sql
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stock_adjusted boolean NOT NULL DEFAULT false;

-- order path: order_items.product_id is TEXT → regex-guard + cast ::uuid
CREATE OR REPLACE FUNCTION adjust_stock_for_order(p_order_id uuid) RETURNS void ... AS $$
BEGIN
  UPDATE orders SET stock_adjusted = true WHERE id = p_order_id AND stock_adjusted = false;
  IF NOT FOUND THEN RETURN; END IF;             -- already ran (or no order): idempotent claim
  UPDATE products p SET stock_quantity = GREATEST(0, COALESCE(p.stock_quantity,0) - agg.qty)
    FROM (SELECT oi.product_id::uuid AS pid, SUM(oi.quantity) AS qty FROM order_items oi
          WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL
            AND oi.product_id ~ '^[0-9a-fA-F]{8}-...-[0-9a-fA-F]{12}$' GROUP BY oi.product_id) agg
   WHERE p.id = agg.pid;
END; $$;

-- invoice path: invoice_line_items.product_id is already uuid (no cast/regex)
CREATE OR REPLACE FUNCTION adjust_stock_for_invoice(p_invoice_id uuid) RETURNS void ... AS $$
  ... same claim+GREATEST(0, ...) pattern, summing invoice_line_items.qty ...
$$;
```

Both clamp at `GREATEST(0, …)` so stock never goes negative. Callers (Cluster 5) invoke them via
`supabase.rpc('adjust_stock_for_order'|'adjust_stock_for_invoice', { ... })`.

### `inventory_log` (defined in `purchase-orders-migration.sql`, Cluster 7) — referenced only
Append-only stock ledger written **only** by SECURITY-DEFINER functions (`receive_po_items()` etc.)
and never via `.from()` in app code; RLS read for admin/assistant. Out of scope here; named so the
porter doesn't recreate it in this cluster.

### `Product` TS interface (`lib/supabase.ts`)
`id, name, description|null, price, stock_quantity, low_stock_threshold, category|null, image_url|null,
strength|null, purity|null, form|null, featured, active, created_at, updated_at, slug|null,
description_short|null, benefits|null, mechanism|null, coa_url: string[], sku|null`. (Note: the TS
type models `coa_url` as `string[]` and omits the vestigial `stock_qty`.)

### Schema usage map

| Table.column | Read by | Written by |
|---|---|---|
| `products.*` | `/api/products`(+featured), storefront pages, admin page, report, `low-stock.ts` | admin `route.ts`/`[id]`/`import`; RPCs (`stock_quantity`) |
| `products.stock_quantity` | everywhere | admin edits; `adjust_stock_for_*` (Cluster 5 −), `receive_po_items` (Cluster 7 +); `low_stock_alerted` recompute |
| `products.low_stock_threshold` / `low_stock_alerted` | `low-stock.ts`, report | admin edits; `low-stock.ts` (sets/clears `low_stock_alerted`) |
| `products.coa_url` | detail page, featured | POST/PUT (filtered to string[]) |
| `stock_notifications` | `/api/stock-notifications`, `notifyWaitlist` | POST/DELETE; `notifyWaitlist` (→ `notified`) |
| `customer_price_overrides` | `/api/products`(+featured) | (pricing cluster) |
| Storage `products`/`certificate`/`product-imports` | public URLs on products | upload routes (service role) |

---

## 3. Components

### Public read

#### `GET /api/products` — `app/api/products/route.ts` (service-role client; public)
- Query params: `customer_id?`, `slug?`, `category?`. Base query: `.eq('active', true)`.
- `slug` → `.single()` (one product, no name ordering); `category` (≠ `'All'`) → filter; else
  `.order('name')`.
- If `customer_id` present, loads `customer_price_overrides` and overlays `price`, adding
  `has_override` + `original_price` (single or array form). Override-fetch failure is non-fatal.

#### `GET /api/products/featured` — `app/api/products/featured/route.ts`
- Selects a fixed column list, `.eq('active',true).eq('featured',true).gt('stock_quantity',0)
  .order('name').limit(8)` — **out-of-stock featured products never surface on the home page.**
- `normalizeCoa(p)` coerces `coa_url` to a filtered `string[]` (drops non-strings / empties).
  Same customer price-override overlay as above.

#### Storefront list — `app/products/page.tsx` (**Client**)
- Fetches `/api/products` (passes `customer_id` when signed in). Category filter pills (icon +
  name + per-category count); search over name/category; **out-of-stock products sorted last**.
- Card stock states: `stock_quantity === 0 && price > 0` → `<NotifyMeButton variant="compact">`;
  `stock_quantity === 0 && price === 0` → muted `Out of Stock` text; otherwise Add-to-Cart path.

#### Storefront detail — `app/products/[slug]/page.tsx` (**Client**)
- Fetches the product by `slug`. **COA display:** `coa_url` array → a single "View Certificate of
  Analysis" link when one entry, or a list/grid of certificates when multiple (title reflects count).
- `stock_quantity === 0` → `<NotifyMeButton variant="full">`; otherwise pack-size selector + an
  Add-to-Cart button priced as `(price/10)*packSize*packs`.

### Notify-me waitlist (Cluster C)

#### `POST/GET/DELETE /api/stock-notifications` — `app/api/stock-notifications/route.ts` (public)
- `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/`; **all emails trimmed + lowercased.**
- **GET** `?product_id=&email=` → `{ subscribed: boolean }` (invalid email → `{subscribed:false}`;
  missing params → 400).
- **POST** `{product_id, email, customer_id?}` → confirms the product exists (404 if not); if a
  pending row already exists → `{success:true, alreadySubscribed:true}`; inserts `status:'pending'`;
  a unique-index race (`23505`) is swallowed as `alreadySubscribed:true`.
- **DELETE** `{product_id, email}` → updates the pending row to `status:'cancelled'`.

#### `components/NotifyMeButton.tsx` (**Client**)
- Props: `productId`, `productName`, `variant: 'compact'|'full'` (compact = grid badge, full =
  detail-page button), `className`. Uses `useCustomer()` to prefill/identify.
- Opens a modal dialog: on open, prefills the signed-in customer's email and calls GET to set the
  initial subscribed state; subscribe → POST, remove → DELETE. States: `checking` spinner,
  subscribed confirmation (`You're on the list` / `Alert is active` + Remove/Done), and the
  subscribe form (`Notify me`). Locks body scroll while open.

### Admin management (Cluster D)

#### `GET/POST /api/admin/products` — `app/api/admin/products/route.ts`
- `verifyAdminRole(request, requireMutation)`: bearer token → `customers.role`. **Reads** allowed
  for `admin | assistant | affiliate` (catalog is read-only for affiliates); **mutations** require
  `canCreate(role)` (admin only).
- **GET**: filters `active`/`category`/`featured`; `.order('created_at', desc)`.
- **POST**: requires `name`, `price`, `stock_quantity`; non-negative checks; auto-slug from name if
  absent; slug-conflict → 409; `low_stock_threshold` defaults to 10 when not a valid ≥0 number;
  `coa_url` filtered to `string[]`. → `201 { product }`.

#### `GET/PUT/DELETE /api/admin/products/[id]` — `app/api/admin/products/[id]/route.ts`
- Same `verifyAdminRole`. **PUT is the update verb** (the project's "PATCH-style" partial update —
  only provided fields are written; `updated_at` always set; `coa_url` filtered to `string[]`).
  Slug-conflict (against other ids) → 409; numeric guards as in POST.
- **Restock side-effect (awaited, error-wrapped):** if `existingProduct.stock_quantity <= 0` and the
  new `stock_quantity > 0`, `notifyWaitlist(id, product)` emails every pending subscriber via
  `sendBackInStockNotification` and flips the sent ones to `status:'notified'` (+ `notified_at`).
- **Low-stock re-evaluation (awaited, `.catch`-wrapped):** `checkLowStockForProducts(supabase, [id])`.
- Both side-effects are wrapped so an email/db error never fails the product update.
- **DELETE**: requires `canDelete` (admin); hard-deletes the row.

#### `lib/admin/low-stock.ts` — `checkLowStockForProducts(db, productIds)`
- Loads the products; computes `toAlert` (`stock_quantity <= threshold && !low_stock_alerted`) and
  `toReset` (`stock_quantity > threshold && low_stock_alerted`).
- Clears `low_stock_alerted` on recovered products (re-arms). For alerts: loads
  `site_settings.admin_emails`, **sets `low_stock_alerted = true` first** (so concurrent changes
  don't double-send), then emails each via `sendLowStockAlert` (Cluster 2). Best-effort; no admin
  emails configured → warn and return.
- Also used by the admin Products nav badge (`getLowStockProducts`, same lib) — see RBAC cluster.

#### Uploads & import (all `canCreate`-gated, service-role, bypass RLS)
- **`POST/DELETE /api/admin/products/upload`** → Storage bucket **`products`**. MIME
  `image/jpeg|png|webp|gif`, max **20 MB**; random filename; returns `{url, path, fileName}`. Helpful
  errors when the bucket is missing / RLS-blocked.
- **`POST/DELETE /api/admin/products/upload-certificate`** → Storage bucket **`certificate`**. MIME
  `application/pdf`, max **20 MB**. (COA PDFs; stored into the `coa_url` array by the editor.)
- **`POST/PUT /api/admin/products/import`** (xlsx) → Storage bucket **`product-imports`** (audit
  trail). **POST** parses a CSV (columns `Code, Product Name, MG, Wholesale Price, CAD Price`;
  `slugify(Code)`; price = `CAD ?? Wholesale ?? 0`; `description_short` summarizes prices), splits
  into new-vs-update by existing slug, returns a **preview** (`{csvPath, newProducts, updateProducts,
  skippedRows}`). **PUT** commits an `upsert(onConflict:'slug')`: new rows get full defaults
  (`stock_quantity:0, featured:false, active: price>0, coa_url:[]`), updates touch only CSV-sourced
  fields (so existing DB values aren't nulled). Max **500** rows; CSV max **5 MB**.

#### `GET /api/admin/products/report` — printable HTML report (admin/assistant)
- Joins `products` with `order_items` to compute per-product units/revenue (matched by `product_id`,
  falling back to `product_name`). Filters `q`/`category`/`status`. Stats: product count, stock
  on-hand + value, low/out counts (`low = 0 < qty <= threshold||10`, `out = qty <= 0`), all-time
  revenue. Renders via `lib/admin/report-html` helpers; `?print` auto-prints.

#### Admin Products page — `app/(admin)/admin/products/page.tsx` (**Client**)
- Header `Products` + toolbar: search (`Search products...`), **Import CSV** (`FileUp`) and **Add
  Product** (`Plus`, `bg-ink`) buttons (gated by `canCreate`).
- Table of products with **inline editing** for `price`, `stock_quantity`, and
  `low_stock_threshold` (`commitInlineSave` → PUT `[id]`); a low-stock/out badge; image thumbnail.
  When an inline or modal stock edit takes a product from `<= 0` to `> 0`, the page is aware of the
  restock (the server fires the waitlist emails).
- **Add/Edit modal** form fields (state keys): `name, slug, category, price, sale_price?,
  stock_quantity, low_stock_threshold (default '10'), strength, purity, form, description,
  description_short, benefits, mechanism, featured, active`, plus **image upload** (`handleImageUpload`
  → `/upload`) and **certificate upload** (`handleCertificateUpload` → `/upload-certificate`, appended
  to `coa_url`).
- **CSV Import modal** is a two-step wizard: `upload` (choose file → POST `/import` → preview) then
  `preview` (shows new vs update counts + skipped rows → confirm → PUT `/import`), with success/error
  banners.

---

## 4. UI/UX design overview

### Design tokens
Storefront + admin share the custom theme: `ink #1A1A1A`, `ink-muted #6E6E6E`, `bronze #9C8B5A`,
`surface #F7F7F7`, `line #C9CCD1`; status `emerald-500 #10b981`, `red-500/600`, `amber`. Icons
`lucide-react`. Cards `bg-white rounded-xl border border-line`; primary buttons `bg-ink
hover:bg-ink/90 text-white rounded-lg font-medium`; inputs `bg-surface border border-line rounded-lg
focus:ring-2 focus:ring-bronze/40`.

### NotifyMeButton (exact)
- **Trigger — compact:** `flex items-center gap-1.5 px-3 py-2 bg-surface hover:bg-white text-ink
  text-xs font-medium rounded-lg border border-line hover:border-bronze/40`, `Bell` icon
  `text-bronze` (`w-3.5 h-3.5`), label `Notify me` (mobile `Notify`).
- **Trigger — full:** `w-full font-semibold py-3 sm:py-4 rounded-xl … bg-surface text-ink border
  border-line hover:border-ink/30`, `Bell w-5 h-5 text-bronze`, label `Notify me when back in stock`.
- **Dialog:** overlay `fixed inset-0 z-[100] … bg-ink/40 backdrop-blur-sm`; panel `max-w-md bg-white
  rounded-2xl border border-line shadow-xl`; header has a `w-10 h-10 bg-bronze/10 rounded-lg` Bell
  badge, `Restock alerts` title + `line-clamp-1` product name, and an `X` close.
- **Subscribed state:** emerald `Check` in a `bg-emerald-500/10 rounded-full` badge; `You're on the
  list` / `Alert is active`; **Remove alert** (`BellOff`, hover red) + **Done** (`bg-ink`).
- **Form state:** label `Email address` (`text-xs font-semibold uppercase tracking-wider`), input
  `rounded-xl`, submit `bg-ink … rounded-xl` showing `Saving...` (spinner) / `Notify me`. Errors
  `text-xs text-red-600`. Loading: centered `Loader2` spinner.

### Storefront
- **List:** big `text-3xl sm:text-4xl lg:text-5xl font-bold text-ink` heading; category filter pills
  (active `bg-ink text-white`, icon turns white) with counts; product grid; out-of-stock cards show
  the compact NotifyMeButton or muted `Out of Stock`.
- **Detail:** `text-xl→4xl font-bold text-ink` title; COA "Certificate of Analysis" link(s) (single
  icon link or a multi-cert list); price + pack selector + Add-to-Cart, or the full NotifyMeButton
  when out of stock.

### Admin
- Products table with per-cell inline editors (number inputs swapped in on click; `Loader2` while
  saving); stock badges Out/Low/in-stock; row actions Edit (`Pencil`)/Delete (`Trash2`). Add/Edit
  and Import modals use the standard modal recipe (`bg-black/50` overlay, `bg-white rounded-xl/2xl`
  panel, `bg-surface` inputs, `bg-ink` primary). Status banners: error `bg-red-50 border-red-200`,
  success `bg-green-50 border-green-200`.

### Email (restock / low-stock)
Sent by Cluster 2 senders (`sendBackInStockNotification`, `sendLowStockAlert`) — inline-styled HTML,
`AMINOCAN` brand header, `#1A1A1A` CTA buttons; low-stock uses red `#B91C1C` (out) vs amber `#B45309`
(low) accents.

---

## 5. Data flow & behavior

### Read
Storefront fetches `/api/products` / `/api/products/featured` (service-role, public) → only `active`
products (featured also `stock_quantity > 0`) → optional per-customer price overlay.

### Restock (0 → positive), admin-driven
Admin edits stock (inline or modal) → `PUT /api/admin/products/[id]` → detects `wasOutOfStock &&
isNowInStock` → `notifyWaitlist`: loads pending `stock_notifications`, emails each via
`sendBackInStockNotification`, marks the successful ones `notified`. **Awaited but try/caught** so an
email failure never fails the product save.

### Low-stock alerting
Any stock/threshold edit → `checkLowStockForProducts`: products at/below threshold and not yet
alerted → set `low_stock_alerted=true` **first**, then email `site_settings.admin_emails` (one email
per crossing); products risen above threshold with the flag set → clear it (re-arm). The admin nav
shows a low-stock badge (RBAC cluster).

### Stock decrement / increment (downstream)
- **Decrement (Cluster 5):** on confirmed crypto payment or paid invoice, callers
  `rpc('adjust_stock_for_order', {p_order_id})` / `rpc('adjust_stock_for_invoice', {p_invoice_id})`.
  Idempotent via `stock_adjusted` claim; clamps at 0; **order path casts TEXT `product_id` → uuid
  with a regex guard**, invoice path uses uuid directly.
- **Increment (Cluster 7):** purchase-order receiving calls a SECURITY-DEFINER function that bumps
  `stock_quantity` and writes `inventory_log`.

### Waitlist subscribe (customer)
`NotifyMeButton` → `/api/stock-notifications` POST (lowercased email; idempotent; `23505` = already
subscribed). GET reports current state; DELETE cancels.

---

## 6. Edge cases & states

- **Out of stock:** featured endpoint hides them; storefront sorts them last and swaps Add-to-Cart
  for NotifyMeButton (or `Out of Stock` text when `price === 0`).
- **Duplicate slug:** POST/PUT → 409.
- **Invalid numbers:** negative price/stock or bad threshold → 400.
- **Missing storage bucket / RLS:** upload routes return a specific "create the bucket" message.
- **CSV:** non-CSV or > 5 MB → 400; > 500 rows on commit → 400; unparseable → 400 with the expected
  column list; rows without a `Code` are skipped (counted).
- **Waitlist races:** unique-index `23505` treated as already-subscribed; duplicate pending → idempotent.
- **Empty admin_emails:** low-stock flags but sends nothing (warns).
- **Email failures:** restock/low-stock errors are logged, never fail the product write; multi-send
  helpers succeed if ≥1 recipient succeeds.
- **Stock never negative:** RPCs clamp with `GREATEST(0, …)`.

---

## 7. Open questions & unverified items

- **`is_active` vs `active`:** both exist on the live table; the cluster code reads/writes **`active`**
  exclusively. `is_active`'s consumer (if any) was not found in this cluster — confirm before
  removing it.
- **`stock_qty`:** vestigial (from the original `products-schema.sql`); not in the live DDL or any
  app path. Safe to omit when recreating.
- **Dashboard-added columns** (`cost_price`, `sale_price`, dimensions, `supplier_id`+FK,
  `warehouse_location`, `box_image_url`): present in the live DDL but their add-migrations weren't all
  located here; reproduce from the live DDL. `supplier_id`/dimensions are consumed by the suppliers /
  shipping clusters.
- **The two big pages** (`app/products/[slug]/page.tsx` ~710 lines, `app/(admin)/admin/products/page.tsx`
  ~1614 lines) were captured at the structural/skeleton level (headings, field keys, modal flow,
  stock states, COA display) rather than line-by-line; exact pixel styling of every sub-element was
  not transcribed.
- **`inventory_log`** and `receive_po_items()` belong to Cluster 7 (purchase orders); documented here
  only as the stock-increment + ledger side. The decrement RPC **callers** live in Cluster 5.
- **`product-imports` bucket** is a third Storage bucket (beyond `products`/`certificate`) and must
  also be created in the dashboard for the CSV importer to work.
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (all routes), plus the SMTP
  vars from Cluster 2 for restock/low-stock emails.
