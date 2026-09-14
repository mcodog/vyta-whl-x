# Analytics + Reporting Layer — Build Spec

> Definitive spec for rebuilding this feature cluster in a Next.js + Supabase codebase.
> Generated from: `app/api/admin/analytics/summary/route.ts`; `lib/admin/analytics.ts`;
> `lib/admin/report-html.ts`; the five report routes
> `app/api/admin/{orders,products,customers,affiliates,commissions}/report/route.ts`; and
> `app/(admin)/admin/analytics/page.tsx`. Stack: **Next.js 15 App Router** (route-segment
> `revalidate`) + **Supabase** (service-role) + **Tailwind** (dashboard) + self-printing HTML reports.
>
> Describes the code **as it exists**. This is the **read-only** aggregation layer — it **owns no
> tables**; it reads everything the other clusters produce. Port it last (or any time after the tables
> it reads exist).

---

## 0. The behaviors that matter

1. **Date scoping differs by source.** In the dashboard summary, **invoices are scoped on
   `issue_date`**, **purchase orders on `created_at`** (`gte`/`lte` against the `from`/`to` params).
2. **Per-invoice paid math:** `paid += min(sum(payments), invoice.total)` and `outstanding = max(0,
   invoiced − paid)`. So payments on draft/excluded invoices can't inflate totals, and outstanding
   can never go negative.
3. **Summary route is cached** (`export const revalidate = 30`) **+ parallel-fetched**
   (`Promise.all`). The client still bypasses with `cache: 'no-store'`.
4. **Report routes `select('*')` on purpose** — so they don't 500 before optional migrations have run
   — then **filter in memory**. `report-html.ts` renders a **self-printing** HTML page shared across
   orders / products / customers / affiliates / commissions.

---

## 1. Overview

A single dashboard summary endpoint and five printable report endpoints, plus the shared HTML
renderer. The **summary** (`GET /api/admin/analytics/summary`) aggregates inventory, incoming POs, and
revenue into one cached, date-scopable object for the Analytics page. The **reports** each pull a table
(orders, products, customers, affiliates, commissions), apply in-memory filters, compute stats, and
return a self-contained HTML document via `reportShell` that auto-prints (so the browser's "Save as
PDF" produces the file). Nothing here writes; access is admin/assistant. The cluster depends on
Invoices/Payments (6), Orders (5), Products (3), Purchase Orders (7), and the affiliate/commission
tables (8/9), but introduces no schema of its own.

---

## 2. Schema

**None.** This cluster owns no tables. It reads:
`invoices` + `payments` (revenue), `products` (inventory), `purchase_orders` + `purchase_order_items`
(incoming), `orders`/`order_items` (orders + product/customer revenue), `customers`, `affiliates` +
`referral_codes` + `commissions`, and `sales_commissions` (commissions report). See the owning
clusters for those definitions.

---

## 3. Components

### Summary endpoint — `GET /api/admin/analytics/summary`
- **Auth:** admin/assistant (bearer → `customers.role`). `export const revalidate = 30` (server-side
  cache TTL; the client lib forces `cache:'no-store'` to bypass on demand).
- **Constants:** `LOW_STOCK_THRESHOLD = 5`; `OPEN_PO_STATUSES = ['pending','partially_fulfilled']`;
  `REVENUE_INVOICE_STATUSES = ['sent','partial','paid','overdue']` (draft excluded).
- **Date scope:** params `from`/`to` (YYYY-MM-DD inclusive). **Invoices** filtered
  `gte/lte('issue_date', …)`; **POs** filtered `gte/lte('created_at', …)`.
- **Parallel fetch** (`Promise.all`): active products; open POs (with supplier, ordered by
  `expected_date` nulls-last); revenue invoices (with `payments(amount)`).
- **Inventory** reduce: `units`, `value` (Σ qty·price, 2dp), `sku_count`, `low_stock_count`
  (qty < 5).
- **Incoming:** `po_count`, `value` (Σ total), `units` (Σ `purchase_order_items.qty` across the open
  PO ids, a follow-up query), and the PO list (`{id, po_number, supplier_name, status, total,
  expected_date}`).
- **Revenue (per-invoice paid math):** for each invoice, `invoiced += total`; `paid += min(Σ payments,
  total)`; count `paid` status. Returns `invoiced`, `paid`, `outstanding = max(0, invoiced − paid)`,
  `invoice_count`, `paid_invoice_count`, `range`.
- Returns `{ summary: AnalyticsSummary }` (type in `lib/supabase.ts`). Any query error → 500.

### Client lib — `lib/admin/analytics.ts`
- `getAnalyticsSummary(range?)` → `AnalyticsSummary | null`. Attaches the bearer token, builds
  `?from=&to=`, fetches with **`cache:'no-store'`** (so an explicit refresh ignores the 30s server
  cache), returns `summary` or `null` on failure.

### Shared report renderer — `lib/admin/report-html.ts`
Pure HTML builders (no DB):
- `escapeHtml`, `money(n)` (`$x.xx`), `formatDate(d)` (locale or `—`).
- `statsGrid(stats: Stat[])` — responsive grid (1–4 cols); each `Stat` has `label/value/meta?/tone?`
  (`default|pending|paid|danger`).
- `table(columns, rows, emptyText?)` — `Column {header, num?}`; **cell values are raw HTML** (callers
  escape their own content so they can embed pills/sub-labels — never pass untrusted strings).
- `pill(text, tone)` — colored chip.
- **`reportShell({title, filters?, body, footRight?, autoPrint=true})`** — returns a full `<!doctype
  html>` A4 document with embedded CSS (Aminocan palette: `#1A1A1A` ink, `#6E6E6E` muted, `#C9CCD1`
  rules, pill color classes green/amber/red/blue/purple), a header (`Aminocan · Generated <now>`), the
  filters chip row, the body, a footer, and — when `autoPrint` — a `window.print()` on load (≈350ms
  delay). This is what makes "open report → Save as PDF" work.

### Report endpoints (all admin/assistant; all `select('*')`-or-joins → in-memory filter → `reportShell`)

| Route | Reads | Filters (query params, in-memory) | Stats / notes |
|---|---|---|---|
| `GET …/orders/report` | `orders` (`select('*')`, newest first) | `q`, status, etc. | Revenue **excludes cancelled** (`nonCancelled`); order count + revenue stats. |
| `GET …/products/report` | `products` + `order_items` | `q`, `category`, `status` | Stock on-hand/value, low/out counts, all-time per-product revenue (matched by `product_id`→`product_name`). (Documented in the Products cluster.) |
| `GET …/customers/report` | `customers` (`select(...)`) + `orders` | `q`, status | Active count, with-affiliate, staff count; **lifetime revenue per customer** (sums non-cancelled orders by `customer_id`). |
| `GET …/affiliates/report` | `affiliates` + `referral_codes` + `commissions` + `customers` (+ `orders`) | `q`, status | Per-affiliate commission rollup (count/pending/paid/total) + revenue generated; active count. |
| `GET …/commissions/report` | `commissions` (+ affiliate/order joins) **and** `sales_commissions` (+ sales-person/invoice joins) | `source` (`affiliate|sales`), status, recipient | Merges both commission sources into one list (newest first); pending/paid totals. |

All compose `statsGrid(...) + table(...)` into `reportShell({ title, filters, body, footRight,
autoPrint: sp.get('print') !== '0' })` and return `text/html`. `runtime='nodejs'`,
`dynamic='force-dynamic'`.

### Dashboard page — `app/(admin)/admin/analytics/page.tsx`
- `getAnalyticsSummary({from, to})`; `from`/`to` date inputs; renders **inventory**, **incoming POs**
  (statuses via `PO_STATUS_META`), and **revenue** cards. Links out to the printable reports
  (`?print` opens the auto-printing HTML).

---

## 4. UI/UX design overview

### Dashboard (Analytics page)
Standard admin theme (`ink #1A1A1A`, `bronze #9C8B5A`, `surface #F7F7F7`, `line #C9CCD1`; icons
`lucide-react`). Date-range inputs + three sections (Inventory / Incoming / Revenue) as
`bg-white rounded-xl border border-line` cards; PO rows use `PO_STATUS_META` badges; "Download
Report" / report links open the printable HTML.

### Printable reports (`reportShell` CSS, exact)
- A4 page, `-apple-system` font, `#1A1A1A` text on white; `.wrap` max-width 920px.
- `h1` 22px; `.sub` muted "Aminocan · Generated <timestamp>".
- `.filters` chip row (`#F7F7F7` panel, white pills).
- `.stats` responsive grid; `.stat` bordered card; tone colors: pending `#B45309`, paid `#047857`,
  danger `#B91C1C`.
- `table`: 11.5px, `#C9CCD1` header rule, `#F2F2F2` row rules, `.num` right-aligned tabular.
- `.pill` tones: green/active/paid/delivered `#D1FAE5/#065F46`; amber/pending/processing
  `#FEF3C7/#92400E`; red/inactive/cancelled/out `#FEE2E2/#991B1B`; blue/shipped/confirmed
  `#DBEAFE/#1E40AF`; purple/admin `#EDE9FE/#6D28D9`.
- `.empty` centered placeholder; `.foot` title + `footRight`; `@media print { body { padding: 0 } }`.
- **Auto-print:** `window.print()` ~350ms after load (unless `?print=0`).

---

## 5. Data flow & behavior

- **Summary:** page → `getAnalyticsSummary` (`no-store`) → route (cached 30s) → parallel queries
  (invoices on `issue_date`, POs on `created_at`, active products) → reduce to `{inventory, incoming,
  revenue}` with the min/max paid math → render dashboard cards.
- **Reports:** link/button → report route → `select('*')` (resilient to missing optional columns) →
  in-memory filter by query params → stats + table → `reportShell` HTML → browser auto-prints → Save
  as PDF.
- **No writes anywhere.** Access gated to admin/assistant; the service-role client reads across tables.

### Why the paid math matters
Summing payments globally and capping each at its invoice total prevents (a) overpayments or payments
on excluded/draft invoices from inflating `paid`, and (b) `outstanding` from going negative — the two
classic A/R aggregation bugs.

### Why `select('*')`
Reports run against tables that gain columns through optional migrations across other clusters.
Selecting `*` + filtering in memory means a report never 500s just because an optional column/migration
isn't present in a given environment.

---

## 6. Edge cases & states

- **No date range:** summary aggregates all qualifying rows; `range: {from:null, to:null}`.
- **Payments exceeding invoice total / on draft invoices:** capped by `min(...)`; never inflate `paid`
  or push `outstanding` below 0.
- **No open POs:** incoming units/value 0, empty PO list (the items follow-up query is skipped).
- **Empty report:** `table(...)` renders the `.empty` placeholder.
- **`?print=0`:** report renders without auto-printing (for in-browser viewing).
- **Unauthorized (non-admin/assistant):** 403 (summary JSON / reports `Unauthorized` text).
- **Stale dashboard:** up to 30s due to `revalidate`; the client's `no-store` fetch forces a fresh
  read on explicit refresh.

---

## 7. Open questions & unverified items

- **Report routes' exact filter params** were captured at the grep level (each filters in memory by
  `q`/status/category/source/recipient as applicable); the precise per-route param set and column
  selections beyond the `select('*')`/join shape weren't transcribed line-by-line.
- **`products/report`** is fully documented in the Products cluster spec; referenced here only as a
  consumer of `report-html.ts`.
- **`commissions/report`** merges `commissions` (affiliate, Cluster 8) + `sales_commissions`
  (Cluster 9) — both source clusters own those tables; this route only reads/merges them.
- **The Analytics page** was captured at the structural level (data call, date inputs, three sections,
  report links) rather than line-by-line styling.
- **`AnalyticsSummary` type** lives in `lib/supabase.ts` (documented in the auth-cluster spec's type
  inventory).
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (all routes).
