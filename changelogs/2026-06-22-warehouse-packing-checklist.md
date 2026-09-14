# Warehouse Packing — Checklist, Per-line Fulfillment/Backorder, Packed Photos

Date: 2026-06-22

Enhancements to the warehouse fulfillment dashboard (`/warehouse`) so packers
work from a checklist, can split a line between fulfilled and backordered
quantities, and attach a photo of the packed parcel.

## 1. Handling checklist

- The "Shipment handling" / "Pickup handling" steps are now interactive
  checkboxes. Warehouse staff can tick off any step independently; a checked
  step is greyed out + struck through, and the state is persisted per invoice.
- Stored in `invoices.handling_checklist` (jsonb array of step keys).
- Saved via `PATCH /api/warehouse/queue/:id/checklist`.

## 2. Per-line Fulfilled / Backorder

- Each item under "Items to pack" gets a quantity input plus two buttons:
  - **Fulfilled** — marks a quantity as packed/fulfilled (records
    `invoice_line_items.qty_fulfilled`). When the whole line is handled it
    greys out.
  - **Backorder** — moves a quantity onto a single **non-payable backorder
    invoice** bound to the original invoice via `parent_invoice_id`. The first
    backorder creates the invoice; every later backorder from the same order
    funnels into that same invoice (no new invoice is ever created). Records
    `invoice_line_items.qty_backordered`.
- A specific quantity can be marked for either action via the per-line Qty
  input (defaults to the remaining quantity).
- Backorder invoices are `is_backorder = true`, `non_payable = true`, and stay
  in `draft` (kept out of the warehouse queue) and also surface a `backorders`
  row for the Backorders tab.
- Handled via `POST /api/warehouse/queue/:id/line` with
  `{ action: 'fulfill' | 'backorder', line_item_id, qty }`.

## 3. Photo of the packed products

- New "Photo of packed products" step with two buttons:
  - **Take photo** — opens the device camera on iPad/phones
    (`<input type="file" accept="image/*" capture="environment">`).
  - **Upload image** — standard file picker (multi-select).
- Thumbnails render in a grid with a remove control. Stored in
  `invoices.packed_photos` (jsonb array of `{ url, path, uploaded_at }`).
- Files upload to the public `products` bucket under `packing/<invoice_id>/`
  via `POST /api/warehouse/queue/:id/photo` (service role). Override the bucket
  with `WAREHOUSE_PHOTOS_BUCKET`.

## Migration

Run `warehouse-packing-checklist-migration.sql`:

- `invoices`: `handling_checklist jsonb`, `packed_photos jsonb`,
  `non_payable boolean`.
- `invoice_line_items`: `qty_fulfilled integer`, `qty_backordered integer`.

## Files

- Created: `warehouse-packing-checklist-migration.sql`,
  `app/api/warehouse/queue/[id]/checklist/route.ts`,
  `app/api/warehouse/queue/[id]/line/route.ts`,
  `app/api/warehouse/queue/[id]/photo/route.ts`.
- Modified: `app/(warehouse)/warehouse/_components/QueueDetail.tsx`,
  `app/(warehouse)/warehouse/page.tsx`,
  `app/api/warehouse/queue/route.ts`, `lib/warehouse/api.ts`,
  `lib/supabase.ts`.
