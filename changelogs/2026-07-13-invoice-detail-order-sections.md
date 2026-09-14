# Invoice Detail — Order Sections, Status Sync & Live Tracking

Date: 2026-07-13

The single-invoice view now mirrors the order detail page's fulfillment
sections, so an admin can work the whole order from the invoice without opening
the (now-hidden) order page. Every section degrades gracefully for legacy
invoices that have no linked order.

## What changed

- **Linked order + status** — a card shows the bound order's number (linking to
  the order page) and its current status. Order status stays in sync with the
  invoice via the existing `syncOrderFromInvoice` (forward-only — it never
  regresses a shipped/delivered order); the detail page surfaces the result.
- **Shipping address** — the linked order's destination, with a "Local pickup"
  state for pickup invoices and a clear "No address on file" fallback.
- **Tracking** — the tracking number is shown prominently with carrier and live
  status; when there's none, that's made obvious ("No tracking number yet").
  Admins can set a manual number or hit "Check for live updates".
- **Automatic live tracking on load** — when the invoice opens and its order has
  an Easyship shipment, the page pulls the latest tracking from Easyship, shows
  it, and (for admins) persists any changes back onto the order.
- **Email customer** — order-confirmation and shipping-notification sends
  (matching the order page), in addition to the existing invoice-email flow.
- **No linked order?** — every section above shows a clear fallback instead of
  breaking, since a few older invoices have no bound order.

## Implementation

- `GET /api/admin/invoices/[id]` now embeds the linked order (status, tracking
  fields, shipping address, notes, fulfillment type, order items) so the detail
  page has everything on first load. Exposed on the client `Invoice` type as
  `invoice.order` (`InvoiceLinkedOrder`).
- New `GET /api/admin/invoices/[id]/tracking?refresh=1` — reads the order's
  tracking snapshot and, when a shipment exists, live-refreshes it from Easyship
  (persisting for admins). Client helper `getInvoiceTracking`.
- New `lib/shipping/easyship.ts` → `getEasyshipShipmentTracking` /
  `extractTrackingInfo` pull a tracking snapshot from a shipment payload.
- Invoice→order status sync is already handled server-side by
  `syncOrderFromInvoice` (run from the invoice `PATCH` route); this change just
  surfaces the resulting order status on the detail page rather than adding a
  second sync path.
- Manual tracking edits reuse the existing `updateOrderTracking` order mutation;
  customer emails reuse the existing `/api/email` endpoint.

## Files

- `lib/shipping/easyship.ts`
- `app/api/admin/invoices/[id]/route.ts`
- `app/api/admin/invoices/[id]/tracking/route.ts` (new)
- `lib/admin/invoices.ts`
- `lib/supabase.ts`
- `app/(admin)/admin/invoices/[id]/page.tsx`
