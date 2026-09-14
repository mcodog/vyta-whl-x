# Procurement + Restock — Suppliers ↔ Purchase Orders ↔ Backorders — Build Spec

> Definitive spec for rebuilding this feature cluster in a Next.js + Supabase codebase.
> Generated from: `purchase-orders-migration.sql` (+ `-receiving` / `-discount-shipping`),
> `backorders-migration.sql`, `supplier-pricelists-migration.sql`; helpers `lib/admin/po-status.ts`,
> `lib/admin/backorder-sync.ts`, `lib/admin/purchase-orders.ts`, `lib/admin/supplier-prices.ts`;
> routes `app/api/admin/purchase-orders/{route,[id],[id]/receipts,[id]/pdf}`,
> `app/api/admin/backorders/{route,[id],count}`, `app/api/admin/suppliers/{route,[id],[id]/prices}`;
> and the admin pages. Stack: **Next.js 15 App Router** + **Supabase** (service-role) + **pdfkit** +
> **Tailwind**.
>
> Describes the code **as it exists**. Port **seventh** — it closes the inventory loop opened by
> Clusters 5/6 by owning the **stock-increment** side: `inventory_log` and the two restock RPCs.

---

## 0. The traps, up front

1. **`inventory_log` is defined HERE** (`purchase-orders-migration.sql`), **not** in the Products
   cluster — even though that cluster's *decrement* RPC also writes it. Port the table with this
   cluster.
2. **Two stock-increment paths:**
   - **`receive_po_items(po_id, actor, note, items)`** — the per-line **normal** path. `FOR UPDATE`-
     locks the PO + each line; rejects receiving on `paid`/`cancelled` POs; validates `qty ≤ remaining`;
     skips non-positive lines; **rejects an empty receipt** (deletes the header, raises); increments
     `products.stock_quantity` + writes `inventory_log` per line; recomputes PO status from received
     totals.
   - **`apply_po_inventory(po_id)`** — the **whole-PO** path, used when a PO is created already
     `fulfilled`. `FOR UPDATE`-locks; **idempotent via `inventory_applied`** (returns early if set);
     bumps stock + logs for every line; sets `inventory_applied = true`.
3. **`purchase_order_receipt_items` has no app `.from()`** — written **only** by `receive_po_items`.
4. **`po_number` uses a sequence** `'PO-' || LPAD(nextval('po_number_seq'), 5, '0')` (PO-01001,
   starts 1001) — **create `po_number_seq` before the table** or the default expression fails.
5. **`purchase_orders.supplier_id` FK is `ON DELETE RESTRICT`** — you can't delete a supplier that has
   POs (intentional). The DELETE route surfaces the raw Postgres FK error (no friendly mapping).
6. **Bidirectional backorder ↔ PO link:** the PO-create route **flushes** the backorder
   (`backorder_id` → `status:'fulfilled'`, `purchase_order_id`, `fulfilled_at`); the backorder list
   **joins the PO back**. The "Fulfill" button deep-links `/admin/purchase-orders/new?backorder=<id>`
   to prefill the draft.
7. **Backorders are created in Cluster 5/6** (`syncInvoiceBackorder` in the invoice-split flow) but
   **managed here**. Port both or guard the call.
8. **PO edits are blocked by `isPoLocked`** (`paid`/`cancelled`) — enforced **in the route**
   (422), not just the UI. Received lines are also frozen.
9. **Suppliers + supplier-prices are independent of the backorder loop** — portable standalone if you
   only want procurement.

---

## 1. Overview

`suppliers` are vendors; `supplier_prices` an optional per-supplier price sheet (falls back to
`products.price`). A `purchase_orders` header + `purchase_order_items` lines record what's ordered;
**receiving** flows through `purchase_order_receipts` + `purchase_order_receipt_items` (one event →
many line receipts), each increment going through `receive_po_items` which raises stock and appends to
`inventory_log`. PO status is **derived from received quantities** (`pending` →
`partially_fulfilled` → `fulfilled`); `paid`/`cancelled` are manual terminal states that lock the PO.
A PO created directly as `fulfilled` instead applies all inventory at once via `apply_po_inventory`.
**Backorders** are the demand side: when an invoice line exceeds stock (Cluster 6 split /
`syncInvoiceBackorder`), an `open` backorder + `backorder_items` are recorded; an admin fulfills it by
creating a PO (via the deep-linked draft), which flushes the backorder to `fulfilled` and links the PO.

---

## 2. Schema

### `suppliers` + `supplier_prices`
```sql
CREATE TABLE suppliers (
  id uuid PK, name text NOT NULL, contact_person text, email text, phone text,
  lead_time_days integer DEFAULT 7, notes text, created_at, updated_at
);
CREATE INDEX idx_suppliers_name ON suppliers (lower(name));

CREATE TABLE supplier_prices (              -- supplier-pricelists-migration.sql
  id uuid PK,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  price numeric(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  created_at, updated_at,
  UNIQUE (supplier_id, product_id)          -- upsert conflict target
);
```

### `purchase_orders` (live DDL — load-bearing parts; full DDL in brief)
```sql
CREATE SEQUENCE IF NOT EXISTS po_number_seq START WITH 1001;   -- MUST precede the table
create table public.purchase_orders (
  id uuid default gen_random_uuid(),
  po_number text not null unique default ('PO-' || lpad(nextval('po_number_seq')::text, 5, '0')),
  supplier_id uuid not null references suppliers(id) on delete RESTRICT,   -- can't delete supplier with POs
  status text default 'pending'
    CHECK (in 'pending','partially_fulfilled','fulfilled','paid','cancelled'),
  subtotal numeric default 0,
  tax_type text default 'percentage' CHECK (in 'percentage','fixed'), tax_value, tax_total numeric,
  discount_type text default 'percentage' CHECK (in 'percentage','fixed'), discount_value, discount numeric,  -- discount-shipping migration
  shipping_fee numeric default 0, order_date date, expected_date date,    -- discount-shipping migration
  total numeric default 0, notes text, created_by uuid (FK SET NULL),
  inventory_applied boolean default false, inventory_applied_at timestamptz,   -- apply_po_inventory idempotency
  created_at, updated_at
);
create trigger purchase_orders_updated_at BEFORE update ... execute set_updated_at();
```
> **Financial order** (create + PATCH, computed server-side): `subtotal → + shipping_fee → − discount
> → + tax = total`. Percentage tax applies to `subtotal + shipping − discount`; percentage discount to
> the subtotal. `discount`/`tax_total` store the computed dollar amounts.

### `purchase_order_items`
`id, purchase_order_id (FK CASCADE), product_id uuid (FK SET NULL), product_variant_id, description,
sku_snapshot, qty (CHECK > 0), unit_price, line_total, qty_received (default 0, CHECK ≥ 0)`.
`qty_received` (receiving migration) is the cumulative-received counter that drives status.

### `purchase_order_receipts` + `purchase_order_receipt_items` (receiving migration)
- Receipts: `id, purchase_order_id (FK CASCADE), note, created_by, created_at` — one row per receiving
  event.
- Receipt items: `id, receipt_id (FK CASCADE), po_item_id (FK CASCADE), product_id (FK SET NULL),
  qty (CHECK > 0)`. **Written only by `receive_po_items`** — no app `.from()`.

### `inventory_log` (purchase-orders-migration.sql — owned here)
`id, product_id (FK SET NULL), delta integer NOT NULL, reason text NOT NULL, reference_type,
reference_id uuid, created_by (FK SET NULL), created_at`. Indexes on `(product_id, created_at DESC)`
and `(reference_type, reference_id)`. **Written only by SECURITY-style functions / service role**
(`apply_po_inventory`, `receive_po_items` here; the decrement RPCs in Cluster 5). RLS: admin/assistant
read; no client write. (The discount-shipping migration defensively ensures its columns exist.)

### `backorders` + `backorder_items` (backorders-migration.sql)
```sql
create table public.backorders (
  id uuid, invoice_id uuid NOT NULL references invoices(id) ON DELETE CASCADE,
  status text default 'open' CHECK (in 'open','fulfilled','cancelled'),
  purchase_order_id uuid references purchase_orders(id) ON DELETE SET NULL,   -- the PO that fulfilled it
  created_at, fulfilled_at
);
CREATE TABLE backorder_items (
  id uuid, backorder_id uuid NOT NULL references backorders(id) ON DELETE CASCADE,
  product_id uuid (FK SET NULL), description text NOT NULL,
  qty_ordered numeric, qty_available numeric, qty_backordered numeric, unit_price numeric DEFAULT 0,
  created_at
);
```
RLS: both enabled with **no public policies** (service-role only).

### RPCs (the stock-increment side)
- **`apply_po_inventory(po_id)`** — `FOR UPDATE` lock; early-return if `inventory_applied`; `UPDATE
  products SET stock_quantity += i.qty`; insert `inventory_log` (`reason:'restock'`,
  `reference_type:'purchase_order'`); set `inventory_applied = true`.
- **`receive_po_items(po_id, actor, note, items jsonb)` → receipt uuid** — lock PO (raise on
  missing / `paid` / `cancelled`); create receipt header; per line: lock the PO item, validate `qty ≤
  qty - qty_received` (raise otherwise), bump `qty_received`, insert a receipt item, and (if
  `product_id`) bump stock + `inventory_log` (`reference_type:'purchase_order_receipt'`); **reject
  empty receipts** (delete header, raise `No quantities to receive`); recompute status
  (`fulfilled`/`partially_fulfilled`/`pending`) + set `inventory_applied`/`_at` when fully received.

### RLS (PO module)
suppliers / purchase_orders / purchase_order_items / receipts / receipt_items: admin+assistant
**read**, admin **write** (scoped EXISTS checks, not blanket `USING(true)`). inventory_log: read-only
admin/assistant. App routes use the service-role client and re-check role.

### Schema usage map

| Table | Read by | Written by |
|---|---|---|
| `suppliers` | suppliers list, PO form | suppliers route (admin) |
| `supplier_prices` | `GET /suppliers/[id]/prices`, PO form | PUT prices (upsert) |
| `purchase_orders` | PO list/detail/pdf, nav | POST/PATCH; RPCs (status, inventory_applied) |
| `purchase_order_items` | PO detail, receiving | POST/PATCH; `receive_po_items` (`qty_received`) |
| `purchase_order_receipts`/`_items` | PO detail (history) | **`receive_po_items` only** |
| `inventory_log` | (admin read; no UI here) | `apply_po_inventory`, `receive_po_items` (+ Cluster 5 decrement) |
| `products.stock_quantity` | — | both restock RPCs (increment) |
| `backorders`/`backorder_items` | backorders list/detail/count | `syncInvoiceBackorder` (Cluster 6, create); PO-create (flush) |

---

## 3. Components

### Status helpers
- **`po-status.ts`** — `PO_STATUSES`, `PO_STATUS_META` (label + badge + PDF bg/fg per status),
  **`isPoLocked(status)`** = `paid || cancelled`, **`canReceivePo(status)`** = `!== cancelled` (a
  `paid` PO can still receive — paid-before-delivery).
- **`backorder-sync.ts` — `syncInvoiceBackorder(db, invoiceId, lineItems)`** (Cluster 6 caller):
  deletes the invoice's existing **open** backorder (leaving fulfilled history), recomputes which
  lines exceed `products.stock_quantity`, and inserts a fresh `open` backorder + `backorder_items`.
  Best-effort.

### Suppliers + prices
- **`GET/POST /api/admin/suppliers`**, **`PATCH/DELETE /api/admin/suppliers/[id]`** — admin/assistant
  read, admin write/delete. DELETE relies on the `ON DELETE RESTRICT` FK (raw error surfaced when the
  supplier has POs).
- **`GET/PUT /api/admin/suppliers/[id]/prices`** — GET returns every active product joined with this
  supplier's price (`supplier_price: null` when none → callers fall back to `original_price`); PUT
  upserts rows on `supplier_id,product_id`. `lib/admin/supplier-prices.ts` wraps these.

### Purchase orders
- **`GET/POST /api/admin/purchase-orders`** — `verifyAdminRole` (read admin/assistant; mutate admin).
  POST validates supplier + ≥1 line; computes totals server-side (the discount→tax order above);
  inserts the PO + items (rolls back the PO if item insert fails); **if `status:'fulfilled'`** →
  `apply_po_inventory` + sets each line `qty_received = qty`; **if `backorder_id`** → flush the
  backorder (`fulfilled` + link PO, only when still `open`). Returns `{purchase_order}`.
- **`GET/PATCH /api/admin/purchase-orders/[id]`** — GET joins supplier/items/receipts. **PATCH
  enforces the lock**: when `isLocked` (paid/cancelled) **only `status`** may change (else 422);
  rejects manual `fulfilled`/`partially_fulfilled` (those are receiving-derived, 422); **freezes line
  items once any `qty_received > 0`** (422); otherwise replaces items + recomputes totals.
- **`POST /api/admin/purchase-orders/[id]/receipts`** — admin; filters to positive `{po_item_id, qty}`
  (400 if none); calls `receive_po_items`; RPC raises map to 400 (e.g. over-receive, locked PO, empty);
  returns the refreshed PO (with receipts).
- **`GET /api/admin/purchase-orders/[id]/pdf`** — pdfkit PO document (palette/status from
  `PO_STATUS_META`).
- `lib/admin/purchase-orders.ts` wraps list/get/create/update/receive (bearer-token fetch).

### Backorders
- **`GET /api/admin/backorders?status=open|fulfilled|cancelled`** — **staff only** (admin/assistant;
  hidden from affiliates). Joins invoice (+customer) + items + the linked PO; derives
  `customer_name_display`, `item_count`, `total_backordered`.
- **`GET /api/admin/backorders/[id]`** — single backorder + items (used to prefill a PO draft).
- **`GET /api/admin/backorders/count`** — `head:true count` of `open` backorders for the admin nav
  badge (Cluster 1 layout consumes it).

### UI
- **`/admin/purchase-orders`** (list) — status filter via `PO_STATUS_META`; edit-vs-view gated by
  `isPoLocked`; link to **Suppliers**.
- **`/admin/purchase-orders/new`** + **`PurchaseOrderForm.tsx`** — supplier picker, line builder
  (supplier-price aware), discount/shipping/tax; **prefills from `?backorder=<id>`**.
- **`PurchaseOrderReceiving.tsx`** — per-line receive panel; `canReceivePo` + fully-received guard;
  "fill remaining" helper; progress bar (emerald when fully received, bronze otherwise) → POSTs to
  `/receipts`.
- **`/admin/backorders`** — Open/Fulfilled tabs; each open row has a **Fulfill** button →
  `/admin/purchase-orders/new?backorder=<id>`.
- **`/admin/purchase-orders/suppliers`** + **`/supplier-pricelists`** — supplier CRUD + price sheets.

---

## 4. UI/UX design overview

Shared admin theme: `ink #1A1A1A`, `ink-muted #6E6E6E`, `bronze #9C8B5A`, `surface #F7F7F7`,
`line #C9CCD1`. Icons `lucide-react` (`PackageX` backorders, `PackageCheck` receiving, `Building2`
suppliers, `Wrench` fulfill).

- **PO status badges** (`PO_STATUS_META`): pending `amber`, partially_fulfilled `blue`, fulfilled
  `violet`, paid `emerald`, cancelled `red` (PDF reuses the matching hexes).
- **Receiving panel:** progress bar `bg-emerald-500` when fully received else `bg-bronze`; per-line
  Ordered / Received / Receive inputs; disabled when `!canReceivePo` or fully received.
- **Backorders:** `PackageX` bronze heading; Open/Fulfilled tabs; Fulfill button (`Wrench`) deep-links
  the PO draft.
- Standard admin recipes for cards (`bg-white rounded-xl border border-line`), primary buttons
  (`bg-ink`), inputs (`bg-surface … focus:ring-bronze/40`).

---

## 5. Data flow & behavior

### Receiving (normal restock)
admin enters quantities → `POST /[id]/receipts` → `receive_po_items` (locks, validates `≤ remaining`,
rejects empty) → per line: `qty_received +=`, receipt item, `stock_quantity +=`, `inventory_log`
append → recompute PO status (`partially_fulfilled`/`fulfilled`) + `inventory_applied`. Concurrency-
safe via `FOR UPDATE`.

### Create-as-fulfilled (whole-PO restock)
POST with `status:'fulfilled'` → insert PO+items → `apply_po_inventory` (idempotent via
`inventory_applied`) → set every line `qty_received = qty`.

### Backorder loop (demand → procurement → restock)
Cluster 6 records an `open` backorder when invoice demand exceeds stock → admin clicks **Fulfill**
(`?backorder=<id>` prefill) → PO created with `backorder_id` → PO-create **flushes** the backorder
(`fulfilled` + `purchase_order_id` + `fulfilled_at`) → receiving the PO raises stock so the original
invoice can ship (Cluster 6/fulfillment). The backorder list joins the PO back for visibility.

### Locking & freezing
`isPoLocked` (paid/cancelled) → PATCH allows only `status`. Any received quantity freezes line edits.
Manual `fulfilled`/`partially_fulfilled` is rejected — those are receiving-derived.

### Authorization
Reads admin/assistant; mutations admin (`canCreate`/`canDelete`). Backorders are staff-only
(admin/assistant), hidden from affiliates. All routes use the service-role client + explicit role
checks (RLS is defense-in-depth).

---

## 6. Edge cases & states

- **Sequence missing:** PO insert fails on the default — create `po_number_seq` first.
- **Over-receive:** `receive_po_items` raises `only N remaining` → 400.
- **Empty receipt:** header deleted, raises `No quantities to receive` → 400.
- **Receive on paid/cancelled:** raises → 400 (`canReceivePo` also gates the UI; `paid` *can* receive).
- **Edit locked PO:** 422 listing disallowed fields. **Edit after receiving started:** 422.
- **Manual fulfilled/partially_fulfilled via PATCH:** 422 (receiving-derived).
- **Delete supplier with POs:** `ON DELETE RESTRICT` → DB error surfaced (no friendly message).
- **Double apply / re-receive same PO:** `inventory_applied` makes `apply_po_inventory` a no-op;
  receiving validates against `qty_received` so it can't exceed ordered.
- **Backorder flush race:** only flips a still-`open` backorder.
- **Supplier with no price row:** `supplier_price: null` → callers fall back to `original_price`.

---

## 7. Open questions & unverified items

- **`product_variant_id` / `product_variants`** is referenced by `purchase_order_items` but variants
  appear unused by the current PO paths (lines carry `product_id`). Confirm before porting.
- **Supplier DELETE error mapping:** the route returns the raw Postgres RESTRICT error; a friendlier
  "supplier has purchase orders" message would be a porting improvement, not current behavior.
- **`backorders.status = 'cancelled'`** is in the CHECK + list filter but no route was found that sets
  it (only `open` on create and `fulfilled` on flush). Confirm whether cancellation is reachable.
- **`syncInvoiceBackorder` lives in this cluster's helpers but is called from Cluster 6** (invoice
  PATCH / split). Port both or guard the call. The Cluster-6 split path also inserts
  `backorders`/`backorder_items` directly.
- **PDF route** (`/[id]/pdf`) summarized by role + palette; layout geometry not transcribed.
- **The admin pages/forms** (`PurchaseOrderForm.tsx`, `PurchaseOrderReceiving.tsx`, list/backorders/
  suppliers pages) were captured at the structural level (headings, actions, the deep-link, the
  receiving guard) rather than line-by-line.
- **`receive_po_items` / `apply_po_inventory` are plain `LANGUAGE plpgsql`** (not declared SECURITY
  DEFINER in the migration); they run under the service-role key from the routes, which bypasses RLS.
  Confirm the privilege model if exposing them to JWT clients.
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (all routes).
