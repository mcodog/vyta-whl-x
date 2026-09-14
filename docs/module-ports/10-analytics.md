# Module 10 — Analytics (Admin Dashboard)

A single read-only admin analytics dashboard at `/admin/analytics` that surfaces three operational areas "at a glance": **Inventory on hand**, **Incoming purchase orders (open POs)**, and **Revenue** (invoiced / paid / outstanding). It supports an optional inclusive **date range** (From / To) that scopes revenue (by invoice `issue_date`) and incoming POs (by `created_at`). All numbers are computed server-side in one endpoint (`/api/admin/analytics/summary`) from live `products`, `purchase_orders`, `purchase_order_items`, and `invoices`/`payments` data — there is no separate analytics/aggregates table and no charting library (KPI cards + a table, no graphs).

> **Affiliate note (STRIP):** `app/api/admin/affiliate-performance/route.ts` is an affiliate analytics endpoint (per-affiliate bound-customer counts + revenue). It is **not part of this dashboard** and is **not to be ported**. It is documented briefly at the end only so you can recognize and skip it.

---

## Data model

Analytics is purely derived — it owns **no tables**. It reads from tables owned by other modules:

| Table | Columns read | Used for |
|---|---|---|
| `products` | `id, price, stock_quantity`, filtered `active = true` | Inventory units/value/SKU count/low-stock count |
| `purchase_orders` | `id, po_number, status, total, expected_date, supplier:suppliers(id,name)`, filtered to open statuses | Incoming value, PO list |
| `purchase_order_items` | `qty`, filtered by `purchase_order_id IN (open POs)` | Incoming units |
| `invoices` | `id, total, status, payments(amount)`, filtered to revenue statuses | Invoiced/paid/outstanding/counts |
| `payments` | `amount` (nested under invoices) | Paid amount per invoice |
| `customers` | `role` | Auth role lookup |

**Server constants** (`app/api/admin/analytics/summary/route.ts`):
- `LOW_STOCK_THRESHOLD = 5` — a SKU counts as low-stock when `stock_quantity < 5`.
- `OPEN_PO_STATUSES = ["pending", "partially_fulfilled"]`.
- `REVENUE_INVOICE_STATUSES = ["sent", "partial", "paid", "overdue"]` — draft/cancelled invoices are excluded so outstanding can't be inflated.

**`AnalyticsSummary` type** (`lib/supabase.ts`):
```ts
interface AnalyticsSummary {
  inventory: { units: number; value: number; sku_count: number; low_stock_count: number };
  incoming: {
    units: number; value: number; po_count: number;
    pos: Array<{ id; po_number; supplier_name: string|null; status: PurchaseOrderStatus; total; expected_date: string|null }>;
  };
  revenue: {
    invoiced: number; paid: number; outstanding: number;
    invoice_count: number; paid_invoice_count: number;
    range: { from: string|null; to: string|null };
  };
}
```

---

## API endpoints

### `GET /api/admin/analytics/summary` (`app/api/admin/analytics/summary/route.ts`)

- **Caching:** `export const revalidate = 30` (server caches at most every 30s); the client calls with `cache:'no-store'` to bypass on manual refresh.
- **Auth:** `isAdminOrAssistant(request)` — reads Bearer token, `supabase.auth.getUser(token)`, looks up `customers.role`; returns true only for `admin` or `assistant`. Otherwise `403 {error:'Unauthorized'}`. Uses the **service-role** client.
- **Query params:** `from` and `to` (both `YYYY-MM-DD`, inclusive, optional).
- **Logic:**
  1. Builds the invoice query (`status IN REVENUE_INVOICE_STATUSES`, scoped to `issue_date >= from` / `<= to` when provided).
  2. Builds the open-PO query (`status IN OPEN_PO_STATUSES`, ordered by `expected_date` ascending nulls-last, scoped to `created_at >= from` / `<= to`).
  3. Parallel-fetches active products, POs, and invoices via `Promise.all`. On any error → `500 {error}`.
  4. **Inventory:** reduces products → `units += stock_quantity`, `value += qty*price`, `sku_count += 1`, `low_stock_count += 1 if qty < 5`. `value` rounded to 2dp.
  5. **Incoming:** `incomingValue = Σ po.total`; if any open POs, a second query sums `purchase_order_items.qty` for those PO ids → `incomingUnits`. Builds `pos[]` projection.
  6. **Revenue (per-invoice paid math):** for each invoice `invoiced += total`; `invPaid = Σ payments.amount`; `paid += min(invPaid, total)` (a payment can never exceed its own invoice total, so outstanding can't go negative); `paid_invoice_count += 1 if status === 'paid'`. `outstanding = max(0, invoiced - paid)`.
- **Response:** `200 { summary: AnalyticsSummary }`.

### Client fetch wrapper — `lib/admin/analytics.ts`

`getAnalyticsSummary(range?: {from?,to?}): Promise<AnalyticsSummary|null>`. Gets the Supabase session, attaches `Authorization: Bearer <access_token>`, appends `?from=&to=` query string, fetches with `cache:'no-store'`, returns `summary` or `null` on non-OK/error (logs to console). Also re-exports the `AnalyticsSummary` type and exports `AnalyticsRange { from?: string|null; to?: string|null }`.

---

## Frontend

- **Route/page:** `/admin/analytics` → `app/(admin)/admin/analytics/page.tsx` (`'use client'`, default export `AnalyticsPage`). Single self-contained file; sub-components `KpiCard`, `DetailCard`, `DateField` defined inline.
- **State (React `useState`):** `summary: AnalyticsSummary|null`, `loading`, `refreshing`, `from: string`, `to: string`.
- **Data flow:** `load` (`useCallback` over `from`/`to`) calls `getAnalyticsSummary({from:from||null, to:to||null})`, sets `summary`, clears loading/refreshing. `useEffect(() => load(), [load])` re-runs whenever the date range changes — so editing a date field auto-refetches; the Refresh button also calls `load`. `unpaidInvoiceCount` is a `useMemo` = `invoice_count - paid_invoice_count`.
- **Formatting helpers:** `fmtCurrency` = `Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:2})`; `fmtDate` = `toLocaleDateString()` or `'—'`.
- **External imports:** lucide icons (`Boxes, TrendingUp, DollarSign, ClipboardList, AlertTriangle, Loader2, RefreshCw, FileText, Calendar`), `PO_STATUS_META` from `lib/admin/po-status` for status badge classes/labels, `Link` for deep links.

---

## UI/UX specification

**Page header (flex row, stacks on mobile):**
- Title: `Analytics` (h1, `text-xl sm:text-2xl font-bold`) with a vital `TrendingUp` icon.
- Subtitle: "Stock value, incoming purchase orders, and revenue at a glance."
- Right side controls: two `DateField`s labeled **From** and **To** (each a white bordered pill with a `Calendar` icon, an uppercase micro-label, and a native `<input type="date">`). When either date is set, a **Clear** text button appears (resets both). A **Refresh** button (white, bordered, `RefreshCw` icon that spins while `refreshing`, disabled while refreshing).

**Top KPI cards** — `grid grid-cols-2 lg:grid-cols-4 gap-3`. Each `KpiCard` = white rounded card, uppercase micro-label top-left, a tinted rounded icon top-right, large `tabular-nums` value, and a small sub-line. The four cards:
1. **Inventory On Hand** — value `fmtCurrency(inventory.value)`, sub `"{units} units · {sku_count} SKUs"`, icon `Boxes`, tint **emerald**.
2. **Incoming (Open POs)** — value `fmtCurrency(incoming.value)`, sub `"{units} units · {po_count} POs"`, icon `ClipboardList`, tint **blue**.
3. **Revenue Paid** — value `fmtCurrency(revenue.paid)`, sub `"{paid_invoice_count} paid invoice(s)"` (pluralized), icon `DollarSign`, tint **vital**.
4. **Outstanding** — value `fmtCurrency(revenue.outstanding)`, sub `"{unpaidInvoiceCount} invoice(s) unpaid"`, icon `TrendingUp`, tint **amber** when `outstanding > 0` else **neutral**.

**Tint palette** (`TINTS`): emerald `text-emerald-700 / bg-emerald-100`; blue `text-blue-700 / bg-blue-100`; vital `text-vital / bg-vital/10`; amber `text-amber-700 / bg-amber-100`; neutral `text-ink / bg-surface`.

**Detail cards** — `grid lg:grid-cols-3 gap-6`. Each `DetailCard` = white card with tinted icon + title header, a body of label/value rows, and a footer link. Rows can carry an accent (`emerald`/`amber`) color and an optional row icon.
1. **Inventory Snapshot** (emerald, `Boxes`): rows "Total units", "Total value", "SKUs tracked", "Low stock SKUs" (shows `AlertTriangle` + amber accent when `low_stock_count > 0`). Footer link → `/admin/products` "View inventory →".
2. **Revenue** (vital, `DollarSign`): rows "Invoiced", "Paid" (emerald accent), "Outstanding" (amber accent when outstanding), "Paid / total" = `"{paid_invoice_count} / {invoice_count}"`. Footer link → `/admin/invoices` "View invoices →".
3. **Incoming Stock** (blue, `ClipboardList`): rows "Open POs", "Incoming units", "Incoming value". Footer link → `/admin/purchase-orders` "View POs →".

**Open Purchase Orders table** — white rounded card. Header row: `ClipboardList` icon + "Open Purchase Orders".
- **Empty state:** "No open purchase orders. Inventory replenishment is up to date." (centered, muted).
- **Table** (`min-w-[640px]`, horizontal scroll on small screens): columns **PO #**, **Supplier**, **Status**, **Expected**, **Total** (Total right-aligned). Rows: PO # is a monospace `Link` to `/admin/purchase-orders/{id}` with a `FileText` icon; Supplier or `—`; Status renders a badge using `PO_STATUS_META[status].badge`/`.label`; Expected via `fmtDate`; Total right-aligned `fmtCurrency`, bold tabular-nums. Row hover `bg-surface`.

**Global states:**
- **Loading:** centered `"Loading analytics…"` with a spinning `Loader2`.
- **Error / null summary:** centered "Could not load analytics." + a vital **"Try again"** button (`RefreshCw` icon) that re-runs `load`.

**Responsive:** header controls wrap; KPI grid is 2-up on mobile, 4-up on large; detail cards stack then go 3-up; the PO table scrolls horizontally with a min width.

---

## Dependencies

- **npm:** `@supabase/supabase-js` (service-role client server-side; session client-side), `lucide-react` (icons), `next` (App Router, `Link`). No chart library, no date library (native `Date`/`Intl`).
- **Env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client session).
- **Other modules / files relied on:**
  - `lib/admin/po-status` → `PO_STATUS_META` (badge classes + labels) and the `PurchaseOrderStatus` type.
  - Purchase Orders module (`purchase_orders`, `purchase_order_items`, `suppliers`).
  - Invoices module (`invoices`, `payments`, statuses).
  - Products module (`products.active/price/stock_quantity`).
  - `lib/supabase` (`AnalyticsSummary` type, client).

---

## Porting notes

- **Skip `app/api/admin/affiliate-performance/route.ts` entirely** (affiliate). The dashboard never calls it; it's a standalone endpoint. (For reference: `GET`, admin/assistant only, returns `{ performance: Record<affiliateId, {bound_customers, customer_revenue}> }` built from `customers.affiliate_id` and non-cancelled `orders.total`.) Do not port.
- **Pure-derived module:** no migration needed. It only works once Products, Purchase Orders, and Invoices/Payments tables exist with the same column names — port those first.
- **Status string coupling:** the constants `OPEN_PO_STATUSES` and `REVENUE_INVOICE_STATUSES` must match the host site's actual PO/invoice status enums. Verify before porting.
- **Currency/locale hard-coded** to CAD / `en-CA`. Change `fmtCurrency` and the `currency` field if the target site uses another currency.
- **Low-stock threshold** is the literal `5` here (independent of any per-product threshold elsewhere). Adjust if needed.
- **Auth pattern** mirrors every other admin API in the app: Bearer token → `getUser` → `customers.role`. Reuse the shared helper if one exists on the target.
- **Order of implementation:** (1) ensure dependency tables/statuses exist; (2) port `PO_STATUS_META`; (3) port the `AnalyticsSummary` type; (4) port the summary route; (5) port `lib/admin/analytics.ts`; (6) port the page.
