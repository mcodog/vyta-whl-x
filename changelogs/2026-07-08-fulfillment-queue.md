# Fulfillment queue — views, drafts, remove/restore, search & invoice download

**Date:** 2026-07-08
**Area:** Warehouse fulfillment queue
**PRs:** [#136](https://github.com/thepuragroup-droid/aminocan-whl/pull/136), [#137](https://github.com/thepuragroup-droid/aminocan-whl/pull/137)
**Migration:** `aminocan/fulfillment-queue-remove-migration.sql`

## Summary

Reworked the warehouse fulfillment queue into a searchable, day-grouped
workflow with separate active and archived views, draft-invoice handling,
remove/restore, and one-click invoice download — so the team can find, work,
and clear orders without the queue turning into a wall of dimmed rows.

## To Fulfill vs. Fulfilled / Removed

- The queue is split into two views with live counts: **To Fulfill** (active)
  and **Fulfilled / Removed** (archive).
- Fulfilling an order now **moves it out of the active view** instead of
  lingering, dimmed, in the same list.

## Remove / restore from the queue

- A **Remove from queue** button on the order detail (with a **Restore to
  queue** action in the archive) lets cancelled or on-hold orders be taken out
  of the active queue.
- Backed by a new `removed_from_queue` flag; removed orders are excluded from
  the "to fulfil" counts and show a **Removed** badge.

## Draft invoices can be fulfilled

- Draft invoices are now **shown in the queue** (previously hidden) with a
  **Draft** badge on the row and detail header; drafts stay out of the
  "to fulfil" summary counts.
- Instead of a hard "Draft invoices cannot be fulfilled" error, the detail
  shows a **warning** with a **Mark invoice as ready** action that promotes the
  draft (`draft` → `sent`) so it can be packed and shipped.

## Search, day grouping & pagination

- The queue is **searchable by customer name** (also matches email, invoice #
  and order #).
- Orders are **grouped and divided by day** (newest day first) with a per-day
  count and **paginated** (12 per page); within a day, active orders sort before
  completed.

## Download / View invoice

- A **Download Invoice** button at the top of the order detail opens the exact
  same invoice document as **Admin → Invoices**, reusing the invoice PDF route
  (allowed for warehouse and admin roles).

## Migration (run before deploying)

`fulfillment-queue-remove-migration.sql` adds `removed_from_queue`,
`removed_at`, and `removed_by` to the orders/queue backing table. Idempotent.

## Files

- `app/(warehouse)/warehouse/page.tsx`
- `app/(warehouse)/warehouse/_components/QueueRow.tsx`,
  `_components/QueueDetail.tsx`
- `app/api/warehouse/queue/route.ts`, `app/api/warehouse/queue/[id]/route.ts`
- `lib/warehouse/api.ts`
- `fulfillment-queue-remove-migration.sql`
