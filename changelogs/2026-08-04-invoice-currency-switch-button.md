# Admin-only "Switch to CAD/USD" button on invoices

Date: 2026-08-04

The invoice detail page now has an admin-only button, next to **Paid in**, that
re-denominates an invoice into the other currency (CAD ↔ USD) as a **label-only**
change — the amounts are not converted or re-priced.

## What changed

`app/(admin)/admin/invoices/[id]/page.tsx`
- A **Switch to CAD / Switch to USD** button (shown only to admins — gated on
  `isAdmin`, hidden for clients/affiliates and assistants). It PATCHes
  `{ currency }` by itself, so the server skips the totals-recalc path and every
  stored amount (line unit prices, subtotal, total) is left exactly as-is. Used
  to correct an invoice raised in the wrong currency.

`set-invoices-cad-inv-1371-1359.sql`
- One-off to flip **INV-1371** and **INV-1359** from USD to CAD (label only,
  amounts unchanged) — the same effect as clicking the button on each.

## Notes

- Amounts are never converted by the currency flag anywhere in the system; it
  only records which currency the stored numbers are billed in. This button and
  the SQL both honour that — they change the label, not the math.
