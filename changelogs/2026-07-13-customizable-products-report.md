# Customizable Products Report

Date: 2026-07-13

The **Download Report** on Products management is now customizable. Admins and
assistants can choose which summary cards and table columns appear in the
generated report, so it can be trimmed down to just what's needed (for example,
hiding the revenue card or dropping the Category / Units Sold columns).

## What changed

- **Customize control** — the "Download Report" button in the Products header is
  now a split control: the main button still downloads immediately, and a new
  sliders icon beside it opens a **Customize Report** modal.
- **Customize Report modal** — pick what the report includes:
  - **Summary cards** — toggle any of the four tiles: **Products**,
    **Stock On Hand**, **Low / Out of Stock**, and **Revenue (All Time)**.
  - **Table columns** — toggle any of the nine columns: **Product**, **SKU**,
    **Category**, **Price**, **Stock**, **Stock Value**, **Units Sold**,
    **Revenue**, and **Status**.
  - **All / None** shortcuts per section, plus **Reset to defaults**.
  - Cards render in their canonical order regardless of toggle order; likewise
    for columns.
- **Remembered selection** — choices are persisted to the browser
  (`localStorage`), so the next report uses the same layout. The plain
  "Download Report" button honours the saved selection too.
- **Report route** — `/api/admin/products/report` accepts optional `cards` and
  `cols` query params (comma-separated keys). When absent, the report shows
  everything (unchanged behaviour). If every column is deselected the route
  falls back to the full column set so the table is never empty; deselecting
  every card simply omits the summary grid.
