# Cluster 9 — Sales People & Commissions: Code Extraction Guide

> **What this document is.** A file-by-file walkthrough of Cluster 9 so you can extract it
> completely. For each piece: *what to open*, *what it does*, *its intricacies*, and *exactly
> how it touches the database*. Ports **ninth** (after the invoice flow). Sales commissions are
> *populated from the invoice create/edit flow* (Cluster 5); the unified commissions report
> *merges* sales + affiliate commissions (Cluster 8).
>
> **Companion deep spec:** `docs/module-ports/12-sales-people.md`. This is the *map*; that's the *atlas*.

---

## 1. What the cluster is / does

Internal **sales reps** (distinct from affiliates) and their **commissions**:
- CRUD for sales people, each with a default `commission_rate` and active flag.
- When an invoice is created/edited, **every** sales person credited on it (up to five) snapshots
  their own rate + amount, and one `sales_commissions` ledger row is written per person. Each earns
  `invoice total x their own rate` — the rates are independent, not slices of one pot, so they may
  sum past 100%. The **primary** (position 0) is mirrored onto the invoice's own
  `sales_person_id` / `sales_person_commission_rate` / `_amount` columns.
- A customer carries an assigned **sales team** with per-customer rates, which pre-fills new
  invoices for them (`customers.default_sales_person_id` mirrors the primary).
- A **unified commissions report** (`/admin/commissions`) merges `sales_commissions` (this cluster)
  with `commissions` (affiliate, Cluster 8) into one filterable, mark-as-paid, CSV-exportable view.

**Why it ports late:** the ledger only fills from the invoice flow, and the report depends on both
this cluster and the affiliate `commissions` table. Build it after invoices (5) and — if you want
the merged view — after affiliates (8).

---

## 2. Database schema — what exists and where it comes from

### `sales_persons` (`invoice-sales-features-migration.sql`)
`id`, `first_name`, `last_name`, `email`, `phone`, **`commission_rate numeric(5,2) DEFAULT 5.00`**,
`notes`, `active boolean DEFAULT true`, **`total_earnings numeric DEFAULT 0`** (denormalized — *not*
live-maintained; the UI computes live stats instead), timestamps. Indexes on `active` and
`lower(last_name), lower(first_name)`. `updated_at` trigger via `set_updated_at()`.

### `invoices` columns (same migration)
`sales_person_id → sales_persons ON DELETE SET NULL`, **`sales_person_commission_rate`**,
**`sales_person_commission_amount`** — the per-invoice **snapshot** (so changing a rep's rate later
never rewrites past invoices). Index on `sales_person_id`. Since
`multi-sales-person-migration.sql` these hold the **primary** seat only; the full roster lives in
`invoice_sales_persons` below and every legacy reader keeps working off these columns unchanged.

### `invoice_sales_persons` (`multi-sales-person-migration.sql`)
`id`, `invoice_id → invoices ON DELETE CASCADE`, `sales_person_id → sales_persons ON DELETE
CASCADE`, `commission_rate`, `commission_amount` (both **snapshots**), `position smallint CHECK
(0..4)`. Unique on `(invoice_id, sales_person_id)` **and** `(invoice_id, position)` — together those
two constraints are what caps an invoice at **five** credited people; there is no trigger. Backfilled
from the invoice columns above, so historical invoices become one-person rosters with their recorded
numbers untouched.

### `customer_sales_persons` (same migration)
`id`, `customer_id → customers ON DELETE CASCADE`, `sales_person_id → sales_persons ON DELETE
CASCADE`, `commission_rate` (the rate this person earns **on this customer**), `position` (same
0..4 CHECK + unique pair), timestamps with the `set_updated_at()` trigger. Position 0 is mirrored
onto `customers.default_sales_person_id`. Backfilled from that column.

### `sales_commissions` (same migration)
`id`, `sales_person_id → sales_persons ON DELETE CASCADE`, `invoice_id → invoices ON DELETE SET
NULL`, `amount`, `invoice_total`, **`commission_rate` (snapshot)**, **`status CHECK IN
('pending','paid','cancelled')`**, `paid_at`, `created_at`. Indexes on sales_person/invoice/status.

### `commissions` (affiliate — Cluster 8, READ by the report)
Created in `affiliate-program-migration.sql`. The unified report joins it for the affiliate half.
**Not owned here** — if not porting Cluster 8, the report degrades to sales-only.

### RLS
`sales_persons`, `sales_commissions`, `invoice_sales_persons`, `customer_sales_persons` →
admin/assistant **read**, admin **write** (service-role bypasses). Routes re-verify role.

---

## 3. The reading map (open files in this order)

### Tier A — Types & lib
- `lib/supabase.ts` → `SalesPerson`, `SalesCommission`, `SalesCommissionStatus`,
  `InvoiceSalesPerson`, `CustomerSalesPerson`.
- **`lib/admin/sales-attribution.ts`** — the one module that knows how a deal is split: roster
  normalisation (dedupe, clamp, cap at five), commission maths, and the read/write helpers for both
  roster tables. Every invoice and customer write goes through it.
- **`lib/admin/sales-persons.ts`** — `getAllSalesPersons`, **`getSalesPersonsWithStats()`** (joins
  `sales_commissions`, computes `paid_earnings`/`pending_earnings`/invoice count live — the
  denormalized `total_earnings` is ignored), `searchSalesPersons`, `createSalesPerson`,
  `updateSalesPerson`, `deleteSalesPerson`.
- `lib/admin/api.ts` → `getAllCommissions`, `getAllSalesCommissions`, **`markCommissionPaid`**
  (affiliate) + the sales-commission mark-paid variant.

### Tier B — Sales-persons API

**`app/api/admin/sales-persons/route.ts`** — GET (list) + POST (create).
- POST gated by **`canCreate`** (admin). Inserts with `commission_rate ?? 5`, `active ?? true`.

**`app/api/admin/sales-persons/[id]/route.ts`** — PATCH (edit/toggle active) + DELETE.
- **Intricacy:** PATCH uses **`canCreate`** (not `canEdit`) and DELETE uses `canDelete` — both are
  admin-only so the effect is identical, but note the helper choice if you refactor permissions.
  PATCH whitelists `first_name/last_name/email/phone/commission_rate/notes/active`.
- DELETE cascades `sales_commissions` (FK CASCADE) — the dialog warns commission history is lost.

### Tier C — The commission write path (lives in Cluster 5)

Sales commissions are **created/updated by the invoice routes**, not here:
- `app/api/admin/invoices/route.ts` (create): computes `commissionAmount` from the rate, writes
  `sales_person_commission_rate/amount` onto the invoice, **inserts a `sales_commissions` row**.
- `app/api/admin/invoices/[id]/route.ts` (edit): recomputes the snapshot and **upserts** the
  `sales_commissions` row.
> Trace these to understand where the ledger fills. Affiliates cannot change the commission rate
> (the edit route guards `role !== 'affiliate'`).

### Tier D — Unified commissions report

**`app/api/admin/commissions/report/route.ts`** (`GET`) — *the merged ledger.*
- Reads **both** `commissions` (join `affiliates` + `orders` order_number) **and** `sales_commissions`
  (join `sales_persons` + `invoices` invoice_number), normalizes into rows with a **`source:
  'affiliate' | 'sales'`** discriminator, a reference (order/invoice number), recipient name/email,
  amount, status, paid_at.
- Filters: `source`, `status`, `recipient` (`src::name`), free-text search. Aggregates pending/paid/
  cancelled totals + per-source counts. Supports CSV export.

**Mark as paid:** `markCommissionPaid` (affiliate → `commissions`) and the sales variant
(→ `sales_commissions`) set `status:'paid'` + `paid_at`. Admin-only.

### Tier E — UI
- `app/(admin)/admin/sales-people/page.tsx` + `_components/{CreateSalesPersonModal,
  EditSalesPersonModal,DeleteSalesPersonDialog}.tsx` — list w/ live paid/pending stats, search,
  status filter, toggle-active.
- `app/(admin)/admin/commissions/page.tsx` — unified report table, filters, mark-paid, CSV.

---

## 4. End-to-end flows to trace

1. **Create rep:** POST `/api/admin/sales-persons` → row with default 5% rate.
2. **Commission accrues:** admin creates an invoice with `sales_person_id` (Cluster 5) → invoice
   snapshots rate+amount → `sales_commissions` row (`pending`). Editing the invoice upserts it.
   Changing the rep's rate later does **not** rewrite past commissions (snapshot).
3. **Report + payout:** `/admin/commissions` → report route merges affiliate + sales rows →
   filter/search → mark paid (`status:'paid'`, `paid_at`) → CSV export.
4. **Rep stats:** sales-people page → `getSalesPersonsWithStats` recomputes paid/pending live from
   `sales_commissions` (ignores `total_earnings`).

---

## 5. Extraction checklist & gotchas

- [ ] Commission rate + amount are **snapshotted** onto both the invoice and the `sales_commissions`
      row — editing a rep's rate must not retroactively change history. Preserve the snapshot.
- [ ] `total_earnings` on `sales_persons` is **vestigial/denormalized** — the UI computes live stats
      from `sales_commissions`. Don't rely on `total_earnings`.
- [ ] The **ledger fills from the invoice flow** (Cluster 5), not from any route in this cluster —
      port the `sales_commissions` insert/upsert in the invoice create/edit routes.
- [ ] PATCH on sales-persons uses **`canCreate`** (admin) rather than `canEdit` — same outcome, but
      note it. DELETE uses `canDelete`; it cascades the commission history.
- [ ] The **unified report reads the affiliate `commissions` table** (Cluster 8). Without affiliates,
      drop the affiliate half and the `source:'affiliate'` rows — the sales half stands alone.
- [ ] Mark-paid is **admin-only** and split across two tables (`commissions` vs `sales_commissions`)
      keyed by the row's `source`.
- [ ] RLS: admin/assistant read, admin write — assistants see the report read-only.

---

## 6. File index (everything in Cluster 9)

```
DB        invoice-sales-features-migration.sql (sales_persons, sales_commissions,
            invoices.sales_person_* columns)
          [commissions table is Cluster 8 — read by the unified report]
libs      lib/admin/sales-persons.ts, lib/admin/api.ts (commission fns)
          (+ SalesPerson/SalesCommission types in lib/supabase.ts)
API       app/api/admin/sales-persons/{route,[id]}.ts,
          app/api/admin/commissions/report/route.ts
          [write path: app/api/admin/invoices/{route,[id]}.ts — Cluster 5]
admin UI  app/(admin)/admin/sales-people/page.tsx + _components/{Create,Edit,Delete}SalesPerson*.tsx,
          app/(admin)/admin/commissions/page.tsx
docs      docs/module-ports/12-sales-people.md
```

**Seams:** Cluster 5 (invoice flow writes `sales_commissions` + invoice snapshot), Cluster 8
(affiliate `commissions` merged into the report), Cluster 1 (RBAC). **Audit:** sales-person/
commission mutations may log via `lib/admin/audit.ts`.
```
