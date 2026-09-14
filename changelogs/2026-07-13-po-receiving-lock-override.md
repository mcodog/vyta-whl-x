# Purchase Orders — override the receiving lock to edit line items

**Date:** 2026-07-13
**Area:** Admin (Purchase Orders — edit form + PATCH API)
**Migrations:** none

## Summary

Once any quantity has been received against a purchase order, its supplier and
line items are frozen so the received history stays consistent. Admins can now
**override that lock** — behind a warning dialog — to edit the supplier and line
items anyway, **without losing received-quantity history**.

- The blue "Receiving has started…" banner gains an **Override & edit** button.
  It opens a confirmation dialog spelling out the consequences, then unlocks the
  supplier and line-item cards. An amber "editing unlocked" banner with a
  **Re-lock** button replaces it while the override is active.
- **Received history is preserved.** Instead of the usual delete-and-reinsert of
  line items (which would cascade-delete `purchase_order_receipt_items` and reset
  `qty_received`), an overridden save **reconciles in place**: existing rows are
  updated by id, new lines inserted, and only receipt-free rows deleted.
- **Guardrails** (enforced on both the client and the server):
  - a line that already has receipts can't be removed;
  - a line's quantity can't drop below what's already been received.
  Received lines show a green **received N** badge and floor their Qty input.
- Price/product edits **don't** retroactively adjust stock already added to
  inventory — the dialog says so.
- The paid/cancelled lock is unaffected: it stays a hard lock (only status can
  change), and the override option never appears for those POs.

## Implementation notes

- **API** (`app/api/admin/purchase-orders/[id]/route.ts`): the PATCH handler now
  accepts `override_receiving_lock: true`. When set (and receipts exist) it takes
  the in-place reconciliation path instead of rejecting the edit; line items may
  carry an existing `id` so rows can be matched and updated rather than replaced.
  The server re-checks both guardrails and returns a 400 with a clear message if
  violated.
- **Form** (`app/(admin)/admin/purchase-orders/PurchaseOrderForm.tsx`): `DraftItem`
  now carries `id` and `qty_received`; the receiving banner sits outside the
  disabled card wrapper so its controls stay clickable; `itemsLocked` relaxes to
  `locked || (receivingStarted && !overrideLock)`; submit sends item ids + the
  override flag and validates the guardrails before posting.
- **Types** (`lib/admin/purchase-orders.ts`): `PurchaseOrderPatch.items` accepts an
  optional per-line `id`, plus the new `override_receiving_lock` flag.

## Files

- `app/(admin)/admin/purchase-orders/PurchaseOrderForm.tsx`
- `app/(admin)/admin/purchase-orders/new/page.tsx` (DraftItem parity)
- `app/api/admin/purchase-orders/[id]/route.ts`
- `lib/admin/purchase-orders.ts`
