# Invoice Splitting on Backorder + Low-Stock Alerts

Date: 2026-06-04

Two related inventory features for the admin panel.

---

## 1. Invoice splitting when quantities exceed stock

Previously, creating an invoice whose line quantity exceeded a product's
`stock_quantity` kept the full quantity on a single invoice and recorded only
the shortfall in a separate `backorders` table.

Now, at **invoice creation** the order is split into two invoices when any line
exceeds available stock:

- **Primary invoice** — the in-stock quantities (`qty − exceeding`). Carries the
  shipping cost and the requested status (draft/sent/paid). Marked paid →
  decrements stock as before.
- **Backorder invoice** — the exceeding quantities only. Flagged
  `is_backorder = true`, linked to the primary via `parent_invoice_id`, always
  starts as a **draft** (no stock to fulfil yet), shipping = 0. A `backorders`
  row + `backorder_items` are created against it, so it shows up in the
  **Backorders** tab and can be fulfilled via a purchase order exactly as
  before.

Stock is allocated greedily in line order, so multiple lines referencing the
same product never over-allocate the same units. If **all** quantities are
backordered there is no primary invoice — only the backorder invoice is created.
After a split, the New Invoice form redirects to the **Backorders** tab.

Editing a backorder invoice no longer runs the stock-comparison backorder sync
(which would wrongly clear its backorder).

## 2. Per-product low-stock alerts

Every product has a **Low Stock Alert Threshold** (defaults to **10**, editable
both in the product modal and inline in the products table). When
`stock_quantity` reaches or drops below it, the system:

- emails the admin notification list (`site_settings.admin_emails`) via
  `sendLowStockAlert` (SMTP),
- surfaces the product in a **dashboard alert panel**,
- shows an amber **badge on the Products nav item**.

The alert fires **once per crossing** (`low_stock_alerted` dedupe flag) and
re-arms when stock recovers above the threshold. It is evaluated on manual
product edits **and** automatic stock decrements from paid invoices, recorded
payments, and confirmed crypto orders.

---

## Migrations (run in Supabase)

| File | Change |
|------|--------|
| `invoice-split-backorder-migration.sql` | Adds `invoices.is_backorder`, `invoices.parent_invoice_id` |
| `low-stock-alerts-migration.sql` | Adds `products.low_stock_threshold`, `products.low_stock_alerted` |

## Files Modified / Created

| File | Change |
|------|--------|
| `invoice-split-backorder-migration.sql` | New — invoice split columns |
| `low-stock-alerts-migration.sql` | New — low-stock columns |
| `lib/admin/invoice-split.ts` | New — `computeStockSplit` allocator |
| `lib/admin/low-stock.ts` | New — `checkLowStockForProducts` evaluator |
| `lib/email-smtp.ts` | New `sendLowStockAlert` (multi-recipient) |
| `app/api/admin/invoices/route.ts` | Split logic on create |
| `app/api/admin/invoices/[id]/route.ts` | Skip sync for backorder invoices; low-stock check on paid |
| `app/api/admin/invoices/[id]/payments/route.ts` | Low-stock check after paid decrement |
| `app/api/orders/check-payment/route.ts`, `app/api/cron/check-payments/route.ts` | Low-stock check after order decrement |
| `app/api/admin/products/route.ts`, `app/api/admin/products/[id]/route.ts` | Accept `low_stock_threshold`; evaluate on edit |
| `lib/admin/api.ts` | `getLowStockProducts` helper |
| `lib/admin/invoices.ts` | `createInvoice` returns split metadata |
| `lib/supabase.ts` | `Invoice` + `Product` type fields |
| `app/(admin)/admin/page.tsx` | Dashboard low-stock alert panel |
| `app/(admin)/admin/layout.tsx` | Products nav low-stock badge |
| `app/(admin)/admin/products/page.tsx` | Threshold form field |
| `app/(admin)/admin/invoices/page.tsx` | Backorder badge in list |
| `app/(admin)/admin/settings/page.tsx` | Copy: admin emails also receive low-stock alerts |
| `components/admin/InvoiceForm.tsx` | Redirect to Backorders tab on split |
