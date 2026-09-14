# Fulfillment queue — Clear from queue with a note

**Date:** 2026-08-10
**Area:** Warehouse fulfillment queue

## Summary

Added a **Clear from queue** action next to **Mark Packed** (and the other
advance buttons) in the order detail pane. Instead of packing/shipping an order,
staff can clear it out of the active queue after recording a short reason. The
order then moves to the **Fulfilled / Removed** view, where the note is shown so
anyone can see why it was cleared and by whom.

## Clear from queue

- A red **Clear from queue** button sits beside the primary advance button on
  any order that still needs work (not a draft, not already complete).
- Clicking it reveals a required note field. **Confirm & clear** stays disabled
  until a reason is entered; **Cancel** dismisses the form.
- Confirming removes the order from the active queue (same `removed_from_queue`
  flag as the existing header **Remove from queue**) and stores the reason.
- The action is audited via `invoice.queue_remove`, with the note included in
  the audit payload.

## Showing the note

- In the **Fulfilled / Removed** view, a cleared order's detail pane shows a
  panel with the reason, plus who cleared it and when.
- Restoring an order to the queue clears the stored note, so a later clear
  starts fresh.

## Data

- New `invoices.removed_note` column
  (`fulfillment-queue-clear-note-migration.sql`, idempotent).
- The warehouse queue API now returns `removed_note` and `removed_by_name`
  alongside the existing `removed_from_queue` / `removed_at` fields.
