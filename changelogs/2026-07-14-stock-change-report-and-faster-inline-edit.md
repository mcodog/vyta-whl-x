# Stock Change Report & Faster Inline Product Editing

Date: 2026-07-14

Products management gains a **Stock Change Report** — a date-range view of how
inventory *moved* (sold, received, adjusted) rather than a point-in-time
snapshot — defaulting to the current week. Separately, **inline editing** on the
products table is now effectively instant: edits apply optimistically and the
save happens in the background.

## What changed

- **Stock Change Report** — a new **Stock Changes** button (next to "Stock
  Report") opens a date-range picker (defaulting to this week, Monday–Sunday,
  with This week / Last 7 days / Last 30 days / This month presets) and
  generates a printable report. For each product that changed in the window it
  shows:
  - **Opening** — stock right before the first change in the range.
  - **Sold** — units removed by orders and paid invoices.
  - **Received** — units added by purchase-order receipts.
  - **Adjusted** — net of manual edits, imports, reverts, and invoice
    cancellations (signed).
  - **Net** — `Closing − Opening`.
  - **Closing** — stock after the last change in the range.
  - Summary tiles total products changed, units sold, units received, and net
    change. Products with no change in the window are omitted.
- **Faster inline editing** — editing a price, stock, vials-per-box, or
  min-quantity cell now updates the table immediately instead of waiting on the
  server round-trip. If the background save fails, the cell rolls back to its
  previous value and an error toast is shown. Target: the edit feels resolved in
  well under a second.

## Implementation

- New `lib/admin/stock-change-report.ts` — computes per-product movement from
  the append-only `product_change_history` ledger (`field = 'stock_quantity'`)
  within `[from, to]`, classifying each change by `change_source` into
  sold (`order`/`invoice`), received (`restock`), or adjusted (everything else).
  Opening/closing derive from the first/last ledger rows in the window, so they
  are exact. Also exports `currentWeekRange()` / `toDateInput()` helpers reused
  by the page. Print HTML is built on the shared `lib/admin/report-html`
  helpers, consistent with the existing Stock Report.
- New `GET /api/admin/products/stock-change-report` — service-role report route
  (admin/assistant), accepts `from`, `to`, `q`, `category`; defaults to the
  current week when the range is omitted.
- **Optimistic inline save** — `commitInlineSave` on the products page now
  applies the new value to local state up-front, sends the PUT in the
  background, and rolls back on failure; the editor closes immediately so the
  new value shows at once. The now-redundant per-cell "saving" spinners were
  removed.
- **Parallel server side-effects** — the product PUT route previously ran its
  post-update work (history, waitlist email, low-stock re-check, audit log)
  sequentially. These are independent, so they now run concurrently via
  `Promise.all` (each still awaited and error-wrapped), cutting the request's
  latency without risking dropped work on serverless.

## Files

- `lib/admin/stock-change-report.ts` (new)
- `app/api/admin/products/stock-change-report/route.ts` (new)
- `app/(admin)/admin/products/page.tsx`
- `app/api/admin/products/[id]/route.ts`
