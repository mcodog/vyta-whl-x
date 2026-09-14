# Fulfillment queue — To Ship tab, expired toggle & wider layout

**Date:** 2026-07-21
**Area:** Warehouse fulfillment queue

## Summary

Reworked the fulfillment queue so packed orders get their own step, aged
"straggler" cards can be tucked away, and the whole board uses more of the
screen. Added a matching admin setting and a direct link into the queue from
the admin nav.

## To Ship tab

- The queue tabs went from two (**To Fulfill** / **Fulfilled / Removed**) to
  three: **To Fulfill → To Ship → Fulfilled / Removed**.
- A card moves into **To Ship** automatically the moment it is marked *Packed*
  (whether from the detail pane or the bulk **Pack** action), and leaves it once
  it ships / is picked up (into the archive).
- Bulk actions follow the tab: **To Fulfill** keeps Pack + Ship + Remove;
  **To Ship** shows Ship + Remove (the cards are already packed); the archive
  keeps Restore.
- The summary cards now read **To fulfill**, **To ship**, **Completed**, and
  **Expired hidden**.

## Show expired toggle

- Cards at least *N* days old are treated as **expired** (aged) and hidden by
  default, keeping the board focused on fresh work. A **Show expired** toggle in
  the queue reveals them, with a badge counting how many are currently hidden.
- "Expired" here just segregates old ones — often a queue entry created well
  after its invoice — rather than marking a hard status.
- The threshold is configurable in **Admin → Settings → Fulfillment Queue**
  (`fulfillment_expired_days`, default **3**). The queue reads it from the API.

## Layout & navigation

- The warehouse layout's left/right margins were reduced and its max width
  widened so the queue and detail panes have more room.
- The admin nav gained a **Fulfillment Queue** link (under Orders &
  Fulfillment) that jumps straight to the live warehouse floor view. It is
  admin-only, since assistants/affiliates can't access `/warehouse`.

## Migration

- `fulfillment-expired-queue-days-migration.sql` adds
  `site_settings.fulfillment_expired_days` (integer, default 3).
