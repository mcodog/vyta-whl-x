# Module 8 — Pricing & Pricelists

This module governs the prices used when building invoices. It has two independent-but-related mechanisms: (1) **Pricelists** — named, switchable price lists (one can be flagged *active*), where each list holds a per-product price; the **active** pricelist supplies the default unit price when an admin adds a line item in the invoice builder (falling back to `products.price` when a product isn't in the list). (2) **Customer-specific price overrides** — per-customer, per-product override prices managed on a dedicated Pricing page, including single-add, multi-customer add, a two-step bulk-edit grid, and a CSV price-list import with a downloadable template, validation, and preview-then-apply. The Pricelists UI is surfaced as a tab inside the Invoices page; the customer-pricing UI is its own page at `/admin/pricing`.

> **Affiliate note (stripped):** In this codebase, affiliates can manage customer price overrides for *only the customers bound to them* (scoped server-side). **That scoping is NOT being ported.** This doc describes admin (and where applicable assistant) behavior. Each spot where affiliate logic was removed is flagged `> AFFILIATE STRIPPED`. Pricelists themselves have **no** affiliate involvement.

---

## Data model

### `pricelists` (`pricelist-migration.sql`)

| Column | Type | Default / Constraint |
|---|---|---|
| `id` | `UUID` | PK, `gen_random_uuid()` |
| `name` | `TEXT` | `NOT NULL` |
| `is_active` | `BOOLEAN` | `NOT NULL DEFAULT false` |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT now()` |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT now()` (bumped by `pricelists_updated_at` trigger → `update_pricelists_updated_at()`) |

**Constraint — at most one active list:** partial unique index
```sql
CREATE UNIQUE INDEX IF NOT EXISTS pricelists_single_active
  ON pricelists (is_active) WHERE is_active;
```

### `pricelist_items` (`pricelist-migration.sql`)

| Column | Type | Default / Constraint |
|---|---|---|
| `id` | `UUID` | PK, `gen_random_uuid()` |
| `pricelist_id` | `UUID` | `NOT NULL` FK → `pricelists(id)` `ON DELETE CASCADE` |
| `product_id` | `UUID` | `NOT NULL` FK → `products(id)` `ON DELETE CASCADE` |
| `price` | `DECIMAL(10,2)` | `NOT NULL CHECK (price >= 0)` |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | `DEFAULT now()`; `pricelist_items_updated_at` trigger |
| — | — | `CONSTRAINT unique_pricelist_product UNIQUE (pricelist_id, product_id)` |

Indexes: `idx_pricelist_items_pricelist`, `idx_pricelist_items_product`.

### `customer_price_overrides` (`customer-pricing-migration.sql`)

| Column | Type | Default / Constraint |
|---|---|---|
| `id` | `UUID` | PK, `gen_random_uuid()` |
| `customer_id` | `UUID` | `NOT NULL` FK → `customers(id)` `ON DELETE CASCADE` |
| `product_id` | `UUID` | `NOT NULL` FK → `products(id)` `ON DELETE CASCADE` |
| `override_price` | `DECIMAL(10,2)` | `NOT NULL CHECK (override_price >= 0)` |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | `DEFAULT NOW()`; `price_overrides_updated_at` trigger → `update_price_overrides_updated_at()` |
| — | — | `CONSTRAINT unique_customer_product UNIQUE (customer_id, product_id)` |

Indexes: `idx_overrides_customer`, `idx_overrides_product`, `idx_overrides_customer_product`.

### Triggers / functions
- `update_pricelists_updated_at()` — sets `NEW.updated_at = now()`; attached to both `pricelists` and `pricelist_items`.
- `update_price_overrides_updated_at()` — same, on `customer_price_overrides`.

### RLS policies (transcribe exactly)

**`pricelists` / `pricelist_items`** (both RLS-enabled): a single permissive **service-role** policy each — API routes use the service-role key:
```sql
CREATE POLICY "Service role full access on pricelists"
  ON pricelists FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on pricelist items"
  ON pricelist_items FOR ALL USING (true) WITH CHECK (true);
```
(The route handlers do the real admin/assistant gating; these policies are `USING (true)` because access is mediated by the service-role key, not by `auth.uid()`.)

**`customer_price_overrides`** (RLS-enabled):
```sql
CREATE POLICY "Service role full access on price overrides"
  ON customer_price_overrides FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Customers can view their own price overrides"
  ON customer_price_overrides FOR SELECT USING (auth.uid() = customer_id);
```
(The second policy lets a logged-in customer read their own overrides directly — keep it if the storefront ever reads overrides client-side; otherwise harmless.)

---

## API endpoints

All routes use a **service-role** Supabase client and authenticate from the `Authorization: Bearer <token>` header → `customers.role`. Mutations are audited via `logAuditServer`.

### Pricelists (`app/api/admin/pricelists/`)

Shared gate `verifyAdmin(request, requireMutation)`: reads allowed for `admin`/`assistant`; mutations require `admin` (`canCreate(role)` → `role === 'admin'`).

#### `GET /api/admin/pricelists`
- **Auth:** admin/assistant. Selects `*, pricelist_items(count)` ordered by `created_at ASC`. Maps each row to add `item_count` (from the count aggregate) and strips the raw `pricelist_items`. **Response:** `{ pricelists: [{ ...pricelist, item_count }] }`.

#### `POST /api/admin/pricelists`
- **Auth:** admin only. **Body:** `{ name: string, source_pricelist_id?: string|null }`. `name` required (400 `"Pricelist name is required"`).
- Inserts the pricelist with `is_active: false`. Seeds `pricelist_items`: if `source_pricelist_id` given, copies that list's `(product_id, price)`; otherwise seeds from **active products' default prices** (`products WHERE active = true`, `price` defaulting to 0). On item-insert failure it rolls back by deleting the just-created pricelist.
- Audit `pricelist.create`. **Response:** `201 { pricelist: { ...pricelist, item_count } }`.

#### `GET /api/admin/pricelists/:id`
- **Auth:** admin/assistant. Loads the pricelist with `items:pricelist_items (id, pricelist_id, product_id, price, created_at, updated_at, product:products(id, name, slug, strength, price))`, sorted by product name. `404` if missing. **Response:** `{ pricelist }`.

#### `PATCH /api/admin/pricelists/:id`
- **Auth:** admin only. **Body:** any of `{ name?, is_active?, items?: [{ product_id, price }] }`.
- Header fields: updates `name` (trimmed) / `is_active`. **Activating** (`is_active === true`) first sets every currently-active list to `is_active = false` (enforces single-active alongside the partial unique index).
- Item updates: upserts `{ pricelist_id, product_id, price: max(0, Number(price)) }` `onConflict: 'pricelist_id,product_id'`.
- Audit `pricelist.update`. **Response:** `{ pricelist }` (reloaded with items).

#### `DELETE /api/admin/pricelists/:id`
- **Auth:** admin only. Deletes the pricelist (cascades to items). Audit `pricelist.delete`. **Response:** `{ ok: true }`.

#### `GET /api/admin/pricelists/active`
- **Auth:** admin/assistant (`role IN ('admin','assistant')`). Returns the active pricelist + its product prices, consumed by the invoice form. Selects `pricelists WHERE is_active = true` (maybeSingle); if none → `{ pricelist: null, items: [] }`; else returns `{ pricelist: {id,name,is_active}, items: [{product_id, price}] }`.

### Customer price overrides (`app/api/admin/price-overrides/`)

`getCaller(request)` resolves `{ id, role }` from the token.

> **AFFILIATE STRIPPED (all override routes):** every handler has an `if (caller.role === 'affiliate')` branch using `boundCustomerIds(affiliateId)` / `affiliateOwnsCustomer(affiliateId, customerId)` to restrict reads/writes to the affiliate's bound customers. **Remove these branches.** Reads should require `admin`/`assistant`; writes/deletes should require `admin`. Delete the `boundCustomerIds` / `affiliateOwnsCustomer` helpers.

#### `GET /api/admin/price-overrides`
- **Auth (after strip):** admin/assistant (`role !== 'customer'`). Optional query `customer_id`, `product_id` filters.
- Selects overrides joined with `customers(id, first_name, last_name, email)` and `products(id, name, slug, price)`, ordered `created_at DESC`. **Response:** `{ overrides }`.

#### `POST /api/admin/price-overrides`
- **Auth (after strip):** admin. **Body:** `{ customer_id, product_id, override_price }`.
- Validation: all three required (400 `"Missing required fields: ..."`); `override_price >= 0` (400 `"override_price must be non-negative"`). Verifies the customer (404 `"Customer not found"`) and product (404 `"Product not found"`) exist.
- **Upserts** `onConflict: 'customer_id,product_id'` (so POST doubles as create-or-update). **Response:** `201 { override }`.

#### `DELETE /api/admin/price-overrides`
- **Auth (after strip):** admin. Query: either `id`, or both `customer_id` + `product_id` (else 400 `"Must provide either id or both customer_id and product_id"`). Deletes the matching row(s). **Response:** `{ success: true }`.

### CSV import (`app/api/admin/price-overrides/import/`)

Uses the `xlsx` package (`XLSX.read` / `sheet_to_json`). Service-role client with `auth: { autoRefreshToken:false, persistSession:false }`.

#### `GET /api/admin/price-overrides/import`
- **Auth (after strip):** admin/assistant. Returns the catalogue for building a template: `{ products: [{ product_id, sku, name, current_price }] }` (from `products` ordered by name).

#### `POST /api/admin/price-overrides/import` (multipart/form-data)
- **Auth (after strip):** admin. **Fields:** `file` (CSV), `customer_ids` (JSON `string[]`), `mode` (`'preview' | 'apply'`, default `preview`).
- Parses the workbook's first sheet to JSON rows. Errors: not multipart (400), no file (400), unreadable (400 `"Could not read the file. Please upload a valid CSV."`), zero rows (400 `"The file has no rows."`).
- **Matching:** for each row, picks (case-insensitive header match) `product_id`/`id`, `sku`, `name`/`product`/`product_name`, and price from `your_price`/`price`/`override_price`/`new_price`. Matches a product by **product_id (UUID-validated) → sku → name**.
- **Per-row validation → `error`:** `"No matching product (check product_id / sku / name)"`, `"Missing price"`, `"Price is not a number"`, `"Price must be greater than 0"` (price must be > 0; strips non-numeric chars before parsing), `"Duplicate product in file"`.
- Builds `preview: PreviewRow[]` (`{ row, name, sku, product_id, price, error }`; `row` is 1-based incl. header offset) and `summary { total, valid, errors }`.
- **`mode='preview'`** → `{ preview, summary, customerCount }`.
- **`mode='apply'`** → requires ≥1 customer (400 `"Select at least one customer to apply prices to"`) and ≥1 valid row (400 `"No valid rows to apply"`). Builds the cartesian product of `customer_ids × valid rows` and **upserts** into `customer_price_overrides` (`onConflict: 'customer_id,product_id'`). **Response:** `{ applied, products, customers, summary }`.

---

## Frontend

### Pricelists — `components/admin/PricelistsTab.tsx`
- Rendered as the **Pricelists** tab inside `app/(admin)/admin/invoices/page.tsx` (not a standalone route).
- **State:** local `useState`; data via `lib/admin/pricelists.ts` wrappers (`getPricelists`, `getPricelist`, `createPricelist`, `updatePricelist`, `setActivePricelist`, `deletePricelist`). No React Query.
- Contains an inner **`PriceEditor`** modal component for editing per-product prices.

### Customer pricing — `app/(admin)/admin/pricing/page.tsx`
- Standalone page (`/admin/pricing`). **State:** local `useState`/`useEffect`; talks to `/api/admin/price-overrides` (+ import endpoints) with bearer-token headers, and reads `customers` via `/api/admin/customers` and `products` directly from Supabase (`active = true`).
- Permissions via `usePermissions()` (`lib/hooks/usePermissions`) → `canCreate`/`canEdit`/`canDelete`. **Components used:** `MultiSelectCustomer`, `ProductToggleSelector`, `NumericStepper`, and `_components/PriceListImportModal`.

### Supporting components
- **`components/admin/MultiSelectCustomer.tsx`** — chip-style multi-select with search, "Select All (N)", clear-all, per-chip remove; closes on outside click. Displays customer name (or email fallback).
- **`components/admin/ProductToggleSelector.tsx`** — searchable single-select list of products showing name + `$price`; selected row highlighted bronze with a left border; footer `Selected: <name>`.
- **`components/admin/NumericStepper.tsx`** — money input with − / + buttons (step default 1), `$` prefix icon, `inputMode="decimal"`, formats to 2 dp on blur, clamps to `min` (default 0). Value is a **string**.

### Active-pricelist consumption (cross-module)
`lib/admin/pricelists.ts` exports `getActivePricelist(): { pricelist, prices }` (a `product_id → price` map). `InvoiceForm` calls it on mount and uses `priceForProduct(p) = pricelist.prices[p.id] ?? p.price` to seed each line's unit price. **Customer price overrides are NOT auto-applied in the invoice builder** — the builder only uses the active pricelist (overrides are a separate reference/management feature in this codebase).

---

## UI/UX specification

Same design tokens as the rest of admin: `ink`, `ink-muted`, `bronze`, `surface`, `line`.

### Pricelists tab
- **Header:** `Pricelists` (Tag, bronze) + sub-line *`The active pricelist sets default unit prices when adding invoice line items.`* Right: **New Pricelist** (Plus, dark `bg-ink`).
- **Error** surfaces in a red box (AlertCircle).
- **Create form** (toggled open by New Pricelist): heading *`Create a new pricelist`*; **Name** input (placeholder `e.g. Wholesale, Retail…`); **Seed prices from** select with options `Product default prices` and `Copy of: <name>` for each existing list. Buttons **Cancel** / **Create** (bronze; spinner while creating). Validation: `"Enter a name for the pricelist"`.
- **Table** (min-width 560px): columns **Pricelist, Products, Status, (actions)**.
  - Pricelist cell: name; a filled bronze **Star** prefixes the active list.
  - Products: `item_count`.
  - Status: **Active** (emerald pill with Check) or **Inactive** (muted bordered pill).
  - Actions: **Set active** (border button with Star; only on inactive rows; spinner when busy), **Edit prices** (Pencil), **Delete** (Trash2). Delete uses a native `window.confirm`: `Delete pricelist "<name>"? This cannot be undone.`
- **Loading:** centered `Loading…` with spinner. **Empty:** `No pricelists yet. Create one to get started.`
- **PriceEditor modal** (opened by Edit prices): title `Edit prices — <name>`, sub-line `N product(s)`. A product search (`Search products…`) filters by name/strength. Each product row shows name, `strength`, and `· default $x.xx`, with a `$` + number input (right-aligned, tabular). Empty filter → `No products match.` Footer: **Cancel** / **Save prices** (dark, Save icon; spinner while saving). Error → red box `Could not save prices`. Save sends all items to `PATCH /api/admin/pricelists/:id { items }`.

### Customer pricing page (`/admin/pricing`)
- **Header:** `Customer Pricing` + *`Manage customer-specific price overrides`*. Right action cluster (when allowed to create): **Import CSV** (Upload, surface button), **Bulk Edit Pricing** (Users, bronze), **Add Price Override** (Plus, dark).
- **Alerts:** dismissible red error box and emerald success box (both with AlertCircle + X to close).
- **Search bar:** `Search by customer or product...` (filters the table client-side by customer name/email/product name).
- **Overrides table** (min-width 760px): columns **Customer, Product, Default Price, Override Price, Discount, Actions**.
  - Customer: name + email. Product: name. Default Price: `$x.xx` (bold). Override Price: `$x.xx` (bronze, bold).
  - **Discount** column: `((default − override) / default) * 100`; shown as `-X.X%` (emerald) when override is cheaper, `+X.X%` (red) when more expensive, `0.0%` (muted) otherwise.
  - Actions: **Edit** (Edit2) and **Delete** (Trash2, red hover) when permitted; otherwise `View only`. Delete uses `window.confirm`: `Delete price override for <name>?`
  - **Loading:** `Loading...` row. **Empty:** `No price overrides found`.

- **Add/Edit modal** (`Add Price Override` / `Edit Price Override`):
  - **Customers** (`MultiSelectCustomer`; in edit mode it's a single, disabled customer), **Product** (`ProductToggleSelector`; disabled in edit mode), **Override Price** (`NumericStepper`, placeholder `0.00`). Buttons **Cancel** / **Save Override** (Save icon).
  - Validation: `"All fields are required"`, `"Invalid price"` (NaN or negative).
  - On create, it POSTs once **per selected customer** (parallel). Result toasts: `Price override(s) created successfully`, partial `N override(s) created, M failed`, or full failure `Failed to create price overrides`. Edit success: `Price override updated successfully`. Delete success: `Price override deleted successfully`.

- **Bulk Edit flow** (two steps, single modal):
  - **Step 1 — Select Customers:** heading `Bulk Edit Pricing` / `Step 1: Select Customers`. `MultiSelectCustomer`; sub-count `N customer(s) selected`. **Cancel** / **Next: Set Prices** (bronze, ArrowRight; disabled with 0 selected). Validation `"Please select at least one customer"`.
  - **Step 2 — Product Pricing Grid** (wide modal): heading `Step 2: Set Prices for N customer(s)`. A blue info banner: *`Enter override prices for products. Leave blank to skip. Changes will apply to all N selected customer(s).`* Grid columns **Product, SKU (shows `product.slug`), Default Price, Status, Override Price**. **Status** badge per product across the selected customers: `Mixed` (amber, customers have differing existing overrides), `Set` (blue, all share one), or `—` (none). Each Override Price cell is a `NumericStepper` (`Leave blank to skip`); editing applies the value to *all* selected customers for that product. Buttons **Back** (ArrowLeft) / **Save Price Overrides** (bronze, Save; disabled when no prices entered). Save collects only changed `{customer_id, product_id, override_price}` tuples and POSTs each in parallel. Messages: `No changes to save`, `Successfully saved N price override(s)`, partial / full-fail variants.

- **Import CSV modal** (`PriceListImportModal`): title **Import price list (CSV)** (Upload, bronze).
  - **Step 1: `1. Apply prices to which customers?`** — `MultiSelectCustomer` (`Search your customers...`).
  - **Step 2: `2. Upload your prices`** — buttons **Download template** (Download; builds a CSV `product_id,sku,name,current_price,your_price` from `GET .../import`, downloaded as `aminocan-price-list-template.csv`), **Choose CSV…** (file picker; shows the chosen filename), **Validate** (Check; calls `POST mode=preview`). Helper: *`The template is built from the current catalogue (product_id, sku, name). Fill the your_price column and upload it back.`*
  - **Error** box (red). **Preview** block: summary line `N valid` (+ `M with issues` in red) `of T rows`, then a scrollable table **Row / Product (name · sku) / Price / Status** — invalid rows tinted red with the error text; valid rows show emerald `OK` with a Check.
  - **Footer:** `N customer(s) selected` + **Cancel** / **Apply prices** (bronze, Upload). **Apply prices** is enabled only when there's a preview with ≥1 valid row AND ≥1 customer selected AND not busy. On apply (`POST mode=apply`) the parent shows `Applied N price(s) to M customer(s).` and refreshes.

---

## Dependencies

- **npm:** `@supabase/supabase-js`, `next`, `lucide-react`, `tailwindcss`, and **`xlsx`** (CSV parsing in the import route). (`@tanstack/react-query` installed but unused here.)
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (all routes).
- **Internal modules:**
  - `lib/permissions.ts` (`canCreate`/`canEdit`/`canDelete`) and `lib/hooks/usePermissions` for the Pricing page.
  - `lib/admin/audit.ts` (`logAuditServer`) → `audit_log` table (pricelist routes only; the override routes don't currently audit).
  - `products` table (catalogue, default `price`, `slug`, `sku`, `strength`, `active`) and `customers` table (role lookups + join data).
  - `/api/admin/customers` (the scoped customers list) for the Pricing page's customer dropdowns.
- **Cross-module:** **Module 1 — Invoices** consumes `getActivePricelist()` to default line-item prices. Pricelist seeding and the CSV template both read from **Products**. Nothing here writes invoices.

---

## Porting notes

**What to strip (affiliate):**
1. In all three `price-overrides` route files (`route.ts`, `import/route.ts`), delete the `caller.role === 'affiliate'` branches and the `boundCustomerIds` / `affiliateOwnsCustomer` helpers. Reduce auth to: GET/template = admin/assistant; POST/DELETE/apply = admin.
2. In `app/(admin)/admin/pricing/page.tsx`, remove `isAffiliate`, `mayCreate/mayEdit/mayDelete` affiliate-OR logic — just use `canCreate/canEdit/canDelete`. The comments about affiliate scoping can go.
3. Pricelists have **no** affiliate code — port them as-is.
4. If the target app has no `affiliate` role at all, drop it from `UserRole` in `lib/permissions.ts`.

**Gotchas:**
- **Single-active pricelist** is enforced two ways: the partial unique index `pricelists_single_active` *and* the PATCH handler clearing the old active row before activating a new one. Keep both — the handler avoids a unique-violation when toggling.
- Creating a pricelist with no source seeds from **active products only** (`active = true`); inactive products won't get rows. Editing later only updates products already in the list (the PriceEditor iterates `pricelist.items`), so newly-added products won't appear until you create a fresh list or add items via upsert.
- `POST /price-overrides` is an **upsert** (create-or-update on `unique(customer_id, product_id)`), which is why the bulk and per-customer flows can all funnel through the same POST.
- The CSV import requires price **strictly > 0** (not just ≥ 0, unlike the override CHECK constraint). Header matching is flexible (multiple accepted column names) and case-insensitive; product matching order is **product_id → sku → name**.
- `NumericStepper` holds a **string** value (`''` means "skip" in bulk/import contexts) — preserve that, the bulk-save logic depends on blank == no override.
- The import route disables session persistence on its Supabase client (`autoRefreshToken:false, persistSession:false`) — fine to keep.
- `ProductToggleSelector` displays `product.price` (default), and the bulk grid shows `product.slug` under a "SKU" header — that's the actual code (slug is used as the SKU surrogate), keep it unless your products have a real `sku` field you'd rather show.

**Suggested order of implementation:**
1. SQL: `pricelist-migration.sql` (tables, single-active index, triggers, RLS), then `customer-pricing-migration.sql`.
2. `lib/admin/pricelists.ts` (wrappers incl. `getActivePricelist`).
3. Pricelist API routes (`/pricelists`, `/pricelists/[id]`, `/pricelists/active`), then `PricelistsTab` (+ `PriceEditor`) wired into the Invoices page tab.
4. Price-override API routes (admin-only) + the import route (needs `xlsx`).
5. The `/admin/pricing` page with `MultiSelectCustomer`, `ProductToggleSelector`, `NumericStepper`, and `PriceListImportModal`.
6. Confirm the invoice builder (Module 1) reads `getActivePricelist()` for default line prices.
