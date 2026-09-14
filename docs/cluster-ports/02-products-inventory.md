# Cluster 2 — Product Catalog & Inventory: Code Extraction Guide

> **What this document is.** A file-by-file walkthrough of Cluster 2 so you can extract it
> completely. For each piece: *what to open*, *what it does*, *its intricacies*, and *exactly
> how it touches the database*. Ports **third** (after 1 & 10): it owns the `products` schema that
> Pricing (3), Orders (4), Invoices (5), and Purchase Orders (7) all FK into.
>
> **Companion deep specs:** `docs/module-ports/03-products-public.md`,
> `04-admin-products-management.md`, `02-inventory-and-stock.md`. This is the *map*; those are the *atlas*.

---

## 1. What the cluster is / does

The **product catalog** plus the **inventory lifecycle**. It provides:
- **Public storefront read** of products (catalog, detail, featured), with per-customer price
  overrides merged in.
- **Admin product management:** CRUD, inline price/stock/threshold editing, image + COA uploads,
  CSV import.
- **Inventory mechanics:** the live `stock_quantity` column, an append-only `inventory_log`, the
  **"notify me" waitlist** (`stock_notifications`) with restock emails, and **low-stock alerts**.

**Why it ports third:** `products` is referenced by **11 FKs** (order_items, invoice_line_items,
both `*_price_overrides`, pricelist_items, purchase_order_items, supplier_prices,
stock_notifications, inventory_log). Stock is mutated by Cluster 5 (decrement on payment) and
Cluster 7 (increment on PO receiving) — both write `inventory_log`.

---

## 2. Database schema — what exists and where it comes from

### ⚠️ The single biggest gotcha: `stock_qty` vs `stock_quantity`
The base table (`products-schema.sql`) defines **`stock_qty`** — but the **live column the entire
app reads/writes is `stock_quantity`**, added later by `update-products.sql`. `stock_qty` is
**vestigial**. Every API, RPC, and UI uses `stock_quantity`. When porting, create `stock_quantity`
and ignore `stock_qty` (or drop it).

### `products` — assembled across multiple files
| Source | Columns |
|--------|---------|
| `products-schema.sql` (base) | `id`, `name`, `slug` (UNIQUE), `category`, `description`, `description_short`, `benefits`, `mechanism`, `price`, `stock_qty` (**vestigial**), `strength`, `form`, `image_url`, `active`, timestamps. Indexes on category/slug/active. RLS: **public SELECT** (`USING (true)`). |
| `update-products.sql` | **`stock_quantity`** (the live stock col), `purity`, `featured`, plus re-seeds the catalog. Also backfills slug/short/benefits/mechanism. |
| `product-sku-migration.sql` | `sku` + index; backfills SKUs by product id. |
| `low-stock-alerts-migration.sql` | `low_stock_threshold integer NOT NULL DEFAULT 10`, `low_stock_alerted boolean DEFAULT false` + partial index. |
| (image/COA columns) | `box_image_url`, `coa_url` (**a string array despite the singular name** — code filters non-strings), `additional_images`. Confirm against the admin route/`Product` type. |

> Reconcile the final column set against the `Product` interface in `lib/supabase.ts` and the
> admin PATCH handler — those are the source of truth for what the app actually uses.

### `inventory_log` (created in `purchase-orders-migration.sql`)
`id`, `product_id → products ON DELETE SET NULL`, `delta integer`, `reason text`,
`reference_type`, `reference_id`, `created_by → customers`, `created_at`. Append-only.
**No `.from('inventory_log')` in app code** — it's written by the PO-receiving RPC (Cluster 7) and
should be written by stock decrements too. Indexes on (product, created_at) and (reference_type, id).

### `stock_notifications` (`stock-notifications-migration.sql`)
`id`, `product_id → products ON DELETE CASCADE`, `customer_id → customers ON DELETE SET NULL`,
`email`, `status` (`'pending'|'notified'|'cancelled'`), `created_at`, `notified_at`.
**Intricacy:** a **partial UNIQUE index** `(product_id, email) WHERE status='pending'` enforces one
active request per product/email; emails are lowercased by the API so it dedupes case-insensitively.

### Stock-mutation RPCs (`stock-decrement-migration.sql`) — used by Clusters 4/5
Adds `orders.stock_adjusted` + `invoices.stock_adjusted` (both default false) and two
`SECURITY DEFINER` functions:
- `adjust_stock_for_order(p_order_id)` — claims the order atomically (`SET stock_adjusted=true …
  WHERE stock_adjusted=false`, bail if already done), then decrements `stock_quantity` summed from
  `order_items` (casts the **TEXT** `order_items.product_id` to uuid via regex guard).
- `adjust_stock_for_invoice(p_invoice_id)` — same pattern over `invoice_line_items` (`product_id`
  is already uuid). **Idempotent** via the `stock_adjusted` claim. Called when an invoice is marked paid.

### Storage buckets (created in the dashboard, not SQL)
- **`products`** bucket — product images (`app/api/admin/products/upload`). `storage-products-bucket-setup.sql`
  is just instructions (create via dashboard, public bucket).
- **`certificate`** bucket — COA PDFs (`app/api/admin/products/upload-certificate`).

### How the DB is reached
- **Public read** uses the **service-role client** but only ever selects `active=true` rows (RLS
  also permits public SELECT). Price overrides merged in-process.
- **Admin writes** verify role server-side (`verifyAdminRole`) and use service-role.

---

## 3. The reading map (open files in this order)

### Tier A — Schema & shared types
- `lib/supabase.ts` → the `Product` interface (canonical column list; note `coa_url` array).
- The SQL files above. Start with `products-schema.sql` then `update-products.sql` (to see the
  `stock_qty`→`stock_quantity` swap), then the inventory/notification/threshold migrations.

### Tier B — Public storefront read

**`app/api/products/route.ts`** (`GET`) — *the catalog/detail endpoint.*
- Query params: `slug` (→ `.single()` for detail), `category` (filter unless `'All'`),
  `customer_id` (→ merge overrides). Always `.eq('active', true)`, ordered by name.
- **Intricacy — per-customer pricing merge:** if `customer_id` given, loads
  `customer_price_overrides` and replaces `price`, sets `has_override` + `original_price`. This is
  the **seam to Cluster 3** (pricing). Override-fetch failure degrades gracefully to base prices.

**`app/api/products/featured/route.ts`** (`GET`) — featured carousel.
- Selects a narrow column set; `.eq('featured', true).gt('stock_quantity', 0).limit(8)`
  (out-of-stock featured are hidden). `normalizeCoa()` coerces `coa_url` to a string array. Same
  override merge as above.

**Storefront pages (read-only consumers):** `app/products/page.tsx` (listing + category filter +
search), `app/products/[slug]/page.tsx` (detail: pack sizes, COA downloads, related). Components:
`components/Products.tsx`, `Hero.tsx`, `ProductTicker.tsx`, `NotifyMeButton.tsx`, `AddToCartModal.tsx`.

### Tier C — "Notify me" waitlist (customer-facing write)

**`app/api/stock-notifications/route.ts`** (`GET`/`POST`/`DELETE`) — *the waitlist.*
- `GET ?product_id&email` → is this email pending? `POST` → validate email + product exists,
  lowercase email, insert `status:'pending'` (catches `23505` unique-violation → already
  subscribed). `DELETE` → set matching pending row to `'cancelled'`.
- `components/NotifyMeButton.tsx` is the UI (compact badge + full-width variants, modal w/ prefill).

### Tier D — Admin product management

**`app/api/admin/products/route.ts`** — list (GET) + create (POST). `verifyAdminRole`; `canCreate`
(admin) for POST.

**`app/api/admin/products/[id]/route.ts`** — *PATCH (edit/inline) + DELETE.* (Read carefully — two
critical side effects.)
- PATCH builds a partial `updateData` (name/price/stock/threshold/featured/active/slug/desc/coa…).
  `coa_url` is filtered to a string array.
- **Side effect 1 — restock notify:** computes `wasOutOfStock` (old `stock_quantity ≤ 0`) vs
  `isNowInStock` (new > 0); if 0→positive, **`await notifyWaitlist()`** — loads pending
  `stock_notifications`, sends `sendBackInStockNotification` (SMTP, Cluster 10) to each, marks
  successful ones `notified`+`notified_at`. Awaited (serverless reliability), wrapped so email
  errors never fail the update.
- **Side effect 2 — low-stock:** always calls `checkLowStockForProducts(supabase, [id])` after a
  stock/threshold edit.
- DELETE: `canDelete` (admin), removes the row.

**`lib/admin/low-stock.ts`** — `checkLowStockForProducts(db, ids)`: loads the products, partitions
into `toAlert` (`stock_quantity ≤ threshold && !low_stock_alerted`) and `toReset` (recovered &&
alerted). Clears the flag on recovered; **sets `low_stock_alerted=true` BEFORE sending** (so
concurrent edits don't double-send); emails `site_settings.admin_emails` via `sendLowStockAlert`.
Re-arms on recovery. (Also called from the dashboard low-stock badge path.)

**`app/api/admin/products/import/route.ts`** — *CSV import (xlsx), 3 verbs.*
- POST = parse + preview (`XLSX.read`), columns **`Code, Product Name, MG, Wholesale Price, CAD
  Price`**; splits new vs update by slug; PUT = commit upsert (new get stock=0/featured=false;
  updates touch only CSV-derived fields). GET = template.

**`app/api/admin/products/upload/route.ts`** → `products` Storage bucket (images, public URL).
**`app/api/admin/products/upload-certificate/route.ts`** → `certificate` Storage bucket (COA PDFs).
**`app/api/admin/products/report/route.ts`** → product/sales export (reads `order_items`).

**`app/(admin)/admin/products/page.tsx`** — the admin table: inline-edit cells (price/stock/
threshold) with color coding, create/edit modal (image + COA upload), **restock confirmation
modal** (shown when a 0→+ edit has pending waitlist emails), and CSV import (2-step preview/apply).

**`app/(admin)/admin/stock-requests/page.tsx`** + `app/api/admin/stock-notifications/route.ts` —
admin waitlist view (most-requested first; links to Products to restock).

---

## 4. End-to-end flows to trace

1. **Storefront pricing:** page calls `/api/products?customer_id=…` → base rows (`active=true`) +
   `customer_price_overrides` merge → `price`/`has_override`/`original_price`. (Cluster 3 seam.)
2. **Notify-me → restock:** customer `POST /api/stock-notifications` (pending) → admin edits stock
   0→+ via `PATCH /api/admin/products/[id]` → `notifyWaitlist` emails subscribers + marks
   `notified` → `checkLowStockForProducts` re-evaluates.
3. **Low-stock alert:** any stock/threshold edit → `checkLowStockForProducts` → if crossed below,
   flag + email `admin_emails`; if recovered, clear flag (re-arm).
4. **Stock decrement (Cluster 5):** invoice marked paid → `adjust_stock_for_invoice` RPC
   (idempotent via `stock_adjusted`) decrements `stock_quantity`.
5. **Stock increment (Cluster 7):** PO receiving RPC increments `stock_quantity` + writes
   `inventory_log`.

---

## 5. Extraction checklist & gotchas

- [ ] Create `products` with **`stock_quantity`** as the live column; treat base `stock_qty` as
      vestigial. Apply all the ALTERs (purity, featured, sku, low_stock_threshold/alerted, image/coa).
- [ ] `coa_url` is a **string array** despite the singular name — keep the filter-to-strings logic
      everywhere (`normalizeCoa`, PATCH handler).
- [ ] RLS on `products` is **public SELECT** — fine for a storefront; admin writes go through
      service-role + `verifyAdminRole`.
- [ ] `stock_notifications` partial-unique `(product_id, email) WHERE status='pending'`; lowercase
      emails; handle `23505` as "already subscribed".
- [ ] Restock email + low-stock check are **awaited but error-wrapped** in the PATCH route — never
      fail the product update on an email problem.
- [ ] `low_stock_alerted` is set **before** sending to prevent double-sends; cleared on recovery.
- [ ] Create the two **Storage buckets** (`products`, `certificate`) in the dashboard — not in SQL.
- [ ] `inventory_log` and the `adjust_stock_*` RPCs are **shared with Clusters 4/5/7** — port the
      table + RPCs now; the increment/decrement callsites arrive with those clusters.
- [ ] `order_items.product_id` is **TEXT** (UUID-as-string) — the order RPC regex-guards + casts;
      `invoice_line_items.product_id` is uuid. Don't "fix" this casually; downstream depends on it.
- [ ] CSV import columns are fixed: `Code, Product Name, MG, Wholesale Price, CAD Price`.

---

## 6. File index (everything in Cluster 2)

```
DB        products-schema.sql, update-products.sql (stock_quantity/featured/purity),
          product-sku-migration.sql, low-stock-alerts-migration.sql,
          stock-notifications-migration.sql, stock-decrement-migration.sql (RPCs),
          inventory_log (defined in purchase-orders-migration.sql),
          storage-products-bucket-setup.sql (instructions only)
libs      lib/admin/low-stock.ts  (+ Product type in lib/supabase.ts)
public API app/api/products/route.ts, app/api/products/featured/route.ts,
          app/api/stock-notifications/route.ts
admin API app/api/admin/products/{route,[id],import,upload,upload-certificate,report}.ts,
          app/api/admin/stock-notifications/route.ts
storefront app/products/page.tsx, app/products/[slug]/page.tsx,
          components/{Products,Hero,ProductTicker,NotifyMeButton,AddToCartModal}.tsx
admin UI  app/(admin)/admin/products/page.tsx, app/(admin)/admin/stock-requests/page.tsx
storage   Supabase buckets: products (images), certificate (COA PDFs)
docs      docs/module-ports/03-products-public.md, 04-admin-products-management.md,
          02-inventory-and-stock.md
```

**Email senders used:** `sendBackInStockNotification`, `sendLowStockAlert` (both `lib/email-smtp`,
Cluster 10), to `site_settings.admin_emails`.
**Deps:** `xlsx` (CSV import), `@supabase/supabase-js` (Storage + DB).
```
