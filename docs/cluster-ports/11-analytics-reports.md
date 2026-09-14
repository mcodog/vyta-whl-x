# Cluster 11 — Analytics & Reports: Code Extraction Guide

> **What this document is.** A file-by-file walkthrough of Cluster 11 so you can extract it
> completely. For each piece: *what to open*, *what it does*, *its intricacies*, and *exactly
> how it touches the database*. Ports **last** — it **owns no tables**; it's pure read/derive over
> invoices, payments, purchase orders, products, orders, and commissions.
>
> **Companion deep spec:** `docs/module-ports/10-analytics.md`. This is the *map*; that's the *atlas*.

---

## 1. What the cluster is / does

Two read-only surfaces:
1. **Analytics summary** (`/admin/analytics`) — date-ranged business metrics: inventory value,
   incoming-PO value, and revenue (invoiced/paid/outstanding).
2. **Admin dashboard** (`/admin`) — stat cards + recent orders + low-stock + fulfillment/auto-shipment
   feeds (`getAdminStats`, `getLowStockProducts`, `getAutoShipmentFailures`).

Plus the **printable HTML reports** shared by several modules (orders/products/customers/affiliates/
commissions) via `lib/admin/report-html.ts`.

**Why it ports last:** it has **no schema of its own** and simply aggregates the other clusters.
Build it once its data sources (2 products, 4 orders, 5 invoices/payments, 7 POs, 9/8 commissions)
exist.

---

## 2. Database — reads only (no tables owned)

| Source table | Used for |
|--------------|----------|
| `products` (active) | inventory units/value/sku_count/low_stock_count |
| `purchase_orders` (open statuses) + `purchase_order_items` | incoming units/value + per-PO list |
| `invoices` (revenue statuses) + nested `payments` | invoiced / paid / outstanding |
| `orders`, `order_items` | dashboard revenue + recent orders + report |
| `commissions` / `sales_commissions` | dashboard pending-commission figures (Clusters 8/9) |
| `shipment_auto_logs` | dashboard auto-shipment failure feed (Cluster 6) |

No migrations belong to this cluster.

---

## 3. The reading map (open files in this order)

### Tier A — Types
- `lib/supabase.ts` → **`AnalyticsSummary`** (the full response shape: `inventory`, `incoming`
  (+ `pos[]`), `revenue` (+ `range`)).

### Tier B — Analytics summary

**`app/api/admin/analytics/summary/route.ts`** (`GET`) — *the metrics engine.* (Read in full.)
- `export const revalidate = 30` (cached 30s). Admin/assistant only.
- Optional `?from&to` (YYYY-MM-DD): scopes **invoices on `issue_date`**, **POs on `created_at`**.
- **Parallel fetch** (`Promise.all`) of active products, open POs, revenue invoices (with nested
  `payments`). Then:
  - **Inventory:** sum `stock_quantity` (units) and `qty × price` (value); count SKUs; count
    `< LOW_STOCK_THRESHOLD`.
  - **Incoming:** sum open-PO totals (value), fetch `purchase_order_items.qty` for those PO ids
    (units), include a per-PO list.
  - **Revenue (intricacy):** **per-invoice** paid math — `paid += min(sum(payments), invoice.total)`
    so payments on excluded/draft invoices never inflate the global figure and **`outstanding` can't
    go negative** (`Math.max(0, invoiced − paid)`). Uses `REVENUE_INVOICE_STATUSES`.

**`lib/admin/analytics.ts`** — `getAnalyticsSummary(range?)` client wrapper (attaches bearer token,
`cache:'no-store'`, calls the route). UI: `app/(admin)/admin/analytics/page.tsx` (date filters,
refresh, slow-load notice, retry).

### Tier C — Dashboard

**`lib/admin/api.ts`** (dashboard portion) — `getAdminStats()` (total revenue, pending orders,
affiliate count, pending commissions — reads `orders`, `affiliates`, `commissions`),
`getLowStockProducts()` (reads `products`), `getAutoShipmentFailures()` (reads `shipment_auto_logs`),
recent-orders/sales-commission helpers. UI: `app/(admin)/admin/page.tsx` +
`_components/{FulfillmentAlerts,AutoShipmentAlerts}.tsx`.

### Tier D — Printable reports (shared)

**`lib/admin/report-html.ts`** — the report renderer: `statsGrid`, `table(columns, rows)`, `pill`,
**`reportShell({title, filters, body, footRight, autoPrint})`** (returns a self-printing HTML page).
- Consumed by **`app/api/admin/{orders,products,customers,affiliates}/report/route.ts`** and the
  commissions report (Cluster 9). Each route: admin/assistant gate → `select *` (defensive against
  optional columns) → in-memory filter (search/status/source/date) → build stats + table →
  `reportShell` → return HTML (opens in a tab, auto-prints to PDF).

---

## 4. End-to-end flows to trace

1. **Analytics page:** pick date range → `getAnalyticsSummary` → summary route (parallel queries +
   per-invoice paid math) → cards (inventory / incoming / revenue).
2. **Dashboard:** `/admin` → `getAdminStats` + `getLowStockProducts` + `getAutoShipmentFailures` →
   stat cards + alert feeds + recent orders.
3. **Printable report:** any module's "Download report" → `/api/admin/<x>/report?filters` →
   `reportShell` HTML → browser auto-print to PDF.

---

## 5. Extraction checklist & gotchas

- [ ] **No tables to create** — port last, after its data sources exist.
- [ ] Date scoping differs by source: **invoices on `issue_date`, POs on `created_at`** — keep that
      distinction or the numbers shift.
- [ ] **Revenue paid is computed per-invoice with `min(paid, total)`** and `outstanding = max(0, …)` —
      this prevents draft/excluded-invoice payments from inflating totals or driving outstanding
      negative. Preserve it.
- [ ] Summary route is cached (`revalidate = 30`) and runs queries in parallel — keep both for perf.
- [ ] Report routes **`select *`** intentionally (so they don't 500 before optional migrations) and
      filter in memory — match that defensiveness.
- [ ] Dashboard `getAdminStats` reads `affiliates`/`commissions` (Cluster 8) — strip those figures if
      not porting affiliates; the inventory/revenue/order stats stand alone.
- [ ] Everything is admin/assistant **read-only**.

---

## 6. File index (everything in Cluster 11)

```
DB        (none — pure read/derive)
libs      lib/admin/analytics.ts, lib/admin/report-html.ts,
          lib/admin/api.ts (getAdminStats/getLowStockProducts/getAutoShipmentFailures portion)
          (+ AnalyticsSummary type in lib/supabase.ts)
API       app/api/admin/analytics/summary/route.ts,
          app/api/admin/{orders,products,customers,affiliates}/report/route.ts,
          app/api/admin/commissions/report/route.ts (Cluster 9)
admin UI  app/(admin)/admin/analytics/page.tsx,
          app/(admin)/admin/page.tsx + _components/{FulfillmentAlerts,AutoShipmentAlerts}.tsx
docs      docs/module-ports/10-analytics.md
```

**Reads from:** Clusters 2 (products), 4 (orders), 5 (invoices/payments), 7 (POs), 6
(shipment_auto_logs), 8/9 (commissions). **Owns nothing.** Admin/assistant read-only.
```
