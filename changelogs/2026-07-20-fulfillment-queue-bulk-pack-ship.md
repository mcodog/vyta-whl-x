# Fulfillment queue — bulk Pack & Ship actions

**Date:** 2026-07-20
**Area:** Warehouse fulfillment queue

## Summary

Extended the fulfillment queue's bulk actions beyond remove/restore so the
warehouse team can advance many orders at once. Ticking a set of active orders
now exposes **Pack** and **Ship** alongside **Remove from queue**, and the whole
bulk-action panel was reworked for clearer spacing.

## Bulk Pack & Ship

- **Pack** marks every selected order as *Packed* — which decrements stock
  server-side exactly as the per-order flow does.
- **Ship** advances every selected order to its terminal step. Each order is
  routed to the correct status for how it fulfils: shipments become **Shipped**
  and self-pickups become **Picked up**, so the API never rejects a mismatched
  pairing.
- A still-pending order is **packed first** on the Ship path, so the stock
  decrement — which only fires on the pack transition — is never skipped.
- Actions run optimistically: packed orders stay in the active queue while
  shipped / picked-up orders drop straight into the archive, reconciled by a
  refetch. Partial failures surface a message and the queue reloads.

## Interface

- The bulk-action panel now leads with a **N selected** header, places **Pack**
  and **Ship** side by side as the primary flow actions, and sets the
  destructive **Remove from queue** apart on its own full-width row.
- Each button shows its own inline spinner while its action runs, and a
  running action locks the others out.
- **Clear** moved up next to **Select all** for a tidier, roomier layout.
