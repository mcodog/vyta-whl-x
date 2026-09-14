# Fulfillment queue — box/vial info per line item

Date: 2026-07-13

The warehouse fulfillment queue now shows whether each line item was sold by
the **box** or the **single vial**, so a packer can tell at a glance that a box
line's "×2" means 2 boxes — not 2 vials — and know exactly how many vials to
pick.

## What changed

- Each item in the "Items to pack" list now carries a unit badge next to
  **Ordered ×N**:
  - **Box** lines show `Box · {vials_per_box}/box · {total} vials`, where the
    total is `qty × vials_per_box` — the real vial count the packer must pull.
  - **Vial** lines show a simple **Vial** badge.
- The badge sits alongside the existing Fulfilled / Backordered badges, so the
  per-line picture (ordered as, how many vials, what's done) reads in one row.

## Implementation

- `GET /api/warehouse/queue` now selects the line item's `price_type` and the
  product's `vials_per_box`, exposing them on each `line_items` entry.
- `QueueLineItem` (`lib/warehouse/api.ts`) gains `price_type` (`box | vial`)
  and `vials_per_box` (defaults to 10).
- `QueueDetail` renders the box/vial badge from those fields.

No migration — `invoice_line_items.price_type` and `products.vials_per_box`
already exist.

## Files

- `app/api/warehouse/queue/route.ts`
- `lib/warehouse/api.ts`
- `app/(warehouse)/warehouse/_components/QueueDetail.tsx`
