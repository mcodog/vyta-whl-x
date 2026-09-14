# Printed invoices — box/vial tag per line item

Date: 2026-07-13

The printable/PDF invoice now shows whether each line item was priced by the
**box** (pack of 10) or the **single vial**, matching the badge already visible
on the admin invoice detail page. Previously this distinction only appeared
on-screen and was lost when an invoice was printed or downloaded.

## What changed

- Each line item's description in the printed invoice now carries a small
  **Box** / **Vial** tag:
  - **Vial** lines render an indigo tag.
  - **Box** lines render a bronze tag.
- Applies to both the print/HTML view (`GET /api/admin/invoices/[id]/pdf`) and
  the generated PDF attachment (`renderInvoicePdf`).

## Implementation

- `InvoiceForHtml.line_items` (`lib/admin/invoice-html.ts`) gains an optional
  `price_type` (`box | vial`); `buildInvoiceHtml` renders a `.unit-tag` next to
  the description.
- `invoice-pdf.ts` draws the same label inline after the description using a
  `continued` text run, in bronze (box) or indigo (vial).

No migration — `invoice_line_items.price_type` already exists and the PDF/HTML
route already selects it via `*`.

## Files

- `lib/admin/invoice-html.ts`
- `lib/invoice-pdf.ts`
