# Products Stock Report & Purchase Order Deletion

Date: 2026-07-10

Products management gains a **Stock Report** — a quantities-only view of the
catalogue with no prices or money — and the "Alert at" column is renamed to
**Min Quantity** to match. Purchase Orders can now be deleted, individually or
in bulk.

## What changed

- **Column rename** — the products table's **Alert at** column is now labelled
  **Min Quantity** (it still edits the same low-stock threshold field).
- **Stock Report** — a new report button next to "Download Report" opens a
  printable, price-free report focused on inventory. For each product it shows:
  - **Stock** — current on-hand quantity.
  - **Min Quantity** — the low-stock threshold.
  - **On Order** — the outstanding units still expected from open purchase
    orders. The report scans purchase-order line items and sums the not-yet-
    received quantity (`qty − qty_received`) across POs that are **pending** or
    **partially fulfilled**; fully received, paid, and cancelled POs don't
    contribute.
  - **Need To Order** — how much to buy to reach the minimum, computed as
    `Min Quantity − (Stock + On Order)`, floored at **0** so it never goes
    negative.
  - Summary tiles show totals for products, stock on hand, on order, and need
    to order — all in units, no dollar values.
- **Delete purchase orders** — the Purchase Orders table now supports:
  - a per-row **Delete** action (trash icon),
  - **bulk select** via row + header checkboxes, and
  - a **Delete selected** action in a bulk toolbar.
  Both flows go through a confirmation dialog. Deletion is admin-only.

## Implementation

- New `GET /api/admin/products/stock-report` — service-role report route built
  on the shared `lib/admin/report-html` helpers (reuses the products report's
  filter handling but drops every money column). On-order is computed from
  `purchase_order_items` joined to their parent `purchase_orders` status.
- New `DELETE /api/admin/purchase-orders/:id` — admin-only; removes the PO, with
  line items and receipt records cascading via existing foreign keys. (It does
  not reverse inventory already applied from receiving.)
- `deletePurchaseOrder(id)` client helper added to `lib/admin/purchase-orders.ts`.
- The Purchase Orders page gains selection state, a bulk toolbar, per-row delete,
  and a shared confirmation modal; delete UI is gated on the `canDelete`
  permission.
- The products page's report download logic is refactored into a small
  `openReport(path, setBusy)` helper shared by both report buttons.

## Files

- `app/api/admin/products/stock-report/route.ts` (new)
- `app/(admin)/admin/products/page.tsx`
- `app/(admin)/admin/purchase-orders/page.tsx`
- `app/api/admin/purchase-orders/[id]/route.ts`
- `lib/admin/purchase-orders.ts`
