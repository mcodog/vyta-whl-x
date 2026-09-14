# Admin Orders — Bulk Shipping Actions, Row Loading & Day Select

Date: 2026-07-07

The **Orders** table's bulk toolbar now does more than delete. Admins can create
Easyship shipment records and buy shipping labels for many orders at once, with
guardrails before either runs, per-row progress while they run, and a faster way
to select a whole day of orders.

## What changed

- **Bulk "Create shipments"** — creates an Easyship shipment record for every
  selected order that passes the label-readiness checklist. Before anything is
  created, a confirmation dialog runs a pre-flight over the selection and lists
  the orders that will be **skipped and why** (already has a shipment, local
  pickup, or missing fields like recipient phone / address). You can continue
  (only the eligible orders are created) or cancel.
- **Bulk "Buy labels"** — buys the Easyship label for every selected order that
  already has a shipment but no generated label yet. A confirmation dialog warns
  to **make sure the Easyship wallet is funded**, since buying charges the wallet
  and can't be undone. The button shows the eligible count and is disabled when
  none of the selection qualifies.
- **Per-row loading** — while a bulk action runs, each affected order's
  **Shipping** column shows a spinner with what's happening ("Creating
  shipment…" / "Buying label…"), processed a few at a time so progress is
  visible without firing every request at once.
- **Select by day** — each day divider now has a checkbox; clicking it (or the
  divider) selects/deselects all of that day's visible orders in one go, with an
  indeterminate state when only some are selected.

## Implementation

- New `lib/shipping/labelReadiness.ts` — `evaluateLabelReadiness(order, config)`
  centralises the Easyship readiness checklist (settings / destination / parcel).
  The single-order `label-readiness` route now uses it instead of an inline copy,
  so the single-order panel and the bulk pre-flight stay in lock-step.
- New `POST /api/admin/orders/bulk-shipment-readiness` — evaluates a batch of
  order ids against the checklist (loading the shipping config once, not per
  order) and returns per-order `{ eligible, reason }`. Client wrapper
  `getBulkShipmentReadiness` in `lib/admin/api.ts`.
- Bulk create/buy are orchestrated client-side over the existing per-order
  `createOrderShipment` / `buyOrderLabel` endpoints via a small concurrency pool,
  which drives the per-row spinners and a completion summary banner.
- New reusable `components/admin/ConfirmActionDialog.tsx` — a neutral/amber
  (non-destructive) confirmation modal used by both new flows.
- `components/admin/DayDivider.tsx` gains optional selection props (checkbox +
  indeterminate state); the Invoices and Dashboard tables are unaffected since
  the props are opt-in.

## Files

- `lib/shipping/labelReadiness.ts` (new)
- `app/api/admin/orders/bulk-shipment-readiness/route.ts` (new)
- `components/admin/ConfirmActionDialog.tsx` (new)
- `app/api/admin/orders/[id]/label-readiness/route.ts`
- `lib/admin/api.ts`
- `components/admin/DayDivider.tsx`
- `app/(admin)/admin/orders/page.tsx`
