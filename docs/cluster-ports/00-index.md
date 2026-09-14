# Cluster Port Guides — Index

Code **extraction guides** for migrating Aminocan to sibling sites, organized by the
**DB-schema-interdependent clusters** defined in `docs/feature-clusters-by-db-schema.md`. Each guide
is a file-by-file walkthrough: *what to open · what it does · its intricacies · how it touches the DB*,
plus end-to-end flow traces and an extraction checklist. The `docs/module-ports/` set is the
deeper per-module "atlas"; these are the reading maps.

## Recommended porting order (dependency-first)

| Order | Cluster | Guide | Owns (key tables) |
|-------|---------|-------|-------------------|
| 1 | Identity, Accounts & Access (RBAC) | [`01-identity-access.md`](./01-identity-access.md) | `customers`, `audit_log`, `auth.users` |
| 2 | Settings & Notifications | [`10-settings-notifications.md`](./10-settings-notifications.md) | `site_settings`, email-log tables |
| 3 | Product Catalog & Inventory | [`02-products-inventory.md`](./02-products-inventory.md) | `products`, `stock_notifications`, `inventory_log` |
| 4 | Pricing & Pricelists | [`03-pricing-pricelists.md`](./03-pricing-pricelists.md) | `pricelists`, `*_price_overrides` |
| 5 | Storefront Orders & Payments | [`04-orders-payments.md`](./04-orders-payments.md) | `orders`, `order_items`, `sol_addresses` |
| 6 | Invoicing & AR | [`05-invoicing-ar.md`](./05-invoicing-ar.md) | `invoices`, `invoice_line_items`, `payments` |
| 7 | Restock Supply Chain | [`07-restock-supply-chain.md`](./07-restock-supply-chain.md) | `purchase_orders*`, `suppliers`, `backorders*` |
| 8 | Fulfillment / Warehouse | [`06-fulfillment-warehouse.md`](./06-fulfillment-warehouse.md) | invoice fulfillment cols, `fulfillment_email_log`, `shipment_auto_logs` |
| 9 | Sales People & Commissions | [`09-sales-people-commissions.md`](./09-sales-people-commissions.md) | `sales_persons`, `sales_commissions` |
| 10 | Analytics & Reports | [`11-analytics-reports.md`](./11-analytics-reports.md) | *(none — pure derive)* |
| — (optional) | Client / Affiliate Program | [`08-affiliate-client-program.md`](./08-affiliate-client-program.md) | `affiliates`, `referral_codes`, `commissions`, `affiliate_requests` |

> File numbers match the cluster numbers in `feature-clusters-by-db-schema.md` (so the on-disk order
> is 01,02,03,…); the **port order** is the first column. Cluster 8 (affiliate) is optional and slots
> in only if the target wants a partner program — `08-affiliate-client-program.md` doubles as the
> **strip map** for removing it.

## How these were built
Grounded in the actual code: `.from('<table>')` references mapped to files, FK targets extracted from
the `*.sql` migrations, and the route/lib logic read directly. See `feature-clusters-by-db-schema.md`
for the table→file index and cross-cluster dependency edges, and `feature-inventory-by-user-class.md`
for the user-class view (Customer / Client / Admin / Warehouse).
