# Fulfillment Queue — Packing Decrements Stock

Date: 2026-07-14

Until now, a product's `stock_quantity` only came down when its invoice was
marked **paid** (or the linked crypto order was confirmed). An invoice that
reached the warehouse queue unpaid — e.g. an admin promoted a draft so it could
be prepped — could be packed and shipped without its stock ever being deducted.

The fulfillment queue now decrements stock the first time an invoice is marked
**packed**, so the physical act of packing is guaranteed to reflect in
inventory regardless of the invoice's payment state.

## Behaviour

- Advancing an invoice to `packed` for the first time calls the existing
  `adjust_stock_for_invoice` RPC and re-runs the low-stock alert check for the
  affected products — the same operations the payment routes already perform.
- The decrement is driven by the same `stock_adjusted` flag, so it is
  idempotent: if the invoice was already paid (and thus already took stock),
  packing is a no-op; if it was packed before it was paid, packing is where the
  stock comes off and a later payment is the no-op.
- Cancelling the invoice restores the stock via `restore_stock_for_invoice()`,
  exactly as it already did for the paid-time decrement — no separate undo is
  needed for the packing path.

## Files

- `app/api/warehouse/queue/[id]/route.ts` — on the first transition to
  `packed`, call `adjust_stock_for_invoice` + `checkLowStockForProducts`.
