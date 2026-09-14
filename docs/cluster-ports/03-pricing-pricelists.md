# Cluster 3 — Pricing & Pricelists: Code Extraction Guide

> **What this document is.** A file-by-file walkthrough of Cluster 3 so you can extract it
> completely. For each piece: *what to open*, *what it does*, *its intricacies*, and *exactly
> how it touches the database*. Ports **fourth** (after 1, 10, 2): it sits between Products and
> Invoices — the active pricelist supplies default invoice line prices, and customer overrides
> alter both storefront and invoice prices.
>
> **Companion deep spec:** `docs/module-ports/08-pricing-and-pricelists.md`. This is the *map*; that's the *atlas*.

---

## 1. What the cluster is / does

Three independent pricing mechanisms layered over `products.price`:

1. **Pricelists** — named, switchable sets of per-product prices. **Exactly one** is active at a
   time; the active list supplies the **default line prices in the invoice builder** (Cluster 5).
2. **Customer price overrides** — per-customer, per-product price. Merged into the **storefront**
   `/api/products` response (Cluster 2) and used by invoices.
3. **Affiliate price overrides** *(optional, Cluster 8)* — an affiliate's own price list that gets
   **copied into a customer's overrides** when that customer is bound to the affiliate.

All three FK `products`; customer/affiliate overrides also FK `customers`/`affiliates`. **Resolution
priority** (where prices are consumed): customer override → active pricelist → `products.price`.

---

## 2. Database schema — what exists and where it comes from

### `pricelists` + `pricelist_items` (`pricelist-migration.sql`)
- **`pricelists`**: `id`, `name`, `is_active boolean DEFAULT false`, timestamps. **Intricacy —
  single-active enforced by a partial UNIQUE index:** `CREATE UNIQUE INDEX pricelists_single_active
  ON pricelists (is_active) WHERE is_active;` (at most one row may have `is_active=true`). `updated_at`
  trigger.
- **`pricelist_items`**: `id`, `pricelist_id → pricelists ON DELETE CASCADE`, `product_id →
  products ON DELETE CASCADE`, `price DECIMAL CHECK (price >= 0)`, timestamps, **UNIQUE
  (pricelist_id, product_id)**. Indexes on both FKs.
- RLS: **service-role full access only** (no client policies — all access via API routes).

### `customer_price_overrides` (`customer-pricing-migration.sql`)
- `id`, `customer_id → customers ON DELETE CASCADE`, `product_id → products ON DELETE CASCADE`,
  `override_price DECIMAL CHECK (>= 0)`, timestamps, **UNIQUE (customer_id, product_id)**. Three
  indexes (customer, product, composite). `updated_at` trigger.
- RLS: service-role full access **+ customers can SELECT their own** (`auth.uid() = customer_id`) —
  this is what lets the storefront read its own prices.

### `affiliate_price_overrides` (`affiliate-pricelist-migration.sql`) — *Cluster 8, optional*
- Mirror of the customer table but keyed on `affiliate_id → affiliates ON DELETE CASCADE`. UNIQUE
  (affiliate_id, product_id). RLS: service-role + affiliates SELECT own list. **Strip with Cluster 8.**

### `orders.discount_amount` (`affiliate-discount-commission-migration.sql`) — *Cluster 8, optional*
- `numeric(10,2) NOT NULL DEFAULT 0` — the affiliate discount applied at checkout. Strip with affiliate.

### How the DB is reached
- **All pricelist + override writes go through admin API routes using the service-role client.**
  Each route re-verifies the caller (`verifyAdmin`/`getCaller`); **mutations require `canCreate`
  (admin-only)** — except the override routes also admit `affiliate` for their own bound customers.
- The storefront reads `customer_price_overrides` directly (service-role in `/api/products`, or the
  customer's own client via RLS).

---

## 3. The reading map (open files in this order)

### Tier A — Types & schema
- `lib/supabase.ts` → `Pricelist`, pricelist-item, override types.
- SQL: `pricelist-migration.sql`, `customer-pricing-migration.sql` (+ affiliate variant if porting 8).

### Tier B — Pricelists API & lib

**`app/api/admin/pricelists/route.ts`** — list (GET) + **create (POST)**.
- `verifyAdmin(req, requireMutation)` → role from `customers`; POST requires `canCreate` (admin).
- **Create intricacy — seeding:** insert `pricelists {name, is_active:false}`, then build
  `seedRows`: **copy from a source pricelist** (`?sourceId` → its `pricelist_items`) *or* seed from
  `products.price` for all `active` products. Insert items; **roll back** (delete the pricelist) if
  the item insert fails. Audit `pricelist.create`. Returns `{pricelist, item_count}`.

**`app/api/admin/pricelists/[id]/route.ts`** — GET (detail w/ items) + **PATCH** + DELETE.
- **PATCH intricacy — activation:** body `{name?, is_active?, items?:[{product_id, price}]}`. If
  `is_active===true`, **first** `update {is_active:false} WHERE is_active` (clears the current
  active one — respects the single-active index), then set this one active. Item prices **upsert
  on conflict `pricelist_id,product_id`**. Audit `pricelist.update`. DELETE → audit `pricelist.delete`.

**`app/api/admin/pricelists/active/route.ts`** — `GET` returns the active pricelist + a
`{product_id: price}` map. **This is the endpoint the invoice builder calls.**

**`lib/admin/pricelists.ts`** — client wrappers: `getPricelists`, `getPricelist`, `createPricelist`,
`updatePricelist`, `setActivePricelist`, `deletePricelist`, **`getActivePricelist()`** (→
`{pricelist, prices}`). All attach the session bearer token.

**UI:** `components/admin/PricelistsTab.tsx` — rendered as a tab inside `app/(admin)/admin/invoices/page.tsx`
(create/copy/set-active/delete, per-product price editing).

### Tier C — Customer price overrides API

**`app/api/admin/price-overrides/route.ts`** — GET (list, joined to customer+product) + POST + DELETE.
- **Auth intricacy:** admits `admin` **and `affiliate`**; affiliates may only set prices for their
  **own bound customers** (`affiliateOwnsCustomer` guard). Strip the affiliate branch with Cluster 8.
- POST = **upsert** one override (`onConflict: 'customer_id,product_id'`, non-negative guard).
  DELETE = by row or bulk by customer+product.

**`app/api/admin/price-overrides/import/route.ts`** — *CSV import (xlsx), GET template + POST.*
- `multipart`: `file`, `customer_ids` (JSON `string[]`), `mode` (`'preview'|'apply'`).
- **Affiliate seam (strip with 8):** if caller is `affiliate`, it (a) **persists the affiliate's own
  list** to `affiliate_price_overrides` (so future bound customers inherit it) and (b) targets all
  their customers; admins **must select ≥1 customer**. Both write `customer_price_overrides` via
  upsert `onConflict 'customer_id,product_id'`.
- UI: `app/(admin)/admin/pricing/_components/PriceListImportModal.tsx`.

**UI:** `app/(admin)/admin/pricing/page.tsx` — single + **bulk** override add (select many customers
→ product + price → apply), CSV import/export, delete.

### Tier D — Consumers (the seams to other clusters)

- **Storefront (Cluster 2):** `app/api/products/route.ts` + `featured` merge
  `customer_price_overrides` → `price`/`has_override`/`original_price`.
- **Invoices (Cluster 5):** `components/admin/InvoiceForm.tsx` calls `getActivePricelist()` and
  resolves each line's unit price as **active pricelist price → product default** (editable per
  line). The form shows "Prices default from active pricelist {name}" or "No active pricelist".
- **Affiliate binding (Cluster 8):** `app/api/admin/customers/route.ts` →
  `applyAffiliatePricelist(customerId, affiliateId)` copies `affiliate_price_overrides` into
  `customer_price_overrides` (upsert) on create/bind.

---

## 4. End-to-end flows to trace

1. **Create + activate a pricelist:** POST (seed from products or copy a source) → PATCH
   `{is_active:true}` (clears prior active first) → invoice builder's `getActivePricelist()` now
   returns it → new invoice lines default to those prices.
2. **Per-customer override → storefront:** admin POST/import an override → `/api/products?customer_id=…`
   merges it → customer sees their price (`has_override`, `original_price` shown struck-through).
3. **Price resolution at invoice time:** InvoiceForm `priceFor(p)` = `pricelist.prices[p.id] ??
   product.price` (override handling lives in the customer/product selection). Cross-check against
   the invoice create route (Cluster 5).
4. **Affiliate list inheritance (optional):** affiliate imports their list → saved to
   `affiliate_price_overrides` → new customer bound to them → `applyAffiliatePricelist` copies into
   `customer_price_overrides`.

---

## 5. Extraction checklist & gotchas

- [ ] Enforce **single active pricelist** via the partial UNIQUE index `WHERE is_active`, AND keep
      the PATCH "clear current active first" step — the index alone will otherwise make activation throw.
- [ ] All three override/item tables use **UNIQUE (entity_id, product_id)** + **upsert onConflict** —
      preserve those conflict targets exactly.
- [ ] Pricelist RLS = **service-role only**; override RLS adds **owner-SELECT** for customers (storefront
      depends on it).
- [ ] Pricelist mutations are **admin-only** (`canCreate`); override routes also admit **affiliate**
      scoped to bound customers — strip that branch if not porting Cluster 8.
- [ ] Create rolls back the pricelist if item-seeding fails — keep it.
- [ ] **Resolution priority** (customer override → active pricelist → product default) must match in
      both the storefront merge and the invoice builder, or prices diverge between cart and invoice.
- [ ] CSV import is multipart with `customer_ids` + `mode`; admins must pick ≥1 customer; the affiliate
      path also writes `affiliate_price_overrides`.
- [ ] Affiliate pieces to strip with Cluster 8: `affiliate_price_overrides` table,
      `orders.discount_amount`, the affiliate auth branch + `affiliateOwnsCustomer`/`boundCustomerIds`
      in the override routes, and `applyAffiliatePricelist` in the customers route.

---

## 6. File index (everything in Cluster 3)

```
DB        pricelist-migration.sql, customer-pricing-migration.sql,
          affiliate-pricelist-migration.sql (Cluster 8),
          affiliate-discount-commission-migration.sql (orders.discount_amount, Cluster 8)
libs      lib/admin/pricelists.ts  (+ Pricelist/override types in lib/supabase.ts)
API       app/api/admin/pricelists/{route,[id],active}.ts
          app/api/admin/price-overrides/{route,import}.ts
admin UI  components/admin/PricelistsTab.tsx (in app/(admin)/admin/invoices/page.tsx),
          app/(admin)/admin/pricing/page.tsx,
          app/(admin)/admin/pricing/_components/PriceListImportModal.tsx
consumers app/api/products/route.ts + featured (storefront merge, Cluster 2),
          components/admin/InvoiceForm.tsx (getActivePricelist, Cluster 5),
          app/api/admin/customers/route.ts (applyAffiliatePricelist, Cluster 8)
docs      docs/module-ports/08-pricing-and-pricelists.md
```

**Deps:** `xlsx` (override CSV import). **Audit actions:** `pricelist.create/update/delete`
(`lib/admin/audit.ts`, Cluster 1).
```
