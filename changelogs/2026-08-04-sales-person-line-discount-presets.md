# Per-sales-person line-item discount presets

Date: 2026-08-04

Each sales person (rep or affiliate — the base `sales_persons` row, ADR 0003)
can now carry a **default per-line discount** that pre-fills the Disc % field
when a line item is added on one of their invoices. Two presets, one per line
type: **box** (pack-of-10) and **single vial**. They are just defaults — the
admin/affiliate can change or clear the discount on any line.

## What changed

**Schema** — `sales-person-line-discount-presets-migration.sql`
- `sales_persons.default_box_discount_pct` and `default_vial_discount_pct`
  (`numeric(5,2)`, `0–100`, default `0`). `0` = no preset.
- Sets **getatkat's** vial preset to **50%** (box left at 0). Matched by her
  sales-person row's affiliate link (`user_id`) or email; the migration reports
  if no sales-person row matches (she must be set up as a sales person for it to
  take effect).

**Sales People management** — `CreateSalesPersonModal` / `EditSalesPersonModal`
(+ `POST`/`PATCH /api/admin/sales-persons`)
- New **Line-item discount presets (%)** fields (Box / Vial), validated 0–100
  and persisted.

**Invoice builder** — `components/admin/InvoiceForm.tsx`
- When the invoice's sales person has a preset, a new line's Disc % pre-fills
  from it: the **box** preset when a product is chosen (box default) and the
  **vial** preset when the line is switched to per-vial pricing.
- Each line tracks whether its discount was set by hand (`discount_touched`);
  once touched (typed, quick-preset, or "Discount all"), presets never overwrite
  it. Existing lines on an edited invoice keep their saved discount.
- Changing the invoice's sales person refreshes the pre-filled discount on any
  untouched line — so the first line, an affiliate's own presets (loaded after
  mount), and a freshly-picked sales person all take effect.

## Notes

- Presets are **percentages**, reusing the existing per-line `discount_pct`
  (clamped 0–100). No new discount mechanism.
- The preset follows the **sales person on the invoice**. Affiliates building
  their own invoices get their own presets (their linked `sales_persons` row is
  loaded via `/api/affiliate/me`). The server keeps affiliate-submitted
  discounts (clamped), so the preset is respected there too.
