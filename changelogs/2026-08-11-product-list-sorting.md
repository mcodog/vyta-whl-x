# Products list — sortable ordering (alphabetical by default)

**Date:** 2026-08-11
**Area:** Admin › Products management

## Summary

The admin **Products** table now defaults to **alphabetical order by name**,
matching the downloadable Stock Report (which the database serves via
`.order('name')`). Previously the table showed products newest-first (the API's
`created_at DESC` order), so a product could sit anywhere in the list.

A new **Sort** control in the toolbar lets staff re-order the list on demand,
and the choice is remembered per browser.

## Sort control

- A **Sort** dropdown sits in the toolbar between the CAD/USD toggle and the
  **Columns** menu, mirroring the existing menu styling.
- The button shows the active sort at a glance (e.g. "Sort · Name A–Z"), so the
  current ordering is always visible without opening the menu.
- Options, grouped by field:
  - **Name: A → Z** (default) / **Name: Z → A**
  - **Price: Low → High** / **Price: High → Low**
  - **Stock: Low → High** / **Stock: High → Low**
  - **Recently added** (the old default) / **Oldest first**
- The selected option is check-marked and highlighted in the menu.

## Behaviour details

- **Alphabetical is case-insensitive and natural** — `localeCompare` with
  `numeric` collation, so names with numbers (e.g. "B12", "BPC-157") order
  sensibly. Every sort falls back to Name A→Z on a tie, so the order is stable.
- **Price sorts follow the displayed currency** — toggling CAD/USD re-orders a
  price sort to match the prices on screen (USD uses the product's `price_usd`
  override, or the CAD price × the site FX rate).
- **Sorting composes with search** — search narrows the list, the chosen sort
  orders what remains.
- Changing the sort (or the search) returns to page 1 so the top of the newly
  ordered list is shown.
- The choice is persisted to `localStorage` (`aminocan.productTable.sort`),
  alongside the existing column-visibility preference.

## Data

- No schema or API changes — sorting is applied client-side over the products
  already loaded into the table.

## Files

- `app/(admin)/admin/products/page.tsx` — `SortKey` / `SORT_OPTIONS` config, the
  `sortProducts` helper, sort state + `localStorage` persistence, the
  `sortedProducts` memo driving pagination, and the toolbar **Sort** dropdown.
