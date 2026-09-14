# Module Port Guide — Index

This folder documents the modules selected for porting from the **aminocan** app
(Next.js 15 App Router + Supabase + TypeScript + Tailwind) to another website with
the same stack/structure. Each doc covers data model, API endpoints, frontend,
a detailed UI/UX specification, dependencies, and porting notes.

## Scope

**Ported modules (12):**

| # | Module | File |
|---|--------|------|
| 01 | Invoices | [`01-invoices.md`](./01-invoices.md) |
| 02 | Inventory & Stock (backorders, low-stock, notify-me, restock) | [`02-inventory-and-stock.md`](./02-inventory-and-stock.md) |
| 03 | Products (public storefront) | [`03-products-public.md`](./03-products-public.md) |
| 04 | Admin Products Management | [`04-admin-products-management.md`](./04-admin-products-management.md) |
| 05 | Customer Accounts & Auth | [`05-customer-accounts-and-auth.md`](./05-customer-accounts-and-auth.md) |
| 06 | Users, Roles & Permissions | [`06-users-roles-permissions.md`](./06-users-roles-permissions.md) |
| 07 | Email / Notifications Infra | [`07-email-notifications-infra.md`](./07-email-notifications-infra.md) |
| 08 | Pricing & Pricelists | [`08-pricing-and-pricelists.md`](./08-pricing-and-pricelists.md) |
| 09 | Purchase Orders & Suppliers | [`09-purchase-orders-and-suppliers.md`](./09-purchase-orders-and-suppliers.md) |
| 10 | Analytics | [`10-analytics.md`](./10-analytics.md) |
| 11 | Settings (Admin) | [`11-settings-admin.md`](./11-settings-admin.md) |
| 12 | Sales People | [`12-sales-people.md`](./12-sales-people.md) |

**Explicitly NOT ported:**

- **Affiliate program** — the entire referral/request/approval/affiliate-dashboard/
  affiliate-pricing system. Every doc flags where affiliate logic is entangled and
  must be **stripped** (e.g. customer-pricing scoping, affiliate read-only product
  tab, affiliate invoice access, `affiliate` role + permissions, affiliate
  analytics/commissions, affiliate welcome emails).
- **Standalone Commissions module** — only the **sales-person** commission surface
  (Module 12) is ported; affiliate commissions are excluded.
- **Core shopping flow** — Cart/Checkout/Crypto payments/Orders are assumed to
  already exist on the target site (same structure). They are referenced as
  dependencies where needed but not documented here.

## Recommended porting order

Dependencies flow roughly top-down. Build foundations first:

1. **06 — Users, Roles & Permissions** + **05 — Customer Accounts & Auth**
   (shared `customers` table, `user_role` enum, RBAC, route guards, audit log —
   the base table and enum live in the Supabase dashboard, not committed SQL, so
   create them first).
2. **11 — Settings (Admin)** + **07 — Email/Notifications Infra**
   (they share `site_settings` and the invoice email-template defaults; port 11
   and its SQL before 07's send routes).
3. **03 — Products (public)** + **04 — Admin Products Management**
   (own the `products` schema; note `stock_quantity` is the live column, base
   `stock_qty` is vestigial).
4. **08 — Pricing & Pricelists** (active pricelist drives invoice line prices).
5. **01 — Invoices** (depends on products, pricing, customers, email, settings).
6. **02 — Inventory & Stock** + **09 — Purchase Orders & Suppliers**
   (backorders FK purchase orders; both write `inventory_log` and mutate
   `products.stock_quantity`).
7. **12 — Sales People** (commission rows populate from the Invoices flow).
8. **10 — Analytics** (pure-derived; depends on invoices/payments, POs, products).

## Key cross-module dependencies

- **`customers` table + Supabase Auth** — shared by Modules 05 and 06; base table
  and `user_role` enum exist only in the Supabase dashboard (create first).
- **`site_settings`** — shared by Modules 07 and 11 (admin emails, invoice CC,
  email-template columns) + `lib/invoice-email-templates.ts`.
- **`products.stock_quantity`** — written by Module 02 (decrement on payment) and
  Module 09 (increment on receiving); both write `inventory_log`.
- **`stock_notifications`** — customer subscribes on storefront (Module 03), admin
  restock triggers the back-in-stock email (Module 04 / 02).
- **`customer_price_overrides`** — merged into `/api/products` (Module 03) and used
  by Invoices/Pricing (Modules 01, 08).
- **Backorders ↔ Purchase Orders** — `backorders.purchase_order_id` FKs
  `purchase_orders`; the backorder "Fulfill" button deep-links to
  `/admin/purchase-orders/new?backorder=<id>`.
- **Admin auth pattern** — every admin API route uses Bearer token → `getUser` →
  `customers.role`, plus `lib/permissions.ts` helpers (`canCreate`/`canDelete` =
  admin-only).

## Conventions used in every doc

Each module doc contains: an overview, **Data model** (Postgres tables/columns/
constraints/RLS transcribed from the `.sql` migrations), **API endpoints**,
**Frontend** (routes/components/state), a detailed **UI/UX specification**
(layout, copy, states, badge colors, responsive behavior), **Dependencies**, and
**Porting notes** (including what affiliate code to strip).
