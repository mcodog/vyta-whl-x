# Aminocan — Complete Feature & Module Inventory (by User Class)

> **Purpose:** A complete, migration-ready catalogue of every function and feature on the
> Aminocan platform, divided by **user class** so individual modules can be ported to
> sibling websites that share the stack.
>
> **Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind · Supabase
> (Postgres + Auth + Storage + Realtime) · nodemailer (SMTP, primary) / Resend (fallback) ·
> EasyShip (shipping) · pdfkit (PDFs) · xlsx (CSV/Excel) · wagmi/viem + bitcoinjs/solana
> (crypto wallet infra, currently disabled at checkout).
>
> **Generated:** 2026-06-23

---

## User-class → role map

The platform has **5 Postgres roles** (`customers.role` enum) that collapse into the
**4 requested user classes**:

| User class    | Role(s)                  | Entry point(s)                         | What they are |
|---------------|--------------------------|----------------------------------------|----------------|
| **Customer**  | `customer` + anonymous   | `/` storefront, `/account/*`           | Public shoppers & account holders |
| **Client**    | `affiliate`              | `/affiliate/*` portal + scoped `/admin`| B2B partners/resellers with their own bound customers, referral codes, commissions, custom pricelists |
| **Admin**     | `admin`, `assistant`     | `/admin/*`                             | Back-office staff. `admin` = full CRUD; `assistant` = mostly read-only |
| **Warehouse** | `warehouse`              | `/warehouse` portal                    | Fulfillment / packing / shipping staff |

RBAC source of truth: `lib/permissions.ts` (`canAccessAdmin`, `canAccessWarehouse`,
`canCreate/canEdit/canDelete` = admin-only, `canViewInvoices`, `canEditInvoice`,
`AFFILIATE_PAGES`). Enforced **server-side** in every API route (Bearer token →
`auth.getUser` → `customers.role`) and **client-side** for UX (`components/RouteGuard.tsx`,
admin layout nav filtering, `lib/hooks/usePermissions.ts`).

---

## Shared infrastructure (used by every class)

These cross-cutting modules underpin all four classes — port these first.

| Module | Key files | Notes |
|--------|-----------|-------|
| **Auth (Supabase)** | `contexts/CustomerContext.tsx`, `app/api/auth/customer`, `lib/customer/api.ts`, `lib/password.ts` | Email/password + magic link. Unified `customers` table (customers, affiliates, staff, warehouse all live here). `active=false` bans login. |
| **RBAC & route guards** | `lib/permissions.ts`, `lib/hooks/usePermissions.ts`, `components/RouteGuard.tsx`, `app/(admin)/admin/layout.tsx` | Role enum, page-access gating, server re-verification pattern. |
| **Audit log** | `lib/admin/audit.ts`, `audit-log-migration.sql` | Append-only `audit_log` (actor, action, entity, payload). Written by API routes; RLS read for admin/assistant. No viewer UI. |
| **Email / notifications** | `lib/email.ts`, `lib/email-smtp.ts`, `lib/invoice-email-templates.ts` | SMTP primary, Resend fallback. Senders: order confirmation, shipping notice, customer welcome, affiliate welcome, payment confirmed, admin payment notice, customer invoice, admin invoice copy, magic link. |
| **Settings (`site_settings` singleton)** | `app/api/admin/settings`, `lib/invoice-email-templates.ts` | Checkout type, admin/CC emails, pickup address, guest-checkout toggle, EasyShip config, auto-shipment toggles, shipping origin/box/rates. |
| **Shipping (EasyShip)** | `lib/shipping/easyship.ts`, `lib/shipping/auto-shipment.ts`, `lib/shippingStatus.ts`, `app/api/webhooks/easyship`, `app/api/cron/check-payments` | Live rates, shipment create, label buy/poll, tracking webhooks, background auto-create/auto-buy. |
| **Products data** | `app/api/products`, `products-schema.sql`, `product-sku-migration.sql` | `products.stock_quantity` is the live stock column (`stock_qty` vestigial). Merges customer price overrides. |
| **Toasts / loaders / i18n** | `contexts/ToastContext.tsx`, `components/PeptideLoader.tsx`, `components/LoadingFeedback.tsx`, `contexts/LanguageContext.tsx`, `lib/i18n.ts` | i18n (EN/FR) scaffolded but not wired into checkout/orders. |
| **Crypto payment infra (disabled)** | `contexts/Web3Provider.tsx`, `lib/wagmi.ts`, `lib/crypto-wallets.ts`, `lib/payment-monitor.ts`, `lib/price-feed.ts`, `lib/paymentMethod.ts` | BTC/ETH/SOL HD-wallet + chain monitoring exists; `/api/orders` POST returns 410. Live checkout uses Interac e-Transfer. |

---

# 1. CUSTOMER

Public storefront + logged-in customer account. ~37 distinct features.

## A. Public storefront & shopping
| # | Feature | What it does | Key files |
|---|---------|--------------|-----------|
| C1 | **Product catalog / browsing** | All active peptides; 10 categories; search by name/desc/category; purity badges, stock display (out-of-stock sinks to bottom), COA files, box imagery. | `app/products/page.tsx`, `app/api/products/route.ts` |
| C2 | **Product detail page** | Pack-size selection (single vial vs pack-of-10, pro-rata pricing), qty selector, COA downloads, benefits, mechanism of action, cross-sell (Bacteriostatic Water), quality certs, related products, "research only" notice. | `app/products/[slug]/page.tsx` |
| C3 | **Featured products** | Homepage carousel, in-stock only, 8 items, customer-specific pricing. | `app/api/products/featured/route.ts`, `components/Products.tsx`, `components/Hero.tsx` |
| C4 | **Shopping cart** | Per-line uniqueness by product + pack size; qty by pack increments; clear cart; sticky order summary; nav badge. localStorage persistence (`northern_peptides_cart`). | `app/cart/page.tsx`, `contexts/CartContext.tsx` |
| C5 | **Add-to-cart modal** | Pack-size + qty stepper, per-vial/line pricing, image swap, added confirmation. | `components/AddToCartModal.tsx` |
| C6 | **Stock "notify me"** | Email waitlist for out-of-stock products; subscribe/check/unsubscribe; compact + full-width variants; prefill for logged-in users. | `components/NotifyMeButton.tsx`, `app/api/stock-notifications/route.ts` |
| C7 | **Referral capture** | Invisible `?ref=` capture → localStorage, bound to account at signup (first-touch). | `components/ReferralCapture.tsx`, `lib/affiliate/referral.ts` |
| C8 | **Age verification** | 19+ gate, 30-day localStorage expiry, decline → redirect away. | `components/AgeVerification.tsx` |
| C9 | **Global UI** | Navigation (cart badge, account menu), Hero, Features/trust badges, Footer, ProductTicker, ChatBubble (WhatsApp + email), Contact page. | `components/Navigation.tsx`, `Features.tsx`, `Footer.tsx`, `ProductTicker.tsx`, `ChatBubble.tsx`, `app/contact/page.tsx` |

## B. Checkout & payments
| # | Feature | What it does | Key files |
|---|---------|--------------|-----------|
| C10 | **Checkout (email/invoice flow)** | Two-step: (1) shipping w/ address autocomplete + fulfillment-type selector; (2) payment via **Interac e-Transfer** with referral-code field, live shipping rates, order summary, e-Transfer QR. Per-IP rate limit. Sends confirmation + invoice email. | `app/checkout/page.tsx`, `app/checkout-email/page.tsx`, `app/api/orders-email/route.ts` |
| C11 | **Shipping rate calc** | Live EasyShip rates (debounced on postal code), sorted cheapest-first, flat-rate fallback. | `app/api/shipping/rates/route.ts`, `lib/shipping/easyship.ts` |
| C12 | **Address autocomplete** | Photon/OpenStreetMap, Canada-only, province→code, keyboard nav, debounce, graceful text fallback. | `components/AddressAutocomplete.tsx`, `app/api/shipping/address-autocomplete/route.ts` |
| C13 | **Pickup fulfillment** | Free local pickup option; disables address; `fulfillment_type='pickup'`. | `app/checkout/page.tsx` |
| C14 | **Order success / tracking** | Confirmation w/ order #, copy button, items, e-Transfer instructions + QR, status timeline, tracking link. `/order/track` redirects to dashboard. | `app/order/success/page.tsx`, `app/order/track/page.tsx` |
| C15 | **QR code** | Renders Interac e-Transfer / referral QR codes. | `components/QRCode.tsx` |

## C. Customer account & auth
| # | Feature | What it does | Key files |
|---|---------|--------------|-----------|
| C16 | **Sign-up** | Email/password + first/last name; email confirmation; referral binding; password match indicator. | `app/(customer)/signup/page.tsx`, `lib/customer/api.ts` |
| C17 | **Login** | Role-based redirect (warehouse→/warehouse, etc.), deactivation check, password toggle, `?redirect=`. | `app/(customer)/login/page.tsx` |
| C18 | **Forgot / set password** | Supabase recovery email (never reveals account existence); set-password page with strength rules + expiry check + role-based destination. | `app/(customer)/forgot-password/page.tsx`, `app/(customer)/account/set-password/page.tsx` |
| C19 | **Account dashboard** | Editable profile + shipping address; recent orders w/ status badges; admin-dashboard button if staff; logout. | `app/(customer)/account/dashboard/page.tsx` |
| C20 | **Order history** | Paginated list: order #, date, status badge, total, tracking. | `app/(customer)/account/orders/page.tsx` |
| C21 | **Order detail** | Items, shipping address, totals, payment method, tracking link, invoice download (HTML), payment ref. Own-orders access control. | `app/(customer)/account/orders/[id]/page.tsx`, `app/api/orders/[id]/invoice/route.ts` |
| C22 | **Become-an-affiliate request** | Customer submits application (optional wallet + message). | `app/(affiliate)/affiliate/apply/page.tsx`, `app/api/affiliate-requests/route.ts` |

## D. Customer-facing infra
`CartContext`, `CustomerContext`, `ToastContext`, `LanguageContext`, `Web3Provider`,
`RouteGuard`, `PeptideLoader`, `LoadingFeedback`. Order API: `app/api/orders`,
`app/api/orders/my-orders`, `app/api/orders/check-payment`, `app/api/orders-email`.

---

# 2. CLIENT (Affiliate / B2B Partner)

B2B resellers. They have a thin dedicated portal **and** scoped access inside `/admin`.
> ⚠️ The existing `docs/module-ports/` set **excludes** affiliate logic. If a sibling site
> does NOT want a partner program, strip everything in this section. If it does, this is
> the full surface.

## A. Onboarding (apply / approve / create / login)
| # | Feature | What it does | Key files |
|---|---------|--------------|-----------|
| L1 | **Application & approval workflow** | Customer applies → pending queue → admin approves/denies; decision emails; approval generates referral code. | `app/(affiliate)/affiliate/apply`, `app/api/affiliate-requests`, `app/api/admin/affiliate-requests/[id]` |
| L2 | **Admin-created affiliate** | Admin provisions affiliate directly: auto-confirmed auth user, 8-char referral code, linked `sales_persons` row, magic-link to set password. | `app/api/admin/affiliates/route.ts`, `app/(admin)/admin/affiliates/_components/CreateAffiliateModal.tsx` |
| L3 | **Login / session** | Uses unified customer auth; `/affiliate/login` → `/login?redirect=/admin`. | `contexts/AffiliateContext.tsx` (legacy), Supabase auth |

## B. Portal / dashboard (rendered inside `/admin`)
| # | Feature | What it does | Key files |
|---|---------|--------------|-----------|
| L4 | **Affiliate dashboard** | Minimized `/admin` home: referral code + copyable link, bound-customer count, pending/paid earnings, quick links. | `app/(admin)/admin/_components/AffiliateDashboard.tsx`, `app/api/affiliate/me/route.ts` |
| L5 | **Referral code management** | View/share unique active code + URL, usage count, status. | `app/(affiliate)/affiliate/code`, `lib/affiliate/api.ts`, `lib/affiliate/utils.ts` |

## C. Referral & commission system
| # | Feature | What it does | Key files |
|---|---------|--------------|-----------|
| L6 | **Attribution & commission calc** | Bound customer > referral code priority; self-referral blocked; **10% customer discount** + **10% affiliate commission** on discounted subtotal (constants in code); first-touch persistence (localStorage + 10-yr cookie). | `lib/affiliate/commission.ts`, `lib/affiliate/referral.ts` |
| L7 | **Commission ledger** | Two sources — "referral" (customer orders via code) + "sales" (invoices affiliate is sales-person on); statuses pending/paid/cancelled; totals. | `app/api/affiliate/commissions/route.ts`, AffiliateDashboard CommissionsTab |
| L8 | **Bound-customer management** | View/create customers auto-bound to the affiliate; revenue per customer. | `app/api/admin/customers/route.ts` (scoped) |

## D. Affiliate-scoped admin access
`AFFILIATE_PAGES` = `/admin`, `/admin/orders`, `/admin/invoices`, `/admin/customers`,
`/admin/pricing`, `/admin/products`. Nav filtered + bounced at the layout.
- **Orders / customers / invoices** — scoped server-side to the affiliate's bound customers.
- **Invoices** — affiliates can **create + edit + email + PDF** their customers' invoices; **cannot delete or record payments** (`canEditInvoice` true, `canDelete`/payments admin-only).
- **Products / pricing** — **read-only** global catalog (`canCreate/Edit/Delete` false for affiliate).

## E. Affiliate pricing & discounts
| # | Feature | What it does | Key files |
|---|---------|--------------|-----------|
| L9 | **Affiliate custom pricelist** | `affiliate_price_overrides` (affiliate_id, product_id, override_price). When a customer is bound, the affiliate's overrides are copied into that customer's `customer_price_overrides`. | `affiliate-pricelist-migration.sql`, `app/api/admin/customers/route.ts` |
| L10 | **Order discount tracking** | 10% discount stored on order/invoice for audit. | `affiliate-discount-commission-migration.sql`, `customer-pricing-migration.sql` |

**Admin-side management of affiliates** (list, create, edit, delete, toggle, approve/deny,
performance, reports): `app/(admin)/admin/affiliates`, `app/api/admin/affiliates/*`,
`app/api/admin/affiliate-requests/*`, `app/api/admin/affiliate-performance`,
`app/api/admin/commissions/*`. SQL: `affiliate-program-migration.sql`.

---

# 3. ADMIN (`admin` + `assistant`)

Back-office. 16 modules across 40+ pages and 50+ API routes.
**`admin`** = full CRUD + settings. **`assistant`** = read-only on most pages (no Users page;
view-only Settings/Templates). Every route re-verifies role server-side via Bearer token.

| # | Module | What it does | Key files | admin / assistant |
|---|--------|--------------|-----------|-------------------|
| A1 | **Dashboard** | Stat cards (revenue, pending orders, affiliates, pending commissions), recent orders, low-stock alerts, fulfillment + auto-shipment failure feeds. | `app/(admin)/admin/page.tsx`, `lib/admin/api.ts`, `_components/FulfillmentAlerts`, `AutoShipmentAlerts` | full / read |
| A2 | **Orders** | List (search/filter/paginate, status workflow), detail (items, address, tracking editor, commission, auto-shipment report), email actions, **EasyShip label panel** (rates, create shipment, buy/download label, edit address, readiness check). | `app/(admin)/admin/orders/*`, `_components/ShippingLabelPanel.tsx`, `app/api/admin/orders/*` | full / read |
| A3 | **Invoices** | Create/edit (customer picker, sales-person + auto commission %, line builder w/ pricelist pricing + stock badge, tax %, shipping, dates, notes), **split-on-backorder**, send email (editable To + CC defaults + template preview + PDF attach), **record payment** (methods, overpayment guard, auto status, stock-decrement RPC), aging report, status workflow, PDF view/download. | `app/(admin)/admin/invoices/*`, `components/admin/InvoiceForm.tsx`, `app/api/admin/invoices/*`, `lib/admin/invoice-*.ts`, `lib/invoice-pdf.ts` | full / read |
| A4 | **Products** | Table w/ **inline edit** (price/stock/threshold), color-coded stock, search/paginate; create/edit modal (image upload, COA multi-upload, slug auto-gen, featured/active); **restock-notify confirmation** modal; **CSV import** (2-step preview/apply). | `app/(admin)/admin/products/page.tsx`, `app/api/admin/products/*`, `lib/admin/low-stock.ts` | full / read |
| A5 | **Pricing & pricelists** | (a) **Pricelists** tab in Invoices — switchable lists, set-active drives invoice defaults, seed/copy. (b) **Customer price overrides** page — per-customer/per-product overrides, single + bulk add, CSV import/export. | `components/admin/PricelistsTab.tsx`, `app/api/admin/pricelists/*`, `app/(admin)/admin/pricing/*`, `app/api/admin/price-overrides/*` | full / read |
| A6 | **Customers** | List (search/filter/stats), create/edit (names, email, phone, pickup/shipping toggles, active), **send magic link**, delete (cascade), CSV report. | `app/(admin)/admin/customers/page.tsx`, `app/api/admin/customers/*` | full / read |
| A7 | **Purchase orders** | List (value cards, filter/search), create (supplier picker+inline create, product toggles, line items, tax %/fixed, expected date, **backorder prefill** via `?backorder=`), detail w/ **per-line receiving** + progress + history timeline, edit, mark paid/cancel, **PO PDF**. | `app/(admin)/admin/purchase-orders/*`, `app/api/admin/purchase-orders/*`, `lib/admin/purchase-orders.ts`, `po-status.ts` | full / read |
| A8 | **Suppliers + supplier pricelists** | Supplier master CRUD; supplier price lists + cheapest-price lookup. | `app/api/admin/suppliers/*`, `app/api/admin/supplier-prices/*`, `app/(admin)/admin/purchase-orders/suppliers`, `supplier-pricelists` | full / read |
| A9 | **Backorders** | Open/History tabs; "Fulfill" deep-links to PO create prefilled; links to fulfilling PO. | `app/(admin)/admin/backorders/page.tsx`, `app/api/admin/backorders/*`, `lib/admin/backorder-sync.ts` | view + fulfill / view |
| A10 | **Stock requests** | Products with pending "notify me" requests, most-wanted first; link to restock; drives back-in-stock emails. | `app/(admin)/admin/stock-requests/page.tsx`, `app/api/admin/stock-notifications` | view / view |
| A11 | **Analytics** | Date-ranged: inventory value + low/out-of-stock counts, incoming-PO value, revenue (invoiced/paid/outstanding/overdue). | `app/(admin)/admin/analytics/page.tsx`, `app/api/admin/analytics/summary`, `lib/admin/analytics.ts` | view / view |
| A12 | **Sales people** | CRUD internal reps (commission rate, active), live earned stats from `sales_commissions`. | `app/(admin)/admin/sales-people/*`, `app/api/admin/sales-persons/*`, `lib/admin/sales-persons.ts` | full / read |
| A13 | **Commissions** | Unified affiliate+sales ledger; filter/search/paginate; **mark paid**; CSV export. Sales commission auto-created on invoice w/ rate snapshot. | `app/(admin)/admin/commissions/page.tsx`, `app/api/admin/commissions/report` | mark-paid / read |
| A14 | **Affiliates (mgmt)** | List/create/edit/delete/toggle affiliates, performance metrics, approve/deny requests. *(Strip if no partner program.)* | `app/(admin)/admin/affiliates/*`, `app/api/admin/affiliates/*`, `affiliate-requests` | full / read |
| A15 | **Users & roles** | Staff CRUD (role dropdown customer/assistant/admin, password, active = Auth ban/unban), admin-only page. RBAC + nav filtering + audit infra. | `app/(admin)/admin/users/*`, `app/api/admin/users/*`, `lib/permissions.ts`, admin `layout.tsx` | admin only / no access |
| A16 | **Settings + email templates** | Checkout type, admin/CC emails, pickup address, guest-checkout toggle (auto-save); EasyShip config + auto-shipment toggles; **invoice email template editor** w/ merge-var chips + live preview (admin edit, assistant read-only). | `app/(admin)/admin/settings/*`, `app/api/admin/settings`, `lib/invoice-email-templates.ts` | full / read |
| A17 | **Shipping/fulfillment integration** | Manual + auto shipping label flow, tracking webhooks, payment-check cron. | `app/api/admin/orders/[id]/{rates,create-shipment,buy-label,label,label-readiness,shipping-address}`, `app/api/admin/shipping/diagnose`, `app/api/webhooks/easyship`, `app/api/cron/check-payments`, `lib/shipping/*` | full / read |
| A18 | **Warehouse (admin view)** | Manage warehouse staff accounts, per-person performance, email-send permission toggle, live activity log. | `app/(admin)/admin/warehouse/page.tsx`, `app/api/admin/warehouse/activity`, `lib/admin/warehouse-staff.ts` | full / view |
| A19 | **Audit & permissions** | Append-only `audit_log` written by routes; RLS read for admin/assistant; no viewer UI. | `lib/admin/audit.ts`, `audit-log-migration.sql` | read / read |

**Cross-module wiring:** active pricelist → invoice prices; invoice split → backorders →
PO create; full payment → `adjust_stock_for_invoice` RPC; PO receiving → stock increment;
restock 0→+ → `stock_notifications` emails; invoice send → `site_settings` CC + templates.

---

# 4. WAREHOUSE (`warehouse`)

Dedicated `/warehouse` portal for fulfillment staff (admins can view it too).

## A. Fulfillment queue
| # | Feature | What it does | Key files |
|---|---------|--------------|-----------|
| W1 | **Live queue dashboard** | All non-draft invoices, sorted active-first, **Supabase Realtime** updates; filter by fulfillment type (shipment/pickup) + label status; summary metrics; new-order badges. | `app/(warehouse)/warehouse/page.tsx`, `_components/QueueRow.tsx`, `app/api/warehouse/queue/route.ts` |
| W2 | **Order detail pane** | Customer info, shipping address + tracking, fulfillment type, items, checklist, packed photos, packed/fulfilled-by attribution, notify buttons. | `_components/QueueDetail.tsx`, `lib/warehouse/api.ts` |

## B. Packing & checklist
| # | Feature | What it does | Key files |
|---|---------|--------------|-----------|
| W3 | **Fulfillment status workflow** | Pending → Packed → Shipped (shipments) / Picked Up (pickups); timestamps + attribution; syncs linked order status; optimistic UI; audited. | `app/api/warehouse/queue/[id]/route.ts`, `lib/warehouse/api.ts` |
| W4 | **Handling checklist** | Method-aware 3-step checklist (shipment vs pickup) persisted as `handling_checklist` JSON; current-step highlight. | `_components/QueueDetail.tsx`, `app/api/warehouse/queue/[id]/checklist/route.ts` |
| W5 | **Per-line fulfill / backorder** | Mark line items fulfilled or backordered in partial qty; backorders move to a single non-payable draft child invoice (`parent_invoice_id`); totals auto-recompute; progress badges. | `_components/QueueDetail.tsx`, `app/api/warehouse/queue/[id]/line/route.ts` |
| W6 | **Packed-photo capture** | Device camera capture or file upload (JPEG/PNG/WebP/HEIC, ≤20MB) → Supabase Storage (`packing/<invoice>/...`); gallery + per-photo delete; persisted as JSON on invoice. | `_components/QueueDetail.tsx`, `app/api/warehouse/queue/[id]/photo/route.ts` |

## C. Shipping & labels (EasyShip)
| # | Feature | What it does | Key files |
|---|---------|--------------|-----------|
| W7 | **Label status visibility** | See label state (not_created/pending/generated/failed), download ready PDF, filter queue by label status. Label *creation* is admin-only. | `_components/QueueDetail.tsx`, `app/(warehouse)/warehouse/page.tsx` |
| W8 | **Auto-create / auto-buy shipment** | Best-effort background: create draft shipment on order, optionally buy label on paid invoice; courier preference (cheapest/UPS/FedEx); per-order status + `shipment_auto_logs`. Errors swallowed (never blocks checkout). | `lib/shipping/auto-shipment.ts`, `lib/shipping/easyship.ts`, `easyship-auto-shipment-migration.sql` |
| W9 | **Tracking webhooks** | EasyShip POST → updates tracking fields, advances order to shipped/delivered (never downgrades); optional HMAC verification. | `app/api/webhooks/easyship/route.ts` |

## D. Notifications & activity
| # | Feature | What it does | Key files |
|---|---------|--------------|-----------|
| W10 | **Fulfillment emails** | Templated packed/shipped (+ pickup variants) emails w/ merge vars; preview/edit modal; per-send `fulfillment_email_log`; gated by `can_send_fulfillment_emails` (admins always). | `components/FulfillmentEmailModal.tsx`, `app/api/warehouse/queue/[id]/notify/route.ts` |
| W11 | **Activity audit logging** | `invoice.fulfillment_update`, `handling_checklist_update`, `line_fulfill`, `line_backorder`, `packed_photo_add/remove`, `fulfillment.email_sent` → `audit_log`; feeds admin performance dashboard. | `lib/admin/audit.ts` |
| W12 | **Stock decrement on fulfillment** | Stock decrements coordinated with fulfillment to keep inventory accurate. | `stock-decrement-migration.sql` |

**Warehouse schema additions:** `customers.can_send_fulfillment_emails`;
`invoices.{fulfillment_type, fulfillment_status, handling_checklist, packed_photos,
packed_at, packed_by, fulfilled_at, fulfilled_by, packed_emailed_at, shipped_emailed_at,
non_payable, parent_invoice_id}`; `invoice_line_items.{qty_fulfilled, qty_backordered}`;
`orders.{easyship_shipment_id, tracking_*, carrier, label_state, label_url,
auto_shipment_*}`; tables `fulfillment_email_log`, `shipment_auto_logs`.
SQL: `warehouse-activity/-emails-orders/-fulfillment/-packing-checklist-migration.sql`,
`easyship-*-migration.sql`.

---

## Recommended porting order (dependency-first)

1. **Shared infra** — Supabase auth + `customers` table + `user_role` enum, RBAC/route
   guards, audit log, `site_settings`, email infra.
2. **Products** (public + admin) — owns `products` schema.
3. **Pricing & pricelists** + customer price overrides.
4. **Customer** storefront + accounts + cart/checkout/orders.
5. **Invoices** (depends on products, pricing, customers, email, settings).
6. **Inventory/backorders + purchase orders & suppliers.**
7. **Warehouse** portal (depends on invoices + shipping).
8. **Sales people + commissions** → **analytics**.
9. **Client/Affiliate** program — *optional*; strip entirely if the sibling site has no
   partner program (touches pricing scoping, invoice access, RBAC enum, commissions, emails).

> See `docs/module-ports/00-index.md` and `01`–`12` for deep per-module data-model / API /
> UI specs (that set deliberately excludes the affiliate program and the core shopping flow).
