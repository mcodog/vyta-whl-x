# Cluster 5 — Invoicing & Accounts Receivable: Code Extraction Guide

> **What this document is.** A file-by-file walkthrough of Cluster 5 so you can extract it
> completely. For each piece: *what to open*, *what it does*, *its intricacies*, and *exactly
> how it touches the database*. Ports **sixth** (after 1, 10, 2, 3, 4). It depends on products,
> pricing, customers, email/settings; it feeds backorders (7), fulfillment (6), and commissions (9).
>
> **Companion deep spec:** `docs/module-ports/01-invoices.md`. This is the *map*; that's the *atlas*.

---

## 1. What the cluster is / does

The back-office **invoicing + A/R** engine. Admins create invoices (manually or auto-from-order),
build line items priced from the active pricelist, apply tax/shipping, optionally attach a
sales-person (commission snapshot), **split-on-backorder** when stock is short, send a templated
PDF email, record payments (which **decrement stock** on full payment), and track A/R aging.

**Why it's the hub of the back office:** it touches **8+ tables** — owns `invoices`,
`invoice_line_items`, `payments`; writes `invoice_email_log` (Cluster 10), `sales_commissions`
(Cluster 9), `backorders`/`backorder_items` (Cluster 7); spawns an `orders` row for the warehouse
queue (Cluster 4/6); and calls `adjust_stock_for_invoice` (Cluster 2).

---

## 2. Database schema — what exists and where it comes from

### `invoices` — base in `ecommerce-backend-migration.sql`
`id`, **`invoice_number text UNIQUE DEFAULT 'INV-' || nextval('invoice_number_seq')`**,
`order_id → orders ON DELETE SET NULL`, `customer_id → customers ON DELETE SET NULL`, denormalized
`customer_name/email/phone`, `issue_date`, `due_date` (default +30 days), `subtotal`, `tax_rate`,
`tax_total`, `shipping_cost`, `total`, **`status CHECK IN ('draft','sent','partial','paid',
'overdue')`**, `notes`, timestamps. Indexes on customer/order/status/due_date. **Intricacy —
idempotency:** `UNIQUE INDEX uniq_invoices_order_id ON invoices(order_id) WHERE order_id IS NOT NULL`
(one invoice per order, for `autoCreateInvoiceFromOrder`). `updated_at` trigger via `set_updated_at()`.

**ALTERs that pile on:**
| Migration | Adds |
|-----------|------|
| `invoice-email-migration.sql` (Cluster 10) | `last_emailed_at/_by/_by_email` |
| `invoice-sales-features-migration.sql` (Cluster 9) | `sales_person_id → sales_persons`, `sales_person_commission_rate`, `sales_person_commission_amount` |
| `invoice-split-backorder-migration.sql` (Cluster 7) | `is_backorder boolean`, `parent_invoice_id → invoices` |
| `stock-decrement-migration.sql` (Cluster 2) | `stock_adjusted boolean` |
| `warehouse-fulfillment-migration.sql` (Cluster 6) | `fulfillment_type/status`, `packed_*`, `non_payable`, `handling_checklist`, `packed_photos` |

### `invoice_line_items` (same base migration)
`id`, `invoice_id → invoices ON DELETE CASCADE`, **`product_id uuid → products ON DELETE SET NULL`**
(note: uuid here, unlike `order_items.product_id` TEXT), `description`, `qty CHECK(>0)`, `unit_price`,
`discount_pct`, `line_total`, `created_at`. (Cluster 6 adds `qty_fulfilled`/`qty_backordered`.)

### `payments` (same base migration)
`id`, `invoice_id → invoices ON DELETE CASCADE`, `amount CHECK(>0)`, **`method CHECK IN
('card','e-transfer','cash','other')`**, `reference_note`, `paid_at`, `recorded_by → customers`,
`created_at`.

### `mark_overdue_invoices()` RPC (same migration)
Sweeps invoices past `due_date` (not paid/draft) → `status='overdue'`; returns count. **Called at the
top of the list GET and the aging GET.**

### RLS
`invoices`/`invoice_line_items`/`payments` → admin/assistant read, **admin write** (service-role
bypasses). All API routes use service-role + re-verify role.

---

## 3. The reading map (open files in this order)

### Tier A — Types & pure helpers
- `lib/supabase.ts` → `Invoice`, `InvoiceLineItem`, `Payment`, `InvoiceStatus`, `PaymentMethod`,
  `AgingBucket`.
- `lib/admin/invoice-status.ts` → `INVOICE_STATUSES`, `INVOICE_STATUS_META` (labels/colors),
  **`effectiveStatus(status, due_date)`** — derives "overdue" for display even before the RPC sweep.
- `lib/admin/invoice-split.ts` → **`computeStockSplit(lines, stockMap)`** → `{inStock, backordered,
  backorderItems}` (the brain of split-on-backorder).
- `lib/admin/invoice-access.ts` → `getInvoiceCaller`, `affiliateCustomerIds`,
  `affiliateSalesPersonId`, `affiliateCanAccessInvoice` (Cluster 8 scoping).
- `lib/admin/invoice-html.ts` (`buildInvoiceHtml`) + `lib/invoice-pdf.ts` (`renderInvoicePdf`,
  pdfkit) — the document renderers.

### Tier B — Create / list (the dense core)

**`app/api/admin/invoices/route.ts`** — GET (list) + **POST (create)**.
- **GET:** `verifyAdmin` → `mark_overdue_invoices()` RPC → query with server-side search (`q`),
  status filter, pagination; per-row `effectiveStatus`; plus aggregate **stats** (total/outstanding/
  overdue/paid) computed over the status-scoped set joined to `payments(amount)`. Affiliate scoping
  via `getCaller` (Cluster 8).
- **POST:** admin (`canCreate`). Cleans line items, resolves each unit price (pricelist seam,
  Cluster 3). **Looks up `products.stock_quantity` and runs `computeStockSplit`.**
  - If lines are backordered → creates the **primary (in-stock) invoice** + a **backorder invoice**
    (`is_backorder:true`, `parent_invoice_id`) and writes `backorder_items` via `syncInvoiceBackorder`
    (Cluster 7).
  - **Spawns a linked `orders` row** (+ `order_items`) with `status` `pending_invoice` (draft) or
    `processing` (sent) — this is what puts the invoice on the warehouse queue (Cluster 6).
  - **Sales commission (Cluster 9):** snapshots `sales_person_commission_rate/amount` onto the
    invoice and inserts a `sales_commissions` row.
  - Audit `invoice.create`. Re-checks low-stock.

**`lib/admin/invoices.ts`** — client wrappers + server helpers: `getInvoices`, `getInvoice`,
`createInvoice`, `replaceInvoice`, `updateInvoiceStatus`, `deleteInvoice`, `recordPayment`,
`getAgingReport`, **`autoCreateInvoiceFromOrder`** (the reverse direction — order → invoice,
guarded by the unique order_id index).

### Tier C — Detail / edit / payments / email

**`app/api/admin/invoices/[id]/route.ts`** — GET (detail) + PATCH (edit) + DELETE.
- PATCH replaces header + line items; recomputes sales-commission snapshot and **upserts the
  `sales_commissions` row**. Affiliate may edit own customers' invoices (`canEditInvoice`) but not
  the commission rate. DELETE is admin-only.

**`app/api/admin/invoices/[id]/payments/route.ts`** (`POST`) — *record a payment.* (Read carefully.)
- Loads invoice + `payments(amount)`; computes `paidSoFar` and `due`; **overpay guard** (`amount >
  due + 0.001` → 422). Inserts `payments`. Recomputes status → `paid` (fully) or `partial`.
- **On `paid`:** calls **`adjust_stock_for_invoice` RPC** (Cluster 2 decrement; idempotent via
  `stock_adjusted`) and triggers **auto-buy EasyShip label** (Cluster 6). Audit `invoice.payment`.

**`app/api/admin/invoices/[id]/email/route.ts`** (`POST`) — *send the invoice.*
- Loads `site_settings` templates + `invoice_cc_emails` (Cluster 10). `buildInvoiceMergeVars` →
  `renderTemplate` for customer + admin-copy subject/body. `renderInvoicePdf` → PDF **attachment**.
  Sends both, **inserts `invoice_email_log`**, updates `invoices.last_emailed_*` and flips
  `draft → sent`. Audit `invoice.email_sent`.

**`app/api/admin/invoices/aging/route.ts`** (`GET`) — runs `mark_overdue_invoices()` then
`getAgingReport()` → buckets (current / 1-30 / 31-60 / 61-90 / 90+).

**`app/api/admin/invoices/[id]/pdf/route.ts`** — A4 HTML/PDF view (`?download=1` auto-prints).

### Tier D — UI
- `app/(admin)/admin/invoices/page.tsx` — list + AR stat cards + aging toggle + **Pricelists tab**
  (Cluster 3) + magic-link errors via `alert()`.
- `app/(admin)/admin/invoices/new/page.tsx`, `[id]/page.tsx`, `[id]/edit/page.tsx`.
- `components/admin/InvoiceForm.tsx` — shared create/edit form (customer + sales-person picker,
  line builder w/ pricelist price + stock badge, tax/shipping, split warning).
  `components/admin/MultiSelectCustomer.tsx`, `NumericStepper.tsx`.

---

## 4. End-to-end flows to trace

1. **Create invoice (with shortfall):** POST → resolve prices (pricelist) → `computeStockSplit` →
   primary invoice + backorder invoice (`is_backorder`, `parent_invoice_id`) + `backorder_items` →
   spawn `orders`/`order_items` (warehouse queue) → snapshot + insert `sales_commissions` → audit.
2. **Send:** `/[id]/email` → settings templates + CC → merge vars → PDF attach → send customer +
   admin copy → `invoice_email_log` + `last_emailed_*` + `draft→sent`.
3. **Record payment:** `/[id]/payments` → overpay guard → insert `payments` → status `partial`/`paid`
   → if `paid`: `adjust_stock_for_invoice` (stock down) + auto-buy label.
4. **Aging / overdue:** list & aging GET run `mark_overdue_invoices()`; `effectiveStatus` shows
   overdue in the UI between sweeps.

---

## 5. Extraction checklist & gotchas

- [ ] Create the `invoice_number_seq` sequence (the default expression depends on it) before the table.
- [ ] Keep `uniq_invoices_order_id … WHERE order_id IS NOT NULL` — it's the idempotency guard for
      order→invoice.
- [ ] Status is a **CHECK enum**; `overdue` is set by the **`mark_overdue_invoices()` RPC** (called
      on list/aging), while `effectiveStatus()` derives it for display in between — keep both.
- [ ] `invoice_line_items.product_id` is **uuid** (contrast `order_items.product_id` TEXT) — the two
      stock RPCs differ accordingly.
- [ ] **Payment → stock:** full payment calls `adjust_stock_for_invoice` (idempotent via
      `stock_adjusted`); overpay guard returns 422. This is where **e-Transfer orders decrement stock**.
- [ ] Creating an invoice **also creates a linked `orders` row** (so it appears on the warehouse
      queue) — don't drop that or fulfillment breaks.
- [ ] Email uses `site_settings` templates + `invoice_cc_emails` (Cluster 10), attaches the pdfkit
      PDF, logs to `invoice_email_log`, and flips `draft→sent` — wire Cluster 10 first.
- [ ] **Sales commission** snapshot (rate+amount on the invoice) + `sales_commissions` row is
      Cluster 9; **affiliate scoping** (`invoice-access.ts`, `canEditInvoice`) is Cluster 8 — strip
      the affiliate branches if not porting 8 (the commission machinery stays for sales-people).
- [ ] **Split-on-backorder** writes `backorders`/`backorder_items` via `syncInvoiceBackorder`
      (Cluster 7) — port that table now or guard the call.
- [ ] Auto-buy label on payment is Cluster 6 — port the seam, implementation later.

---

## 6. File index (everything in Cluster 5)

```
DB        ecommerce-backend-migration.sql (invoices, invoice_line_items, payments,
            set_updated_at, mark_overdue_invoices, invoice_number_seq),
          invoice-email-migration.sql (last_emailed_* + invoice_email_log — Cluster 10),
          invoice-sales-features-migration.sql (sales_person_* + sales_commissions — Cluster 9),
          invoice-split-backorder-migration.sql (is_backorder, parent_invoice_id — Cluster 7),
          stock-decrement-migration.sql (adjust_stock_for_invoice — Cluster 2)
libs      lib/admin/invoices.ts, invoice-status.ts, invoice-split.ts, invoice-access.ts,
          invoice-html.ts, backorder-sync.ts, lib/invoice-pdf.ts,
          lib/invoice-email-templates.ts (Cluster 10), lib/orderTotals.ts
API       app/api/admin/invoices/{route,[id],aging}.ts,
          app/api/admin/invoices/[id]/{payments,email,pdf}.ts
admin UI  app/(admin)/admin/invoices/{page,new,[id],[id]/edit}.tsx,
          components/admin/{InvoiceForm,MultiSelectCustomer,NumericStepper,PricelistsTab}.tsx
docs      docs/module-ports/01-invoices.md
```

**Deps:** `pdfkit` (PDF). **Email senders:** via `app/api/admin/invoices/[id]/email` using
`lib/invoice-email-templates` + the SMTP transport (Cluster 10). **Audit actions:**
`invoice.create/update/delete/email_sent/payment`. **Seams:** Cluster 2 (stock RPC), 3 (pricelist),
6 (orders row + auto-buy label + fulfillment cols), 7 (backorders), 9 (sales commissions),
8 (affiliate scoping).
```
