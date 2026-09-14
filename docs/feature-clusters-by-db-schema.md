# Aminocan — Feature Clusters by DB Schema (Migration Units)

> **Step 2 of the migration plan.** Step 1 listed modules by user class. This groups those
> features into **interdependent clusters that share database tables** — the natural units to
> port together. Splitting a cluster across migrations breaks foreign keys or shared writes.
>
> Each feature lists: **Page(s) to look at** · **What the feature is** · **DB tables it uses**.
>
> Table↔file and FK relationships below were extracted directly from the code (`.from('…')`
> references) and the `*.sql` migrations — not inferred.

## The 33 tables and who owns them

```
customers ─ hub of identity; referenced by 21 FKs (orders, invoices, affiliates,
            affiliate_requests, customer_price_overrides, stock_notifications, audit_log…)
            ⚠ base table + user_role enum live in the Supabase dashboard, NOT in committed SQL.
products  ─ catalog hub; referenced by 11 FKs (order_items, invoice_line_items,
            *_price_overrides, pricelist_items, purchase_order_items, supplier_prices,
            stock_notifications, inventory_log)
orders ──→ order_items, payments(via invoice), commissions, shipment_auto_logs,
           fulfillment_email_log;  orders.customer_id → customers (ON DELETE SET NULL)
invoices ─→ invoice_line_items, payments, invoice_email_log, sales_commissions,
            backorders; invoices.{customer_id, sales_person_id, order_id, parent_invoice_id}
affiliates → referral_codes, affiliate_price_overrides, commissions; affiliates.id ↔ customers
```

Tables written only via **RPC / triggers** (no direct `.from()` in app code):
`inventory_log` (via `adjust_stock_for_invoice` RPC + PO receiving),
`purchase_order_receipt_items` (via receiving flow). `certificate` is a Storage bucket, not a table.

---

## CLUSTER 1 — Identity, Accounts & Access (RBAC)
**Shared tables:** `customers`, `audit_log`, `auth.users` (Supabase). Hub: `customers`.
**Why grouped:** every other cluster FKs `customers`. Port this first.

| Feature | Page(s) to look at | What it is | DB tables |
|---------|--------------------|------------|-----------|
| Customer signup | `app/(customer)/signup/page.tsx` + `lib/customer/api.ts` | Email/password register, email confirm, referral binding | `customers`, `auth.users`, `referral_codes` |
| Login / logout | `app/(customer)/login/page.tsx`, `contexts/CustomerContext.tsx` | Auth + role-based redirect, deactivation check | `customers`, `auth.users` |
| Forgot / set password | `app/(customer)/forgot-password/page.tsx`, `app/(customer)/account/set-password/page.tsx` | Supabase recovery + strength rules | `auth.users`, `customers` |
| Customer profile/address | `app/(customer)/account/dashboard/page.tsx` | Edit name, phone, shipping address | `customers` |
| Admin: customers mgmt | `app/(admin)/admin/customers/page.tsx` → `app/api/admin/customers/route.ts`, `[id]`, `report` | List/create/edit/delete, pickup/ship toggles, CSV report | `customers`, `customer_price_overrides`*, `orders`* |
| Admin: magic sign-in link | `app/(admin)/admin/customers/page.tsx` → `app/api/admin/customers/magic-link/route.ts` | One-time passwordless login link | `customers`, `auth.users` |
| Admin: users & roles | `app/(admin)/admin/users/page.tsx` → `app/api/admin/users/route.ts`, `[id]` | Staff CRUD, role enum, active=Auth ban; deleting a user also clears `affiliates`/`referral_codes`/`commissions` links | `customers`, `auth.users`, `affiliates`, `referral_codes`, `commissions`, `sales_persons` |
| RBAC + route guards | `lib/permissions.ts`, `lib/hooks/usePermissions.ts`, `components/RouteGuard.tsx`, `app/(admin)/admin/layout.tsx` | Role gating client + server | `customers` (role column) |
| Audit log | `lib/admin/audit.ts`; read in `app/api/admin/warehouse/activity/route.ts` | Append-only action ledger (actor → customers) | `audit_log`, `customers` |

\* cascade/scoping reads, not the primary table.

---

## CLUSTER 2 — Product Catalog & Inventory
**Shared tables:** `products`, `inventory_log`, `stock_notifications`. Hub: `products`.
**Why grouped:** all read/write `products.stock_quantity`; notify-me + low-stock + restock are one loop.

| Feature | Page(s) to look at | What it is | DB tables |
|---------|--------------------|------------|-----------|
| Storefront catalog | `app/products/page.tsx` → `app/api/products/route.ts` | Browse/search, categories, stock display, merges price overrides | `products`, `customer_price_overrides` |
| Product detail | `app/products/[slug]/page.tsx` → `app/api/products/route.ts` | Pack sizes, COA, benefits, related | `products`, `customer_price_overrides` |
| Featured products | `components/Products.tsx`/`Hero.tsx` → `app/api/products/featured/route.ts` | In-stock featured carousel | `products`, `customer_price_overrides` |
| Product ticker | `components/ProductTicker.tsx` | Scrolling product feed | `products` |
| Admin product CRUD + inline edit | `app/(admin)/admin/products/page.tsx` → `app/api/admin/products/route.ts`, `[id]` | Create/edit/delete, inline price/stock/threshold | `products` |
| Product image upload | same page → `app/api/admin/products/upload/route.ts` | Image to Storage, URL on product | `products`, Storage |
| COA upload | same page → `app/api/admin/products/upload-certificate/route.ts` | COA PDFs to Storage | `products`, Storage (`certificate`) |
| CSV product import | same page → `app/api/admin/products/import/route.ts` | 2-step preview/apply upsert | `products` |
| Notify-me (back in stock) | `components/NotifyMeButton.tsx` → `app/api/stock-notifications/route.ts` | Customer waitlist subscribe/check/unsub | `stock_notifications`, `products`, `customers` |
| Restock → send waitlist emails | `app/(admin)/admin/products/page.tsx` → `app/api/admin/products/[id]/route.ts`, `app/api/admin/stock-notifications/route.ts` | On 0→+ stock, email pending subscribers | `stock_notifications`, `products`, `customers` |
| Stock requests dashboard | `app/(admin)/admin/stock-requests/page.tsx` → `app/api/admin/stock-notifications/route.ts` | Most-requested out-of-stock products | `stock_notifications`, `products` |
| Low-stock alerts | dashboard `app/(admin)/admin/page.tsx`; `lib/admin/low-stock.ts` | Threshold alerts on dashboard | `products`, `site_settings` |
| Inventory ledger | written by RPC/trigger (`stock-decrement-migration.sql`, PO receiving) | Every stock change logged | `inventory_log`, `products` |
| Product report | `app/api/admin/products/report/route.ts` | Product/sales export | `products`, `order_items` |

---

## CLUSTER 3 — Pricing & Pricelists
**Shared tables:** `pricelists`, `pricelist_items`, `customer_price_overrides`, `affiliate_price_overrides`.
**Why grouped:** all FK `products`; the active pricelist + overrides feed both storefront pricing and invoice line prices.

| Feature | Page(s) to look at | What it is | DB tables |
|---------|--------------------|------------|-----------|
| Pricelists (switchable) | `components/admin/PricelistsTab.tsx` (in `app/(admin)/admin/invoices/page.tsx`) → `app/api/admin/pricelists/route.ts`, `[id]`, `active` | Create/copy/set-active; active list drives invoice defaults | `pricelists`, `pricelist_items`, `products`, `customers` |
| Customer price overrides | `app/(admin)/admin/pricing/page.tsx` → `app/api/admin/price-overrides/route.ts` | Per-customer/product price, single + bulk | `customer_price_overrides`, `products`, `customers` |
| Price-override CSV import | `app/(admin)/admin/pricing/_components/PriceListImportModal.tsx` → `app/api/admin/price-overrides/import/route.ts` | Bulk import overrides; can seed from affiliate list | `customer_price_overrides`, `affiliate_price_overrides`, `products`, `customers` |
| Affiliate pricelist | (admin) `app/api/admin/customers/route.ts`; schema `affiliate-pricelist-migration.sql` | Affiliate's overrides copied to each bound customer | `affiliate_price_overrides`, `customer_price_overrides`, `products`, `affiliates` |

---

## CLUSTER 4 — Storefront Orders & Payments
**Shared tables:** `orders`, `order_items`, `commissions`, `shipment_auto_logs`, `sol_addresses`.
**Why grouped:** order creation writes `orders`+`order_items`, spawns affiliate `commissions`, and triggers auto-shipment. (Crypto path disabled but its `sol_addresses` infra lives here.)

| Feature | Page(s) to look at | What it is | DB tables |
|---------|--------------------|------------|-----------|
| Cart | `app/cart/page.tsx`, `contexts/CartContext.tsx` | localStorage cart (no DB) | — (localStorage) |
| Checkout (e-Transfer) | `app/checkout/page.tsx` → `app/api/orders-email/route.ts` | Create order, referral discount, ship rates, confirmation+invoice email, affiliate commission | `orders`, `order_items`, `customers`, `commissions`, `referral_codes`, `site_settings` |
| Order success / tracking | `app/order/success/page.tsx`, `app/order/track/page.tsx` → `app/api/orders/route.ts` | Confirmation by order number, e-Transfer QR | `orders`, `order_items` |
| My orders | `app/(customer)/account/orders/page.tsx` → `app/api/orders/my-orders/route.ts` | Customer order list | `orders`, `customers` |
| Order detail + invoice download | `app/(customer)/account/orders/[id]/page.tsx` → `app/api/orders/[id]/invoice/route.ts` | Items, tracking, HTML invoice | `orders`, `order_items`, `invoices` |
| Crypto checkout infra (disabled) | `lib/crypto-wallets.ts`, `lib/payment-monitor.ts`, `app/api/orders/route.ts` (410), `app/api/orders/check-payment/route.ts` | HD wallet addresses + chain monitor | `orders`, `order_items`, `sol_addresses` |
| Admin orders | `app/(admin)/admin/orders/page.tsx`, `[id]` → `app/api/admin/orders/route.ts`, `report` | List/detail/status, tracking editor | `orders`, `order_items`, `customers` |

---

## CLUSTER 5 — Invoicing & Accounts Receivable
**Shared tables:** `invoices`, `invoice_line_items`, `payments`, `invoice_email_log`, plus writes to `sales_commissions` and `backorders`/`backorder_items`.
**Why grouped:** one create flow writes line items, snapshots sales commission, and (on stock shortfall) splits into a backorder invoice; payments + email logs hang off the invoice.

| Feature | Page(s) to look at | What it is | DB tables |
|---------|--------------------|------------|-----------|
| Invoice list + AR stats | `app/(admin)/admin/invoices/page.tsx` → `app/api/admin/invoices/route.ts` | Search/filter, outstanding/overdue cards | `invoices`, `customers`, `sales_persons` |
| Aging report | same page (toggle) → `app/api/admin/invoices/aging/route.ts` | A/R buckets 0/30/60/90+ | `invoices`, `customers`, `sales_persons` |
| Create/edit invoice | `app/(admin)/admin/invoices/new/page.tsx`, `[id]/edit`; `components/admin/InvoiceForm.tsx` → `app/api/admin/invoices/route.ts`, `[id]` | Customer + sales-person picker, line builder (pricelist price + stock), tax/shipping | `invoices`, `invoice_line_items`, `customers`, `products`, `sales_persons`, `sales_commissions`, `pricelists` |
| **Split-on-backorder** | `components/admin/InvoiceForm.tsx` → `app/api/admin/invoices/route.ts`; `lib/admin/invoice-split.ts`, `backorder-sync.ts` | Qty>stock → primary invoice + backorder invoice + items | `invoices`, `invoice_line_items`, `backorders`, `backorder_items`, `products` |
| Invoice detail / status / PDF | `app/(admin)/admin/invoices/[id]/page.tsx` → `app/api/admin/invoices/[id]/route.ts`, `[id]/pdf`; `lib/invoice-pdf.ts` | View, status change, PDF (pdfkit) | `invoices`, `invoice_line_items`, `customers` |
| Record payment | `[id]` page → `app/api/admin/invoices/[id]/payments/route.ts` | Payment w/ overpay guard; full pay → `adjust_stock_for_invoice` RPC | `payments`, `invoices`, `invoice_line_items`, `customers`, `inventory_log` |
| Send invoice email | `[id]` page → `app/api/admin/invoices/[id]/email/route.ts` | Templated email + PDF, CC defaults | `invoices`, `invoice_email_log`, `customers`, `site_settings` |

---

## CLUSTER 6 — Fulfillment / Warehouse
**Shared tables:** `invoices` (fulfillment columns), `invoice_line_items` (`qty_fulfilled`/`qty_backordered`), `fulfillment_email_log`, `audit_log`, `orders` (tracking/label), `shipment_auto_logs`.
**Why grouped:** the warehouse queue *is* non-draft invoices; packing/shipping mutate invoice+order rows and log to audit/email tables. Tightly coupled to Cluster 5 (invoices) and Cluster 7 (backorders).

| Feature | Page(s) to look at | What it is | DB tables |
|---------|--------------------|------------|-----------|
| Fulfillment queue (live) | `app/(warehouse)/warehouse/page.tsx`, `_components/QueueRow.tsx` → `app/api/warehouse/queue/route.ts` | Realtime non-draft invoices, filters | `invoices`, `customers` |
| Order detail pane | `_components/QueueDetail.tsx` → `app/api/warehouse/queue/[id]/route.ts` | Items, address, attribution | `invoices`, `invoice_line_items`, `orders` |
| Status workflow | `app/api/warehouse/queue/[id]/route.ts` | Pending→Packed→Shipped/PickedUp; syncs order status | `invoices`, `orders`, `audit_log` |
| Handling checklist | `_components/QueueDetail.tsx` → `app/api/warehouse/queue/[id]/checklist/route.ts` | Per-method checklist JSON on invoice | `invoices`, `audit_log` |
| Per-line fulfill / backorder | `_components/QueueDetail.tsx` → `app/api/warehouse/queue/[id]/line/route.ts` | Partial fulfill; backorder → non-payable child invoice | `invoice_line_items`, `invoices`, `backorders`, `audit_log` |
| Packed-photo capture | `_components/QueueDetail.tsx` → `app/api/warehouse/queue/[id]/photo/route.ts` | Camera/upload to Storage, JSON on invoice | `invoices`, Storage, `audit_log` |
| Fulfillment emails | `components/FulfillmentEmailModal.tsx` → `app/api/warehouse/queue/[id]/notify/route.ts` | Packed/shipped templated emails | `fulfillment_email_log`, `invoices`, `orders`, `customers`, `audit_log` |
| EasyShip label (admin) | `app/(admin)/admin/orders/[id]/_components/ShippingLabelPanel.tsx` → `app/api/admin/orders/[id]/{rates,create-shipment,buy-label,label,label-readiness,shipping-address}` | Rates, create shipment, buy/download label | `orders`, `customers` |
| Auto-create / auto-buy shipment | `lib/shipping/auto-shipment.ts`, `lib/shipping/easyship.ts`; `app/api/cron/check-payments/route.ts` | Background draft+label; per-attempt log | `orders`, `shipment_auto_logs`, `invoices`, `site_settings` |
| Tracking webhooks | `app/api/webhooks/easyship/route.ts` | Update tracking/status from EasyShip | `orders` |
| Warehouse staff mgmt + activity | `app/(admin)/admin/warehouse/page.tsx` → `app/api/admin/warehouse/activity/route.ts`; `lib/admin/warehouse-staff.ts` | Accounts, email-permission, perf from audit | `customers`, `audit_log`, `invoices` |

---

## CLUSTER 7 — Restock Supply Chain (Backorders ↔ Purchase Orders ↔ Suppliers)
**Shared tables:** `backorders`, `backorder_items`, `purchase_orders`, `purchase_order_items`, `purchase_order_receipts`, `purchase_order_receipt_items`, `suppliers`, `supplier_prices`, + `products`/`inventory_log`.
**Why grouped:** `backorders.purchase_order_id` → `purchase_orders`; receiving a PO increments `products.stock_quantity` and logs `inventory_log`, which clears backorders. The backorder "Fulfill" button deep-links into PO create.

| Feature | Page(s) to look at | What it is | DB tables |
|---------|--------------------|------------|-----------|
| Backorders list | `app/(admin)/admin/backorders/page.tsx` → `app/api/admin/backorders/route.ts`, `[id]`, `count` | Open/History tabs; "Fulfill" → PO create | `backorders`, `backorder_items`, `invoices`, `customers`, `purchase_orders` |
| PO list | `app/(admin)/admin/purchase-orders/page.tsx` → `app/api/admin/purchase-orders/route.ts` | Value cards, filter/search | `purchase_orders`, `suppliers`, `purchase_order_items` |
| PO create (backorder prefill) | `app/(admin)/admin/purchase-orders/new/page.tsx`, `PurchaseOrderForm.tsx` → `app/api/admin/purchase-orders/route.ts` | Supplier + product picker, tax, `?backorder=` prefill | `purchase_orders`, `purchase_order_items`, `suppliers`, `products`, `backorders` |
| PO detail + receiving | `app/(admin)/admin/purchase-orders/[id]/page.tsx`, `_components/PurchaseOrderReceiving.tsx` → `app/api/admin/purchase-orders/[id]/route.ts`, `[id]/receipts` | Per-line receive → stock increment + log | `purchase_orders`, `purchase_order_items`, `purchase_order_receipts`, `purchase_order_receipt_items`, `products`, `inventory_log` |
| PO PDF | `app/api/admin/purchase-orders/[id]/pdf/route.ts` | Branded PO document | `purchase_orders`, `purchase_order_items`, `suppliers` |
| Suppliers CRUD | `app/(admin)/admin/purchase-orders/suppliers/page.tsx` → `app/api/admin/suppliers/route.ts`, `[id]` | Supplier master data | `suppliers` |
| Supplier prices + cheapest | `app/(admin)/admin/purchase-orders/supplier-pricelists/page.tsx` → `app/api/admin/suppliers/[id]/prices`, `app/api/admin/supplier-prices/cheapest` | Per-supplier product prices, cheapest lookup | `supplier_prices`, `suppliers`, `products` |

---

## CLUSTER 8 — Client / Affiliate Program
**Shared tables:** `affiliates`, `affiliate_requests`, `referral_codes`, `affiliate_price_overrides`, `commissions` (+ `affiliates.id ↔ customers`, links to `sales_persons`).
**Why grouped:** self-contained partner program. *Optional* — strip the whole cluster if a sibling site has no partner program (touches Clusters 1/3/4/9).

| Feature | Page(s) to look at | What it is | DB tables |
|---------|--------------------|------------|-----------|
| Become-affiliate application | `app/(affiliate)/affiliate/apply/page.tsx` → `app/api/affiliate-requests/route.ts` | Customer applies (wallet, message) | `affiliate_requests`, `customers`, `site_settings` |
| Approve / deny requests | `app/(admin)/admin/affiliates/_components/PendingAffiliateRequests.tsx` → `app/api/admin/affiliate-requests/route.ts`, `[id]` | Approve→create affiliate+code; deny email | `affiliate_requests`, `affiliates`, `referral_codes`, `customers`, `sales_persons` |
| Admin create/edit/delete affiliate | `app/(admin)/admin/affiliates/page.tsx` + `_components/*Modal` → `app/api/admin/affiliates/route.ts`, `[id]` | Provision affiliate, code, linked sales-person | `affiliates`, `referral_codes`, `customers`, `sales_persons`, `commissions` |
| Affiliate performance/report | `app/api/admin/affiliate-performance/route.ts`, `app/api/admin/affiliates/report/route.ts` | Bound-customer + revenue KPIs | `affiliates`, `customers`, `orders`, `commissions`, `referral_codes` |
| Affiliate dashboard | `app/(admin)/admin/_components/AffiliateDashboard.tsx` → `app/api/affiliate/me/route.ts` | Code, bound count, earnings | `affiliates`, `referral_codes`, `customers`, `sales_persons`, `commissions`, `sales_commissions` |
| Affiliate commission ledger | AffiliateDashboard → `app/api/affiliate/commissions/route.ts` | Referral + sales commissions | `commissions`, `sales_commissions`, `referral_codes`, `sales_persons`, `customers` |
| Referral attribution/discount | `lib/affiliate/commission.ts`, `referral.ts`; applied in `app/api/orders-email/route.ts` | 10% discount + 10% commission, first-touch | `referral_codes`, `commissions`, `customers`, `orders` |
| Affiliate-scoped admin access | `lib/permissions.ts` (`AFFILIATE_PAGES`); scoping in `app/api/admin/{orders,invoices,customers}/route.ts` | Read/write limited to bound customers | `customers` (affiliate_id scope), `orders`, `invoices` |

---

## CLUSTER 9 — Sales People & Commissions
**Shared tables:** `sales_persons`, `sales_commissions`, `commissions`.
**Why grouped:** sales commission rows are created from the invoice flow (Cluster 5); the unified commissions report merges sales + affiliate commissions (Cluster 8).

| Feature | Page(s) to look at | What it is | DB tables |
|---------|--------------------|------------|-----------|
| Sales people CRUD | `app/(admin)/admin/sales-people/page.tsx` + `_components/*` → `app/api/admin/sales-persons/route.ts`, `[id]`; `lib/admin/sales-persons.ts` | Reps, commission rate, live earned stats | `sales_persons`, `sales_commissions` |
| Unified commissions report | `app/(admin)/admin/commissions/page.tsx` → `app/api/admin/commissions/report/route.ts`; `lib/admin/api.ts` | Merge affiliate + sales, mark-paid, CSV | `commissions`, `sales_commissions`, `affiliates`, `sales_persons`, `customers` |

---

## CLUSTER 10 — Settings & Notification Infrastructure
**Shared tables:** `site_settings` (singleton), `invoice_email_log`, `fulfillment_email_log`.
**Why grouped:** `site_settings` is read by checkout, orders, invoices, shipping, low-stock; the email-template defaults + log tables back every transactional send.

| Feature | Page(s) to look at | What it is | DB tables |
|---------|--------------------|------------|-----------|
| Site settings | `app/(admin)/admin/settings/page.tsx` → `app/api/admin/settings/route.ts` | Checkout type, admin/CC emails, pickup addr, guest toggle, EasyShip + auto-shipment config | `site_settings`, `customers` |
| Invoice email templates | `app/(admin)/admin/settings/email-templates/page.tsx`; `lib/invoice-email-templates.ts` | Editable templates + merge-var preview | `site_settings` |
| Email senders (infra) | `lib/email.ts`, `lib/email-smtp.ts` | SMTP/Resend transactional sends | `invoice_email_log`, `fulfillment_email_log` (write), `site_settings` |
| Shipping diagnostics | `app/api/admin/shipping/diagnose/route.ts` | EasyShip config check | `site_settings`, `customers` |

---

## CLUSTER 11 — Analytics (read-only, cross-cluster)
**Shared tables:** reads `invoices`, `payments`, `purchase_orders`, `purchase_order_items`, `products`. **Owns no tables** — port last.

| Feature | Page(s) to look at | What it is | DB tables (read) |
|---------|--------------------|------------|------------------|
| Analytics summary | `app/(admin)/admin/analytics/page.tsx` → `app/api/admin/analytics/summary/route.ts`; `lib/admin/analytics.ts` | Inventory value, incoming-PO value, revenue (invoiced/paid/outstanding/overdue) | `invoices`, `payments`, `purchase_orders`, `purchase_order_items`, `products`, `customers` |
| Admin dashboard | `app/(admin)/admin/page.tsx`; `lib/admin/api.ts` | Stat cards + recent orders + low-stock + fulfillment/auto-shipment feeds | `orders`, `products`, `invoices`, `commissions`, `shipment_auto_logs` |

---

## Cross-cluster dependency edges (what breaks if split)

- **1 → all:** `customers` FK is everywhere. Migrate Cluster 1 first.
- **2 ↔ 3:** storefront/invoice prices = `products` + `*_price_overrides` + active `pricelist`.
- **4 → 5:** an order can spawn an `invoices.order_id`; `fulfillment_email_log`/auto-shipment join both.
- **5 ↔ 6:** the warehouse queue is non-draft `invoices`; fulfillment mutates invoice + order rows.
- **5 ↔ 7:** split-on-backorder writes `backorders`/`backorder_items`; PO receiving clears them.
- **2 ↔ 7:** PO receiving increments `products.stock_quantity` + writes `inventory_log`.
- **8 → 1,3,4,9:** affiliates extend `customers`, own a pricelist, discount orders, and produce commissions. **Self-contained & optional.**
- **9 ← 5,8:** commissions populate from invoices and affiliates.
- **10 → 4,5,6:** `site_settings` gates checkout/email/shipping behavior.

**Suggested migration order:** 1 → 10 → 2 → 3 → 4 → 5 → 7 → 6 → 9 → 11, with **8 (affiliate)** slotted in only if the partner program is wanted.
