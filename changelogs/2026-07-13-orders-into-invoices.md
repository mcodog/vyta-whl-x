# Orders Folded Into Invoices — Hidden Nav + Bulk Shipping on Invoices

Date: 2026-07-13

The admin **Orders** page is no longer its own nav destination. Because every
invoice is already bound 1:1 to an order, the order-side fulfillment tooling now
lives on the **Invoices** page, so there's a single place to work a sale from
issue to shipment.

## What changed

- **Orders hidden from the admin nav** — the "Orders" button is removed from the
  admin navigation. The `/admin/orders` routes still work by direct link (for
  existing deep links and per-order detail pages); they're just no longer
  surfaced in the nav.
- **Bulk "Create shipments" on Invoices** — select invoices and create an
  Easyship shipment record for each one's linked order. A pre-flight confirmation
  lists the invoices that will be **skipped and why** (already has a shipment,
  local pickup, or missing label fields), exactly like the old Orders flow.
- **Bulk "Buy labels" on Invoices** — buys the Easyship label for every selected
  invoice whose order has a shipment but no generated label yet, with the same
  "confirm your Easyship wallet is funded" warning and eligible count.
- **Shipping column + per-row progress** — the Invoices table gains a Shipping
  column showing each invoice's shipment state (Pickup / No shipment / Shipment +
  tracking), and shows a per-row spinner ("Creating shipment…" / "Buying
  label…") while a bulk action runs.

## Invoice ↔ order binding (unchanged, both ways)

Creating an invoice still creates and binds a matching order
(`createOrderForInvoice` in the invoices POST route), and creating an order still
auto-creates its invoice (`autoCreateInvoiceFromOrder`, called from checkout, the
email-order flow, and the order→invoice endpoint). Deleting either side still
removes its bound counterpart. These flows are untouched; the bulk actions above
simply drive each invoice's already-bound order.

## Implementation

- `GET /api/admin/invoices` now embeds the linked order and flattens its shipping
  fields onto each row as `order_shipment`
  (`easyship_shipment_id`, `label_state`, `tracking_number`, `fulfillment_type`,
  `notes`, `order_number`), so the Invoices page can compute shipping state and
  label eligibility without a second fetch.
- Bulk create/buy are orchestrated client-side over the existing per-order
  `createOrderShipment` / `getBulkShipmentReadiness` / `buyOrderLabel` endpoints,
  mapping each selected invoice to its bound order id. The shared concurrency
  helper `runPool` was extracted to `lib/concurrency.ts` and is now reused by
  both the Orders and Invoices pages.
- Reuses the existing `ConfirmActionDialog` for both confirmation modals.

## Files

- `lib/concurrency.ts` (new)
- `app/(admin)/admin/layout.tsx`
- `app/api/admin/invoices/route.ts`
- `lib/admin/invoices.ts`
- `app/(admin)/admin/invoices/page.tsx`
- `app/(admin)/admin/orders/page.tsx`
