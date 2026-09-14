# Sync Easyship Shipments Onto Invoices By Name

Date: 2026-07-13

The admin **Invoices** page gains a **Sync Easyship** button that pulls the
shipments/labels Easyship has on record and attaches them onto the matching
invoices — matched by customer name — so tracking numbers and labels created
directly in Easyship (rather than through the app) flow back into our database
without hand-copying each one.

## What changed

- **"Sync Easyship" button** (admin only) next to _New Invoice_. Opens a dialog
  that runs the sync in three explicit steps: **pick a date → review matches →
  apply**.
- **Date picker, defaults to today** — the sync fetches every Easyship shipment
  created on or after the chosen day (capped at today). Pick an earlier date to
  backfill.
- **Match by customer name** — each fetched shipment's destination contact name
  is normalised and matched against invoices whose linked order doesn't already
  have a shipment. When a name maps to several invoices, the newest is chosen and
  the row is flagged (`N invoices — newest chosen`).
- **Review before applying** — the dialog lists the matched shipments
  (pre-checked, each showing courier / tracking / label state) and, separately,
  the **unmatched** shipments that were left untouched. Uncheck any you don't want
  to attach.
- **Apply attaches into our database** — for each confirmed match, the shipment
  id, tracking number/URL/status, carrier, and label state/URL are written onto
  the invoice's linked order. Orders that already carry a shipment, or that no
  longer exist, are skipped and reported back. Every attach writes an
  `invoice.easyship_sync` audit entry.

## Implementation notes

- `listEasyshipShipments(sinceDate)` in `lib/shipping/easyship.ts` pages the
  Easyship List Shipments endpoint newest-first and stops once it crosses the
  date cutoff, so a "today" sync typically touches only the first page. It reuses
  the existing `extractLabelInfo` / `extractTrackingInfo` helpers to flatten each
  shipment.
- `POST /api/admin/invoices/easyship-sync` serves both steps on one route:
  `{ date }` returns the preview (read-only), `{ apply: [...] }` writes the
  confirmed matches onto orders. Admin-only (assistants are read-only).
- The match never overwrites: only invoices whose order has no
  `easyship_shipment_id` are offered, and apply re-checks that the order is still
  unshipped and that the shipment isn't already bound elsewhere before writing.
