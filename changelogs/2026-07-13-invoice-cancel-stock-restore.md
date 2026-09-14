# Invoices — Cancel Restores Stock

Date: 2026-07-13

Marking an invoice **paid** decrements the sold products' stock (recorded in
each product's change history as *Invoice sale*). Until now there was no way to
give that stock back — cancelling an invoice left the sold quantities
permanently out of inventory.

Invoices now have a **Cancelled** status. Cancelling an invoice that previously
took stock adds those quantities back onto the products and records the reversal
in the product change history.

- The invoice status selector (detail page and list filter) now includes
  **Cancelled**.
- When an invoice that had reduced stock is set to *Cancelled*, each affected
  product's `stock_quantity` is incremented back by its invoiced quantity.
- Every restored product gets a **stock** history row (old → new value) tagged
  *Invoice cancelled*, so the admin Products > History view explains why the
  stock came back.
- The status editor warns that cancelling will restore stock, and the success
  banner confirms it — mirroring the existing "marking paid reduces stock" flow.
- The linked order is no longer bumped forward to *processing* when its invoice
  is cancelled.

## Behaviour

The restore is the exact inverse of the paid-time decrement and is driven by the
same `stock_adjusted` flag, so it is idempotent: it runs at most once per
cancellation, is a no-op for an invoice that never took stock (e.g. cancelling a
draft), and clears the flag so a cancelled invoice re-marked *paid* decrements
again cleanly.

## Data model

- `invoices.status` CHECK now allows `cancelled`.
- `product_change_history.change_source` CHECK now allows `invoice_cancel`.
- New `restore_stock_for_invoice(uuid)` function — the inverse of
  `adjust_stock_for_invoice`; increments stock and appends an `invoice_cancel`
  history row per product, atomically with the update.

## Files

- `invoice-cancel-stock-restore-migration.sql` — status + change_source CHECKs,
  `restore_stock_for_invoice()`.
- `app/api/admin/invoices/[id]/route.ts` — call the restore RPC when an invoice
  transitions to `cancelled`.
- `lib/supabase.ts`, `lib/admin/invoice-status.ts` — add the `cancelled` status
  and its badge/label metadata.
- `lib/admin/order-sync.ts` — don't remap a linked order forward when the
  invoice is cancelled.
- `app/(admin)/admin/invoices/[id]/page.tsx` — cancel-restores-stock hint and
  success message.
- `app/(admin)/admin/products/page.tsx` — *Invoice cancelled* history label.
