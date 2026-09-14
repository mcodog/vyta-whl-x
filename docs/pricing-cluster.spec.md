# Pricing — Pricelists, Customer Overrides & Affiliate Overrides — Build Spec

> Definitive spec for rebuilding this feature cluster in a Next.js + Supabase codebase.
> Generated from: `pricelist-migration.sql`, `customer-pricing-migration.sql`,
> `affiliate-pricelist-migration.sql`; `lib/admin/pricelists.ts`;
> `app/api/admin/pricelists/{route,[id],active}`; `app/api/admin/price-overrides/{route,import}`;
> `components/admin/PricelistsTab.tsx`, `app/(admin)/admin/pricing/page.tsx` (+ `_components`);
> and the consumer seams in `app/api/products/route.ts` (+ featured) and
> `components/admin/InvoiceForm.tsx`. Stack: **Next.js 15 App Router** + **Supabase**
> (service-role server clients, anon browser) + **xlsx** (CSV) + **Tailwind**.
>
> Describes the code **as it exists**. Port **fourth** — it sits between Products (Cluster 3) and
> Invoices (Cluster 5): three pricing mechanisms layered over `products.price`.

---

## 0. The three mechanisms (and the resolution trap)

1. **Pricelists** (`pricelists` + `pricelist_items`) — named, switchable price sets. The single
   **active** pricelist drives the **invoice line-item default** price.
2. **Customer price overrides** (`customer_price_overrides`) — per-customer, per-product price.
   Merged into the **storefront** (`/api/products`) read.
3. **Affiliate price overrides** (`affiliate_price_overrides`, optional — Cluster 8) — a client's
   own price list, copied into a bound customer's overrides on bind/import.

> **CRITICAL — the two consumers DIVERGE in the current code (verify before trusting the brief).**
> The intended/aspirational priority is *customer override → active pricelist → product.price*, and
> the brief says both consumers must implement it identically. **They don't.**
> - **Storefront** (`/api/products`, Cluster 2/3): applies **customer override → `product.price`**
>   (it does **not** consult the active pricelist).
> - **Invoice builder** (`InvoiceForm`, Cluster 5): applies **active pricelist → `product.price`**
>   (it does **not** consult `customer_price_overrides`).
> So a customer with an override sees their override in the cart, but the invoice form defaults from
> the active pricelist (or product default) — **cart price ≠ invoice default** unless they coincide.
> This is documented faithfully in §5; a porter who wants the unified 3-tier chain must add the
> missing tier in *both* seams. (See §7.)

---

## 1. Overview

`pricelists` is a header table; `pricelist_items` binds products to a list with a per-product price.
At most one pricelist is `is_active` (enforced by a partial unique index); the active list's prices
are exposed by `GET /api/admin/pricelists/active` and consumed by the invoice form. Admins manage
pricelists in a **PricelistsTab** (rendered on the Invoices page) and customer overrides on a
dedicated **Customer Pricing** page (`/admin/pricing`), which also imports a price-list CSV and
bulk-applies it. All three item/override tables use `UNIQUE(entity_id, product_id)` + `upsert
onConflict`. RLS is service-role-only for pricelists, but customer/affiliate overrides additionally
grant owner-SELECT (`auth.uid() = customer_id` / `= affiliate_id`) — which is exactly what lets the
storefront read its own prices through the anon client. Mutations are admin-only (`canCreate`), but
the override routes also admit `affiliate` callers scoped to their bound customers — a clean
strip-point for Cluster 8.

---

## 2. Schema

### `pricelists` + `pricelist_items` (`pricelist-migration.sql`)

```sql
CREATE TABLE IF NOT EXISTS pricelists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- THE SINGLETON-ACTIVE GUARANTEE: at most one active pricelist.
CREATE UNIQUE INDEX IF NOT EXISTS pricelists_single_active
  ON pricelists (is_active) WHERE is_active;

CREATE TABLE IF NOT EXISTS pricelist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricelist_id UUID NOT NULL REFERENCES pricelists(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_pricelist_product UNIQUE (pricelist_id, product_id)   -- upsert conflict target
);
CREATE INDEX idx_pricelist_items_pricelist ON pricelist_items(pricelist_id);
CREATE INDEX idx_pricelist_items_product   ON pricelist_items(product_id);
```

- `updated_at` trigger `update_pricelists_updated_at()` on both tables.
- **RLS: service-role only** — `FOR ALL USING(true) WITH CHECK(true)` on both. No owner/anon read
  (pricelists are only ever read server-side through the service-role API routes).

> **The partial unique index is load-bearing.** Because `WHERE is_active` allows only one
> `is_active = true` row, **activation must first clear the current active row**, or the second
> `true` violates the index and the activation throws. The PATCH handler does
> `UPDATE pricelists SET is_active=false WHERE is_active=true` *before* setting the new one. Both the
> index and the clear-first step are required — keep them together.

### `customer_price_overrides` (`customer-pricing-migration.sql`)

```sql
CREATE TABLE IF NOT EXISTS customer_price_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  override_price DECIMAL(10,2) NOT NULL CHECK (override_price >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_customer_product UNIQUE(customer_id, product_id)       -- upsert conflict target
);
CREATE INDEX idx_overrides_customer ON customer_price_overrides(customer_id);
CREATE INDEX idx_overrides_product  ON customer_price_overrides(product_id);
CREATE INDEX idx_overrides_customer_product ON customer_price_overrides(customer_id, product_id);
```

- `updated_at` trigger `update_price_overrides_updated_at()`.
- **RLS: service-role full access + owner SELECT** — `"Customers can view their own price overrides"
  USING (auth.uid() = customer_id)`. This owner-read is what lets the storefront's anon/browser
  reads surface a customer's own prices.

### `affiliate_price_overrides` (`affiliate-pricelist-migration.sql`) — Cluster 8 (optional)

```sql
CREATE TABLE IF NOT EXISTS affiliate_price_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  override_price DECIMAL(10,2) NOT NULL CHECK (override_price >= 0),
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_affiliate_product UNIQUE (affiliate_id, product_id)    -- upsert conflict target
);
CREATE INDEX idx_affiliate_overrides_affiliate ON affiliate_price_overrides(affiliate_id);
CREATE INDEX idx_affiliate_overrides_product   ON affiliate_price_overrides(product_id);
```

- Same `updated_at` trigger helper (redefined defensively). **RLS: service-role full + owner SELECT**
  (`auth.uid() = affiliate_id`). Stores a client's price list so it can be applied to **all** of
  their customers — present and future (copied in at customer-creation time via
  `applyAffiliatePricelist`, in `/api/admin/customers`).

> All three child/override tables share the **`UNIQUE(entity_id, product_id)` + `upsert onConflict`**
> pattern. Conflict targets used in code (preserve exactly): `"pricelist_id,product_id"`,
> `"customer_id,product_id"`, `"affiliate_id,product_id"`.

### TS types (`lib/supabase.ts`)
`Pricelist { id, name, is_active, created_at, updated_at, items?: PricelistItem[], item_count? }`;
`PricelistItem { id, pricelist_id, product_id, price, created_at, updated_at, product?: Pick<Product,
'id'|'name'|'slug'|'strength'|'price'> }`.

### Schema usage map

| Table | Read by | Written by |
|---|---|---|
| `pricelists` / `pricelist_items` | `GET /pricelists`(+`[id]`,`active`), `getActivePricelist`, InvoiceForm | `POST/PATCH/DELETE /pricelists*` (service role) |
| `customer_price_overrides` | `/api/products`(+featured) overlay, `GET /price-overrides`, Customer Pricing page | `POST/DELETE /price-overrides`, `/price-overrides/import` (apply), `applyAffiliatePricelist` |
| `affiliate_price_overrides` | `applyAffiliatePricelist` (on customer bind) | `/price-overrides/import` (affiliate apply) |

---

## 3. Components

### Pricelists API + lib

#### `GET/POST /api/admin/pricelists` — `route.ts`
- `verifyAdmin(request, requireMutation)`: bearer → `customers.role`. Reads: `admin|assistant`.
  Mutations: `canCreate(role)` (admin only). Returns `{authorized, role, userId}`.
- **GET**: `select('*, pricelist_items(count)')` ordered by `created_at asc`; flattens to
  `item_count`. → `{ pricelists }`.
- **POST** `{ name, source_pricelist_id? }`: inserts the header (`is_active:false`); seeds
  `pricelist_items` either from a **source pricelist's** items or from **all active products'
  `products.price`**. **If item seeding fails, the pricelist header is rolled back**
  (`delete().eq('id', pricelist.id)`). Writes `pricelist.create` audit. → `201 { pricelist }`.

#### `GET/PATCH/DELETE /api/admin/pricelists/[id]` — `[id]/route.ts`
- `loadPricelist(id)` deep-selects items + joined product `{id,name,slug,strength,price}`, sorted by
  product name.
- **PATCH** `{ name?, is_active?, items?: [{product_id, price}] }`:
  1. Header fields. **If `is_active === true`, first `UPDATE pricelists SET is_active=false WHERE
     is_active=true`** (the mandatory clear-before-activate), then apply.
  2. Item upsert on `pricelist_id,product_id` (`price` clamped `Math.max(0, …)`).
  3. `pricelist.update` audit; returns the reloaded pricelist.
- **DELETE**: removes the pricelist (items cascade); `pricelist.delete` audit.

#### `GET /api/admin/pricelists/active` — `active/route.ts`
- `verifyAdmin` (admin|assistant). Returns the active pricelist + its `{product_id, price}` items,
  or `{ pricelist: null, items: [] }`. **Consumed by the invoice form.**

#### `lib/admin/pricelists.ts` (browser wrappers)
- `getPricelists`, `getPricelist(id)`, `createPricelist(name, sourceId?)`, `updatePricelist(id,
  patch)`, `setActivePricelist(id)` (= `updatePricelist(id, {is_active:true})`), `deletePricelist(id)`.
- `getActivePricelist()` → `{ pricelist, prices: Record<product_id, number> }` (flattens items into a
  map). All attach the session bearer token.

### Customer/affiliate override API

#### `GET/POST/DELETE /api/admin/price-overrides` — `route.ts`
- `getCaller` → `{id, role}`. **GET** rejects `customer`; **POST/DELETE** require `admin|affiliate`.
- **Affiliate scoping:** `boundCustomerIds(affiliateId)` (customers with `affiliate_id = caller.id`)
  and `affiliateOwnsCustomer(affiliateId, customerId)`. GET scopes the list to bound customers; POST
  rejects a non-bound `customer_id` (403 `Customer not in your account`); DELETE resolves the row's
  customer (by `id` if needed) and confirms ownership.
- **GET** joins `customers(...)` + `products(...)`; optional `customer_id`/`product_id` filters.
- **POST** `{customer_id, product_id, override_price}`: validates non-negative; verifies customer &
  product exist; **upsert on `customer_id,product_id`** → `201 { override }`.
- **DELETE** by `id` **or** `customer_id`+`product_id`.

#### `GET/POST /api/admin/price-overrides/import` — `import/route.ts` (xlsx)
- `getCaller`; GET rejects `customer` (returns the product catalogue for building a template:
  `{product_id, sku, name, current_price}`). POST requires `admin|affiliate`.
- **POST** (multipart): `file` (CSV), `customer_ids` (JSON array), `mode` (`'preview'|'apply'`).
  Parses with xlsx; matches each row to a product by **`product_id` (UUID-validated) → `sku` →
  `name`** (case-insensitive); validates price (`> 0`, 2dp); flags duplicates/missing/bad rows.
  Returns a `preview` + `summary {total, valid, errors}` unless `mode === 'apply'`.
- **Affiliate seam (the Cluster-8 hook):** for affiliate callers, `customer_ids` is **ignored** and
  replaced with **all** bound customers; the valid rows are **also upserted into
  `affiliate_price_overrides`** (conflict `affiliate_id,product_id`) so future bound customers
  inherit the list via `applyAffiliatePricelist`. Admins must select ≥1 customer.
- **Apply** upserts `customer_price_overrides` for the chosen customers (conflict
  `customer_id,product_id`). Returns `{applied, products, customers, futureCustomers, summary}`.

### Consumer seams

#### Storefront merge — `app/api/products/route.ts` (+ `featured`) [Cluster 2/3]
- With `?customer_id=`, loads `customer_price_overrides` for that customer and overlays
  `price = override ?? product.price`, adding `has_override` + `original_price`. **No pricelist
  consulted.** (Featured route same overlay + `normalizeCoa`.)

#### Invoice builder — `components/admin/InvoiceForm.tsx` [Cluster 5]
- On mount: loads active products + `getActivePricelist()`. `priceForProduct(p)` =
  `pricelist.prices[p.id] ?? Number(p.price)` — **active pricelist → product default. No customer
  override.** UI note: *"Prices default from active pricelist {name} (editable per line)."* Line
  prices remain editable, so the default is a starting point, not a lock.

#### Affiliate bind — `applyAffiliatePricelist(customerId, affiliateId)` (in `/api/admin/customers`) [Cluster 1/8]
- On creating/binding a customer to an affiliate, copies that affiliate's `affiliate_price_overrides`
  into the new customer's `customer_price_overrides` (best-effort; never blocks customer creation).

### Admin UI

#### `PricelistsTab` — `components/admin/PricelistsTab.tsx` (rendered on `/admin/invoices`)
- Lists pricelists with item counts; **Create** form (`name`, placeholder `e.g. Wholesale, Retail…`);
  per-row **Set Active** (active row shows a `Check` + `Active` badge), **Edit prices** (inline
  product price editor with product search), **Delete** (`window.confirm`). Empty: *"No pricelists
  yet. Create one to get started."* Calls the `lib/admin/pricelists.ts` wrappers.

#### Customer Pricing page — `app/(admin)/admin/pricing/page.tsx`
- Heading **Customer Pricing**. Overrides table (Customer, Product, Override Price, actions); search
  (`Search by customer or product...`); **Import CSV** (opens `PriceListImportModal`) and **Add Price
  Override** buttons; per-row edit/delete (delete uses `confirm`). Supports **bulk** apply across
  `MultiSelectCustomer`. Reads `GET /price-overrides`, writes via `POST/DELETE /price-overrides`.
- `_components/PriceListImportModal.tsx` drives the two-step import (`preview` → `apply`) against
  `/price-overrides/import`.

---

## 4. UI/UX design overview

Shared admin theme: `ink #1A1A1A`, `ink-muted #6E6E6E`, `bronze #9C8B5A`, `surface #F7F7F7`,
`line #C9CCD1`; status `emerald`/`red`/`amber`. Icons `lucide-react`.

- **Cards/sections:** `bg-white rounded-xl border border-line`; section titles `text-lg font-semibold
  text-ink`; page titles `text-xl sm:text-2xl font-bold text-ink`.
- **Buttons:** primary `bg-ink hover:bg-ink/90 text-white rounded-lg font-medium`; the active-pricelist
  badge is an emerald `Check` + `Active`.
- **Inputs:** `bg-surface border border-line rounded-lg focus:ring-2 focus:ring-bronze/40`; search
  inputs use the standard left-icon pattern.
- **Tables:** header row `text-xs font-semibold text-ink-muted uppercase`; rows `hover:bg-surface`.
- **Import modals:** standard `bg-black/50` overlay + `bg-white rounded-xl` panel; preview shows
  valid/errors counts and a per-row error column.
- **Invoice form note:** bronze-highlighted hint that prices default from the active pricelist.

---

## 5. Data flow & behavior

### Activation (single active pricelist)
`setActivePricelist(id)` → PATCH `{is_active:true}` → handler **clears the current active row first**
→ sets the new one. The partial unique index guarantees the invariant at the DB layer; the
clear-first step prevents the index from throwing on activation. `GET …/active` then exposes the new
list's prices.

### Price resolution (AS BUILT — the two seams diverge)
- **Storefront / cart** (`/api/products?customer_id=`): `customer_price_overrides[product] ?? product.price`.
- **Invoice line default** (`InvoiceForm` via `getActivePricelist`): `active_pricelist[product] ?? product.price`.
- **Intended unified chain** (not implemented in either seam today): `customer override → active
  pricelist → product.price`. A porter wanting cart price == invoice default must add the missing
  tier in **both** places.

### Pricelist creation seeding + rollback
`POST /pricelists` seeds items from a source pricelist or from active products' defaults; if the item
insert fails, the just-created header is deleted (atomic-ish create).

### Customer override lifecycle
Set via the Customer Pricing page or CSV import (upsert on `customer_id,product_id`); read by the
storefront (owner-SELECT RLS lets the customer's own client read them); deleted by id or pair.

### Affiliate price list → customers (Cluster 8 seam)
Affiliate CSV import upserts `affiliate_price_overrides` **and** the bound customers'
`customer_price_overrides`; `applyAffiliatePricelist` copies the affiliate list into any newly bound
customer. Admin imports skip the affiliate table and require an explicit customer selection.

### Authorization
Pricelist mutations: admin only (`canCreate`); reads: admin/assistant. Override routes: admin **or**
affiliate (scoped to bound customers) for writes; non-`customer` for reads. Stripping Cluster 8 means
removing the `affiliate` branches in the override routes + `applyAffiliatePricelist` + the affiliate
import seam.

---

## 6. Edge cases & states

- **Activate with an existing active list:** handled by clear-first; without it the unique index
  throws (`23505`).
- **Create with bad item seed:** pricelist header rolled back.
- **No active pricelist:** `…/active` → `{pricelist:null, items:[]}`; invoice defaults fall back to
  `product.price`.
- **Override upsert conflict:** updates in place (conflict target `customer_id,product_id`).
- **CSV import:** unmatched product / missing price / non-numeric / `≤ 0` / duplicate-in-file → row
  error; preview reports `{total, valid, errors}`; apply with 0 valid → 400; admin with 0 customers →
  400 (affiliates exempt — they target all bound + future).
- **Affiliate scope violations:** POST/DELETE override for a non-bound customer → 403.
- **Negative prices:** rejected by both the CHECK constraint and route validation.

---

## 7. Open questions & unverified items

- **Resolution divergence (most important):** the brief states the customer-override → active-pricelist
  → product.price chain "must match in two places." In the current code it does **not** — storefront
  uses only customer overrides, the invoice builder uses only the active pricelist. Documented as-built
  in §5; flagging in case the porter intends the unified chain (it would require code changes in both
  `/api/products` and `InvoiceForm`, not a like-for-like port).
- **`PricelistsTab` lives on the Invoices page** (`/admin/invoices`), not under `/admin/pricing`
  (which is the customer-override "Customer Pricing" page). Confirmed via import site.
- **`pricelist-migration.sql` RLS is service-role only** — no owner read on pricelists; pricelists are
  only ever read through the service-role API. (Customer/affiliate override tables add owner-SELECT.)
- **`applyAffiliatePricelist`** body lives in `/api/admin/customers/route.ts` (Cluster 1); only its
  pricing effect is documented here.
- **The pricing pages/modals** (`/admin/pricing/page.tsx`, `PricelistsTab.tsx`, `PriceListImportModal`,
  `MultiSelectCustomer`) were captured at the structural level (headings, labels, button flow, data
  calls) rather than transcribed line-by-line.
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (all routes); `xlsx` for the
  two CSV importers.
