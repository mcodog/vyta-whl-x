# Module 9 — Purchase Orders & Suppliers

This module lets staff order stock from suppliers and track its arrival. Admins create a **purchase order (PO)** by picking (or inline-creating) a supplier and adding line items from the product catalog, with percentage or fixed tax. POs carry an auto-generated `PO-#####` number and a status (`pending → partially_fulfilled → fulfilled → paid → cancelled`). Fulfilment happens through **line-item receiving**: each delivery records how many of each line arrived, which atomically increments product stock, writes an `inventory_log` entry, builds a **process/receiving history**, and derives the PO status from received quantities (a completion percentage is shown per line and overall). `paid` and `cancelled` are manual terminal/locked states. A PO can also be created directly to fulfil a backorder (the backorder is "flushed" on success — see Module 2). Suppliers have their own CRUD page and an inline create flow inside the PO form. A PDF of any PO can be generated.

> NOTE ON AFFILIATES: This app has an Affiliate program that is NOT being ported. Purchase Orders and Suppliers are **not** in the affiliate-allowed page list (`AFFILIATE_PAGES` in `lib/permissions.ts`), so affiliates never reach this module. The permission helpers `canCreate`/`canDelete` are **admin-only**; reads are admin/assistant. No affiliate logic is entangled here. When porting you can drop `'affiliate'` from the `UserRole` union.

---

## Data model

Two migrations: `purchase-orders-migration.sql` (core) and `purchase-orders-receiving-migration.sql` (partial receipts). Both idempotent.

### `suppliers`

| Column | Type | Default | Constraints |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | PK |
| `name` | `text` | — | `NOT NULL` |
| `contact_person` | `text` | — | |
| `email` | `text` | — | |
| `phone` | `text` | — | |
| `lead_time_days` | `integer` | `7` | |
| `notes` | `text` | — | |
| `created_at` | `timestamptz` | `now()` | `NOT NULL` |
| `updated_at` | `timestamptz` | `now()` | `NOT NULL` (bumped by `trg_suppliers_updated_at`) |

Index: `idx_suppliers_name` on `lower(name)`.

### `purchase_orders`

A sequence `po_number_seq` starts at 1001.

| Column | Type | Default | Constraints |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | PK |
| `po_number` | `text` | `'PO-' || LPAD(nextval('po_number_seq')::text, 5, '0')` | `UNIQUE NOT NULL` (e.g. `PO-01001`) |
| `supplier_id` | `uuid` | — | `NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT` |
| `status` | `text` | `'pending'` | `NOT NULL CHECK (status IN ('pending','partially_fulfilled','fulfilled','paid','cancelled'))` |
| `subtotal` | `numeric(10,2)` | `0` | `NOT NULL` |
| `tax_type` | `text` | `'percentage'` | `NOT NULL CHECK (tax_type IN ('percentage','fixed'))` |
| `tax_value` | `numeric(10,2)` | `0` | `NOT NULL` (rate % or fixed $) |
| `tax_total` | `numeric(10,2)` | `0` | `NOT NULL` |
| `total` | `numeric(10,2)` | `0` | `NOT NULL` |
| `notes` | `text` | — | |
| `expected_date` | `date` | — | |
| `inventory_applied` | `boolean` | `false` | `NOT NULL` (true once fully received) |
| `inventory_applied_at` | `timestamptz` | — | |
| `created_by` | `uuid` | — | `REFERENCES customers(id) ON DELETE SET NULL` |
| `created_at` | `timestamptz` | `now()` | `NOT NULL` |
| `updated_at` | `timestamptz` | `now()` | `NOT NULL` (bumped by `trg_purchase_orders_updated_at`) |

Indexes: `idx_purchase_orders_supplier_id`, `idx_purchase_orders_status`, `idx_purchase_orders_created_at (created_at DESC)`.

### `purchase_order_items`

| Column | Type | Default | Constraints |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | PK |
| `purchase_order_id` | `uuid` | — | `NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE` |
| `product_id` | `uuid` | — | `REFERENCES products(id) ON DELETE SET NULL` |
| `description` | `text` | — | `NOT NULL` |
| `sku_snapshot` | `text` | — | (the product slug at time of PO) |
| `qty` | `integer` | — | `NOT NULL CHECK (qty > 0)` |
| `qty_received` | `integer` | `0` | `NOT NULL CHECK (qty_received >= 0)` (added by receiving migration; backfilled to `qty` for legacy `inventory_applied` POs) |
| `unit_price` | `numeric(10,2)` | `0` | `NOT NULL` |
| `line_total` | `numeric(10,2)` | `0` | `NOT NULL` |
| `created_at` | `timestamptz` | `now()` | `NOT NULL` |

Indexes: `idx_po_items_po_id`, `idx_po_items_product_id`.

### `inventory_log`

Append-only audit of stock deltas.

| Column | Type | Default | Constraints |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | PK |
| `product_id` | `uuid` | — | `REFERENCES products(id) ON DELETE SET NULL` |
| `delta` | `integer` | — | `NOT NULL` |
| `reason` | `text` | — | `NOT NULL` (e.g. `'restock'`) |
| `reference_type` | `text` | — | e.g. `'purchase_order'`, `'purchase_order_receipt'` |
| `reference_id` | `uuid` | — | |
| `created_by` | `uuid` | — | `REFERENCES customers(id) ON DELETE SET NULL` |
| `created_at` | `timestamptz` | `now()` | `NOT NULL` |

Indexes: `idx_inventory_log_product (product_id, created_at DESC)`, `idx_inventory_log_reference (reference_type, reference_id)`.

### `purchase_order_receipts` (receiving event header / process history)

| Column | Type | Default | Constraints |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | PK |
| `purchase_order_id` | `uuid` | — | `NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE` |
| `note` | `text` | — | |
| `created_by` | `uuid` | — | `REFERENCES customers(id) ON DELETE SET NULL` |
| `created_at` | `timestamptz` | `now()` | `NOT NULL` |

Index: `idx_po_receipts_po_id (purchase_order_id, created_at DESC)`.

### `purchase_order_receipt_items` (what was received in one event)

| Column | Type | Default | Constraints |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | PK |
| `receipt_id` | `uuid` | — | `NOT NULL REFERENCES purchase_order_receipts(id) ON DELETE CASCADE` |
| `po_item_id` | `uuid` | — | `NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE` |
| `product_id` | `uuid` | — | `REFERENCES products(id) ON DELETE SET NULL` |
| `qty` | `integer` | — | `NOT NULL CHECK (qty > 0)` |
| `created_at` | `timestamptz` | `now()` | `NOT NULL` |

Indexes: `idx_po_receipt_items_receipt`, `idx_po_receipt_items_po_item`.

### Triggers / functions

- **`set_updated_at()`** trigger fn → `trg_suppliers_updated_at`, `trg_purchase_orders_updated_at` (BEFORE UPDATE).
- **`apply_po_inventory(po_id uuid)`** — legacy all-at-once apply. `FOR UPDATE` locks the PO; returns early if `inventory_applied` is not false (idempotent). Adds each item's `qty` to `products.stock_quantity`, inserts `inventory_log` rows (`reason='restock', reference_type='purchase_order'`), and sets `inventory_applied=true, inventory_applied_at=now()`. Still used when a PO is **created** with status `fulfilled`.
- **`receive_po_items(p_po_id, p_actor, p_note, p_items jsonb)` → returns receipt uuid** — the main receiving path. Runs in one transaction (`FOR UPDATE` on the PO and each line). Rejects if PO not found, or status is `paid`/`cancelled` (`'Purchase order is X and cannot receive items'`). Inserts a receipt header (note trimmed, NULL if empty). For each `{po_item_id, qty}` (skips qty<=0): validates the line belongs to the PO; validates `qty <= remaining` (`qty - qty_received`) else raises `'Cannot receive N of "desc": only M remaining'`; increments `qty_received`; inserts a receipt item; if the line has a `product_id`, increments `products.stock_quantity` and inserts an `inventory_log` row (`reason='restock', reference_type='purchase_order_receipt'`). If no lines were received the empty receipt is deleted and it raises `'No quantities to receive'`. Finally recomputes status: `fulfilled` if every unit received, `partially_fulfilled` if some, else `pending`; sets `inventory_applied`/`inventory_applied_at` when fully received.

### RLS

`service_role` bypasses RLS. Explicit JWT-client policies (all check `customers.role` for `auth.uid()`):
- `suppliers`, `purchase_orders`, `purchase_order_items`: **read** for `('admin','assistant')`; **write** (`FOR ALL` USING+WITH CHECK) for `'admin'` only.
- `inventory_log`: **read-only** for `('admin','assistant')`; writes happen via SECURITY DEFINER functions / service role.
- `purchase_order_receipts`, `purchase_order_receipt_items`: **read** for `('admin','assistant')`; writes exclusively through `receive_po_items()` via the service role.

---

## API endpoints

All routes use the **service-role** Supabase client and a `verifyAdminRole` helper: Bearer token → `auth.getUser` → `customers.role`. Pattern: **reads** allowed for admin/assistant; **mutations** require `canCreate(role)` (admin only). Deletes require `canDelete(role)` (admin only). 403 on failure.

### `app/api/admin/purchase-orders/route.ts`

- **GET `/api/admin/purchase-orders?status=&supplier_id=`** — list. Selects `*, supplier:suppliers(id,name), items:purchase_order_items(id)`, ordered `created_at DESC`. Filters by status (unless `all`) and supplier. Returns `{ purchase_orders }`.
- **POST `/api/admin/purchase-orders`** — create (admin). Body: `{ supplier_id, status='pending', tax_type='percentage', tax_value=0, expected_date=null, notes=null, items=[], backorder_id=null }`.
  - 400 if no `supplier_id`; 400 if `items` empty.
  - **Totals computed server-side** (client values ignored): each item `qty>0`, `unit_price>=0` (else throws "Invalid item qty"/"Invalid item unit_price"); `line_total = qty*unit` (2dp); `subtotal = Σ line_total`; `tax_total = subtotal*(tax_value/100)` for percentage or `tax_value` for fixed; `total = subtotal + tax_total`. `created_by = userId`.
  - Inserts the PO then the items; if items fail, the PO is rolled back (deleted).
  - If `status === 'fulfilled'` at creation → calls `apply_po_inventory` and sets every line's `qty_received = qty` (so completion reads 100%).
  - If `backorder_id` set → `UPDATE backorders SET status='fulfilled', purchase_order_id=po.id, fulfilled_at=now() WHERE id=backorder_id AND status='open'` (best-effort).
  - 201 `{ purchase_order }`.

### `app/api/admin/purchase-orders/[id]/route.ts`

- **GET** — full PO: `*, supplier:suppliers(*), items:purchase_order_items(*)` plus `receipts:purchase_order_receipts(*, items:purchase_order_receipt_items(*))` (receipts tolerated as missing). 404 if not found. Returns `{ purchase_order }`.
- **PATCH** — edit (admin). Loads existing; 404 if missing. Validation gates:
  - **Locked** (`paid`/`cancelled`): only `status` may change, else 422 listing disallowed fields.
  - Setting `status` to `fulfilled`/`partially_fulfilled` is rejected 422 ("Use the receiving panel to fulfill line items; this status is set automatically.").
  - If `items` supplied but any line already has `qty_received > 0` → 422 ("Line items can't be changed after receiving has started.").
  - Applies allowed scalar fields (`supplier_id, status, tax_type, tax_value, expected_date, notes`). If `items` supplied: validates (qty>0, unit_price>=0), **deletes and re-inserts** all line items, recomputes totals. Totals also recomputed when tax fields change. Returns fresh `{ purchase_order }`.

### `app/api/admin/purchase-orders/[id]/receipts/route.ts`

- **POST** — record a receipt (admin; `canCreate`). Body `{ note?, items: [{po_item_id, qty}] }`. Cleans items to `{po_item_id, qty>0}`; 400 if none ("Enter at least one quantity to receive"). Calls `supabase.rpc('receive_po_items', { p_po_id, p_actor: userId, p_note, p_items })`. RPC errors → 400 with the RPC message (e.g. the "only M remaining" message). On success returns 201 with the fresh PO (incl. receipts).

### `app/api/admin/purchase-orders/[id]/pdf/route.ts`

- **GET** — admin/assistant read. Generates an HTML/PDF document of the PO (supplier, items, totals, status badge using `PO_STATUS_META` colors, issue + expected dates). Returns the document; the UI opens it in a new tab. 403/404 as plain text.

### `app/api/admin/suppliers/route.ts`

- **GET** — admin/assistant; `{ suppliers }` ordered by name.
- **POST** — admin only. 400 if `name` blank ("Supplier name is required"). Inserts `{ name (trimmed), contact_person, email, phone, lead_time_days=7, notes }`. 201 `{ supplier }`.

### `app/api/admin/suppliers/[id]/route.ts`

- **PATCH** — admin only (`canCreate`). Builds patch from `name, contact_person, email, phone, lead_time_days, notes`; 400 if nothing to update. Returns `{ supplier }`.
- **DELETE** — admin only (`canDelete`). Deletes the supplier; `{ ok: true }`. (DB FK is `ON DELETE RESTRICT` from `purchase_orders`, so a supplier with POs cannot be deleted — the DB error surfaces as 500.)

### Client wrapper — `lib/admin/purchase-orders.ts`

Browser helpers calling the routes (with `Authorization: Bearer <session token>`), plus direct supabase reads:
- `getPurchaseOrders(filters?)` → list with `item_count` and client-side search over `po_number` / supplier name.
- `getPurchaseOrder(id)` → single PO with supplier, items, and receipts (receipts loaded separately and tolerated as unavailable).
- `createPurchaseOrder(input)`, `updatePurchaseOrder(id, patch)`, `receivePurchaseOrderItems(id, {note, items})`.
- `getAllSuppliers()`, `searchSuppliers(term)` (ilike on name/email, limit 8), `createSupplier`, `updateSupplier`, `deleteSupplier`.

### Status helpers — `lib/admin/po-status.ts`

- `PO_STATUSES` array (the 5 statuses).
- `PO_STATUS_META[status]` → `{ label, badge (tailwind classes), pdfBg, pdfFg }` (see badge colors below).
- `isPoLocked(status)` → true for `paid` or `cancelled`.

---

## Frontend

State management: **local React state** + the shared `supabase` client and the `lib/admin/purchase-orders` wrappers. No React Query/context.

| Route | File | Purpose |
|---|---|---|
| `/admin/purchase-orders` | `app/(admin)/admin/purchase-orders/page.tsx` | List + stat cards + search/filter. |
| `/admin/purchase-orders/new` | `app/(admin)/admin/purchase-orders/new/page.tsx` | Create (optionally `?backorder=<id>`). |
| `/admin/purchase-orders/[id]` | `app/(admin)/admin/purchase-orders/[id]/page.tsx` | Detail = receiving panel + editable form. |
| `/admin/purchase-orders/suppliers` | `app/(admin)/admin/purchase-orders/suppliers/page.tsx` | Supplier CRUD. |

Shared components (same folder): **`PurchaseOrderForm.tsx`** (create + edit, supplier search/inline-create, product picker, line items, tax, status), **`PurchaseOrderReceiving.tsx`** (completion summary, per-line progress, receive form, process history).

Data flow for create-with-backorder: `/new` reads `?backorder=<id>`, GETs `/api/admin/backorders/[id]`, maps items to draft lines using `qty_backordered` (unit_price 0), and renders `<PurchaseOrderForm mode="create" prefillItems backorderId>`. On submit the server flushes the backorder.

---

## UI/UX specification

Tokens: `ink`, `ink-muted`, `bronze` (~`#9C8B5A`), `surface`, `line` (`#C9CCD1`), white. Cards `bg-white rounded-xl border border-line`.

### List page (`/admin/purchase-orders`)

- **Header:** `<ClipboardList>` bronze + "Purchase Orders"; subtitle "N order(s)". Right: **"Suppliers"** link (`<Building2>`, outline) → `/admin/purchase-orders/suppliers`; **"Create"** button (`<Plus>`, dark) → `/new`.
- **Stat cards** (4): "Total Orders" (count), "Total Value" ($ sum), "Open Value" (sum of non-paid/non-cancelled, **highlighted** bronze border/text), "Paid Orders" (count of paid).
- **Toolbar:** search input (`<Search>`, placeholder "Search by PO # or supplier...") + status `<select>` (`<Filter>`, "All Statuses" + each status label).
- **Table** (`min-w-[820px]`): `PO #` (mono link → detail, hover bronze), `Supplier` (name or `—`), `Items` (count), `Total` ($ bold), `Expected` (date or `—`), `Status` (badge), `Created` (date), actions. Actions: `<Pencil>` icon-link → detail (title "Edit purchase order" or, when locked, "View purchase order"); `<FileText>` button → opens PDF in new tab (`alert('Could not open PDF')` on failure).
- **Loading:** colspan-8 "Loading…". **Empty:** "No purchase orders yet" (no rows) or "No orders match your filters".

### New PO page (`/admin/purchase-orders/new`)

- Back arrow (→ `/admin/backorders` if from a backorder, else `/admin/purchase-orders`), title "New Purchase Order", subtitle "Pick a supplier and add line items."
- If `?backorder` with an invoice number: a bronze info banner (`<PackageX>`) "Fulfilling the backorder for invoice **{invoice_number}**. The backordered quantities are prefilled below — pick a supplier, set costs, and create the PO to clear the backorder."
- Errors in a red banner. While loading the backorder: spinner "Loading backorder…". Then renders the form.

### PurchaseOrderForm (create & edit)

Two-column grid (`lg:grid-cols-3`; left spans 2). Helper sub-components: `Card` (title + optional bronze icon), `Field` (uppercase label), `Row` (summary line), `QuickStatusBtn`.

- **Left column** (dimmed + non-interactive when `itemsLocked`):
  - If receiving started (and not locked): blue banner (`<AlertCircle>`) "Receiving has started, so the supplier and line items are locked. Use the receiving panel above to record deliveries. Tax, dates, and notes can still be edited."
  - **Supplier card** (`<Building2>`): if a supplier is chosen, shows its name, contact, email, phone, "Lead time: N days" (bronze) and a "Change" link. Otherwise a search box "Search suppliers by name or email..." with a debounced (220ms) dropdown of matches (name + "contact · email"); the dropdown's last row, when there's a query, is bronze **"Create new supplier "{query}""** (`<Plus>`). Below the box a bronze toggle **"Create new supplier"** / **"Cancel new supplier"** opens an inline form (fields: **Name \***, Contact person, Email, Phone, Lead time (days, default 7)) with a dark **"Save supplier"** button.
  - **Products card** (`<Package>`): search "Search products..."; a 2/3-col grid of toggle cards (name, strength, `$price`); selected cards get bronze border/`bronze/5`. Paginated 10 at a time via **"Show more (N remaining)"**. "No products match." when empty.
  - **Selected Products** card (only if items exist): table `Product | SKU | Unit $ | Qty | Total |` with editable number inputs for unit price (min 0, step .01) and qty (min 1), a live `$` line total, and an `<X>` remove button.
- **Right column:**
  - **Financial Summary** card: Tax Type segmented toggle **Percentage / Fixed**; a "Tax rate (%)" or "Tax amount ($)" number input; then Subtotal / Tax (label shows the % when percentage) / **Total** (bold).
  - **Status card:** create mode → **"Initial Status"** with status buttons (excluding `partially_fulfilled`); selecting `paid`/`cancelled` shows an amber warning "This PO will be locked immediately. Only the status can change afterwards." Edit mode → **"Quick Status Actions"** with helper text "Fulfillment is tracked in the receiving panel above. These actions set the terminal payment state." and two buttons: **"Mark as Paid"** (emerald, disabled if already paid) and **"Cancel Order"** (ghost, hover red, disabled if already cancelled).
  - **Details card:** "Expected delivery date" (date input) and "Notes" textarea (placeholder "Internal notes (optional)").
  - **Submit** (hidden when locked): full-width dark button "Create Purchase Order" (`<Plus>`) / "Save Changes" (`<Save>`); shows "Saving…" spinner; disabled if no supplier or no items. Client validation messages: "Pick a supplier", "Add at least one line item". Server errors shown in a red `<AlertCircle>` banner.
- All `disabled` inputs render with surface bg / muted text. Inputs share a `.input` class (white bg, `#C9CCD1` border, bronze focus ring).

### PO detail page (`/admin/purchase-orders/[id]`)

- Header: back arrow → list, mono `po_number` title, "Created {datetime}" + status badge, and a **"View PDF"** button (`<FileText>`).
- If locked: amber banner (`<Lock>`) "This purchase order is **{status}** and cannot be edited. You can still update the payment status below."
- Renders **`<PurchaseOrderReceiving>`** then **`<PurchaseOrderForm mode="edit">`**. `onChanged` reloads the PO.
- Loading: "Loading purchase order…" spinner. Not found: "Purchase order not found." + "Back to list".

### PurchaseOrderReceiving panel

- **Completion summary card** (`<PackageCheck>` "Receiving" + "X% complete"): a progress bar (bronze, turns **emerald** when fully received), text "R of O units received · M remaining". A per-line table `Item | Ordered | Received | Remaining | Progress`; remaining is amber when >0 else emerald; each line has a mini progress bar. When done: emerald "All items received." (`<CheckCircle2>`).
- Receive actions (shown when not locked and not fully received): dark **"Receive items"** (`<Plus>`, blank draft) and outline **"Receive all remaining"** (prefills each line's remaining).
- **Receive form** (bronze-bordered card "Record a receipt"): table `Item | Remaining | Receive now` with per-line number inputs (`min 0, max remaining`, disabled when remaining 0). A "Note (optional)" input (placeholder "e.g. Partial delivery, 2 boxes damaged"). Client errors: "Enter at least one quantity to receive." / `"{item}" only has {N} remaining.`. Buttons: **"Save receipt"** (`<PackageCheck>`, dark; "Saving…" spinner) and **"Cancel"**.
- **Process History card** (`<History>` "Process History"): a vertical timeline (bronze dots) — each receipt shows datetime, "{N} units", a `+qty {item}` list, and the note in italics/quotes if present. Sorted newest first.

### Suppliers page (`/admin/purchase-orders/suppliers`)

- Header: back arrow, `<Building2>` "Suppliers", "N supplier(s)"; **"Add Supplier"** button (`<Plus>`).
- Search box "Search suppliers...".
- Inline **SupplierForm** appears when creating/editing (title "Add Supplier"/"Edit Supplier"): fields **Company name \*** (full width), Contact person, Email, Phone, Lead time (days), Notes. Validation "Name is required". Buttons **Create/Save** (`<Save>`) + **Cancel** (`<X>`). Errors in red banner.
- List: each row = bronze avatar tile, name + (contact/email/phone), a `"{N}d lead"` chip, and edit (`<Edit2>`) / delete (`<Trash2>`) buttons. Delete uses **two-step inline confirm**: clicking trash swaps to red **"Confirm delete"** + "Cancel".
- Loading "Loading…"; empty "No suppliers yet. Add your first one." / "No suppliers match.".

### Status badges (`PO_STATUS_META`)

| Status | Label | Badge classes | PDF colors (bg / fg) |
|---|---|---|---|
| `pending` | Pending | `bg-amber-500/10 text-amber-600` | `#FEF3C7` / `#92400E` |
| `partially_fulfilled` | Partially Fulfilled | `bg-blue-500/10 text-blue-600` | `#DBEAFE` / `#1E40AF` |
| `fulfilled` | Fulfilled | `bg-violet-500/10 text-violet-600` | `#EDE9FE` / `#5B21B6` |
| `paid` | Paid | `bg-emerald-500/10 text-emerald-600` | `#D1FAE5` / `#065F46` |
| `cancelled` | Cancelled | `bg-red-500/10 text-red-600` | `#FEE2E2` / `#991B1B` |

### Responsive

Tables wrapped in `overflow-x-auto` with `min-w-[...]`; form grids collapse to one column on mobile (`sm:`/`lg:` breakpoints); header rows stack (`flex-col sm:flex-row`).

---

## Dependencies

- **npm:** `@supabase/supabase-js`, `next` (App Router route handlers, `next/navigation`, `Suspense`), `react`, `lucide-react` (`ClipboardList, Building2, Plus, Search, Filter, FileText, Pencil, Package, PackageX, PackageCheck, History, Lock, Save, X, AlertCircle, CheckCircle2, Loader2, Edit2, Trash2, ArrowLeft`), Tailwind CSS.
- **Internal modules:**
  - `lib/supabase.ts` — client + types `Supplier`, `PurchaseOrder`, `PurchaseOrderItem`, `PurchaseOrderReceipt(Item)`, `PurchaseOrderStatus`, `PurchaseOrderTaxType`, `Product`.
  - `lib/admin/purchase-orders.ts` — all client wrappers.
  - `lib/admin/po-status.ts` — statuses, meta, `isPoLocked`.
  - `lib/permissions.ts` — `canCreate`, `canDelete`.
  - The **products** catalog (line items reference products; receiving increments `products.stock_quantity`).
  - **Module 2 (Inventory & Stock)** — `backorders` table (FK + the "flush on create" flow) and `inventory_log` (written by `apply_po_inventory`/`receive_po_items`).
  - `customers` table — `created_by` and RLS role checks.
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

---

## Porting notes

- **Migration order:** run `purchase-orders-migration.sql` first (needs `products` and `customers`), then `purchase-orders-receiving-migration.sql`. Backorders integration also needs the `backorders` table from Module 2 — `purchase_orders.id` is referenced by `backorders.purchase_order_id`, and `backorders-migration.sql` references `purchase_orders`, so create `purchase_orders` before running it.
- **Status is derived, not freely set.** Never let the edit form/PATCH set `fulfilled`/`partially_fulfilled` — those come only from `receive_po_items()`. The form's only manual status transitions are the create-time "Initial Status" and the edit-time "Mark as Paid" / "Cancel Order" quick actions.
- **Two stock-application paths exist:** the legacy `apply_po_inventory` (used only when a PO is *created* already `fulfilled`) and the per-receipt `receive_po_items`. Both are idempotent/atomic (`FOR UPDATE`, guarded flags). Keep both, or simplify to receiving-only if you don't need create-as-fulfilled.
- **Line items freeze after first receipt** (server 422 + client `itemsLocked`); supplier/items locked, but tax/date/notes still editable. `paid`/`cancelled` lock everything except status.
- **Totals are always recomputed server-side** — never trust client `line_total`/`subtotal`/`total`/`tax_total`.
- **Editing items = delete-and-reinsert** all `purchase_order_items` for the PO (only allowed before any receiving). Receipt rows reference items by id, which is why editing is blocked once receiving starts.
- **Supplier delete** is `ON DELETE RESTRICT` from `purchase_orders`; expect a DB error if a supplier has POs (surfaces as 500). Consider a friendlier message when porting.
- **`po_number` sequence starts at 1001** → first PO is `PO-01001`. Adjust the sequence start if the target site needs a different scheme.
- **Affiliate stripping:** nothing to remove — this module is admin (write) / admin+assistant (read) only and not in `AFFILIATE_PAGES`. Keep the `canCreate`/`canDelete` (admin) and read (`admin`/`assistant`) checks. Drop `'affiliate'` from `UserRole` when convenient.
- **Suggested implementation order:** (1) suppliers table + CRUD page/API; (2) `purchase_orders`/`purchase_order_items` + create/list/edit + `apply_po_inventory`; (3) receiving migration + `receive_po_items` + `PurchaseOrderReceiving` panel + derived status; (4) PDF route; (5) backorder "Fulfill" prefill flow (after Module 2's backorders exist).
