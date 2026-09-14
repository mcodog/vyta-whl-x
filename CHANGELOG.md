# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **PuraMass hosted checkout — new payment processor (opt-in)**
  - Added the PuraMass hosted checkout (Stealth Health partner API) as an admin-toggleable alternative to the in-house email/invoice checkout. When enabled, the storefront hands the cart off to PuraMass (POST the cart SKUs → receive a `payment_link` on `app.puramass.com` → redirect); PuraMass re-reads its own prices and owns payment, fulfilment, and order emails. Off by default and fully reversible
  - Server-only API client + strength-anchored SKU matcher: `lib/payments/puramass.ts`, `lib/payments/puramass-catalog.ts` (+ tests). Credentials come from env (`PURAMASS_API_KEY`, `PURAMASS_PARTNER_ID`, `PURAMASS_API_BASE_URL`) and are never exposed to the browser
  - Migration `puramass-hosted-checkout-migration.sql`: `products.puramass_sku`, `site_settings.puramass_checkout_enabled`, and a `puramass_orders` hand-off ledger (RLS + trigger)
  - Routes: `POST /api/checkout/puramass` (maps cart → `puramass_sku`, creates the order, records the hand-off, never trusts client prices/SKUs) and admin-only `POST /api/admin/puramass/sync-skus` (auto-fills SKUs from the live catalog with a matched/ambiguous/unmatched report)
  - UI: admin Settings "PuraMass Checkout" section (enable toggle, credential-status banner, SKU sync) and a storefront `PuramassCheckoutContent` screen
  - Trade-offs (hand-off model): per-customer CAD pricing / pricelists / affiliate discounts / free-shipping and the in-house warehouse/invoice flow are bypassed for these orders; no payment-status webhook exists, so live status lives in the PuraMass portal
  - Docs: `docs/PURAMASS_HOSTED_CHECKOUT.md`

- **PuraMass hosted checkout — live payment status (webhook + polling)**
  - Added a signed webhook receiver `POST /api/webhooks/stealth-health` for the `store_order.payment_complete` event: verifies the `X-Stealth-Signature` HMAC-SHA256 over the raw body (`PURAMASS_WEBHOOK_SECRET`), dedupes on `event_id`, and updates the matching `puramass_orders` row's `status`/`paid_at` by `transaction_id` or `partner_reference`, ACKing 2xx within the 10s window
  - Added polling fallback: `fetchPuramassOrderStatus` (`GET /partner/store/orders/{transaction_id}`), an admin endpoint `POST /api/admin/puramass/orders/refresh`, and a per-row **Refresh** button on the PuraMass Orders page (also backfills events that fired before the webhook URL was registered)
  - Migration `puramass-webhook-status-migration.sql` adds `paid_at`, `currency`, `last_event_id` to `puramass_orders`; the ledger now shows paid state and the `paid` date
  - New env var `PURAMASS_WEBHOOK_SECRET` (server-only); register `<base>/api/webhooks/stealth-health` with PuraMass

- **PuraMass hosted checkout — single-vial SKUs**
  - Added `products.puramass_sku_vial` (migration `puramass-vial-sku-migration.sql`) so a product maps to both a 10-pack SKU (`…-10-pack`) and a single-vial SKU (`…-vial`)
  - The SKU sync now fills **both** columns — it splits the catalog into 10-pack and vial sets (live catalog by SKU suffix, or bundled snapshots) and reports matches per mapping; the admin panel shows separate 10-pack / single-vial results
  - The checkout hand-off now sends the **correct SKU per cart line**: a single-vial line (`packSize` 1) hands off `puramass_sku_vial` with quantity = vials; a 10-pack line hands off `puramass_sku` with quantity = packs. Unmapped single-vial lines are surfaced tagged `(single vial)`
  - Bundled the 125-item single-vial catalog snapshot; both routes fall back to box-only if the vial migration hasn't run

- **PuraMass checkout — bacteriostatic water upsell**
  - Added a "Complete your order" upsell (products flagged `is_checkout_addon`, e.g. bacteriostatic water) to the PuraMass checkout screen. Each tile opens the existing single-vial / pack-of-10 + quantity modal, so the shopper picks the form and amount before it's added to the cart
  - The upsell ignores the store's own stock (PuraMass fulfils these), and a note states the total is calculated and charged in **USD** on the hosted checkout page
  - Only fulfillable forms are offered: a form is shown only when its PuraMass mapping is a valid SKU (10-pack ends `-10-pack`, vial ends `-vial`) — so a product with only a valid vial SKU offers the single vial and hides the case, and a product with neither is hidden entirely (`AddToCartModal` gained an `allowedPackSizes` prop)

- **PuraMass hosted checkout — config-file kill switch**
  - Added `puramass.config.ts` (`PURAMASS_CHECKOUT_ENABLED`), a hard master switch. When off, the storefront falls back to the in-house checkout, `/api/checkout/puramass` refuses new orders (403), and the admin Settings toggle reads as off and is disabled — overriding the DB toggle and credentials. The env var `PURAMASS_CHECKOUT_ENABLED=false` forces it off too (takes precedence). The in-flight payment webhook is intentionally not gated, so already-handed-off orders can still be marked paid/fulfilled

- **PuraMass / Stealth Health — raw webhook event log**
  - Added `puramass_webhook_events` (migration `puramass-webhook-events-migration.sql`): the webhook endpoint now records **every** delivery it receives — including invalid-signature and unmatched events — with the parsed payload, signature-valid flag, matched flag, outcome (`processed`/`duplicate`/`ignored`/`unmatched`/`invalid_signature`/`not_configured`/`invalid_json`/`error`), HTTP status, and raw body. Logging is best-effort and never affects order processing or the ACK. Useful for confirming Stealth Health is actually hitting the URL and debugging why an event wasn't applied

- **PuraMass hosted checkout — orders land in the fulfillment queue**
  - When the Stealth Health webhook confirms payment (`store_order.payment_complete`), a fulfillment invoice is created (source `stealth_health`, status paid, fulfilment pending) so the items appear in the warehouse queue. Line items come from the paid webhook items, mapped back to storefront products by SKU. Idempotent (one invoice per order, linked via `puramass_orders.invoice_id`)
  - The queue row and detail panel show a **"Stealth Health"** badge, and fields a normal invoice would have but a hosted-checkout order doesn't (customer name/phone, shipping address) show a tooltip explaining they're managed by Stealth Health
  - Migration `puramass-fulfillment-invoice-migration.sql` adds `invoices.source` and `puramass_orders.invoice_id`

- **Admin dashboard — analytics widgets, corrected KPIs, compact bento**
  - Five new widgets: **Top affiliates by commission** (top-5 bar chart, paid vs pending, combining referral + invoice commission ledgers per affiliate), **Revenue breakdown** (paid vs outstanding from the invoice book), **Most-ordered products** (top-5 by units), a **Warehouse activity live tail** (compact feed of packs/ships/queue actions, auto-refreshing every 20s from the audit log), and **Revenue by month** (full-width **line chart** of the last 12 months — Paid solid + Invoiced dashed, inline SVG). All charts are hand-built (no chart lib) and stay on the bronze palette — paid = solid bronze, pending/secondary = light bronze, identity via labels + legend
  - **KPI cards re-wired.** The old **Total Revenue** summed `orders.total` across all orders (incl. cancelled/unpaid) → replaced with **Paid revenue** + **Outstanding** from the invoice book (same math as Analytics). The old **Pending Commissions** summed only referral → now sums pending across **both** ledgers (referral + invoice, reps included). New strip: Paid revenue · Outstanding · New customers (this month) · Pending commissions
  - New `GET /api/admin/dashboard/overview` (service-role, admin/assistant) computes the KPIs + three charts in one call; `lib/admin/authed-fetch.ts` shared bearer-token GET helper
  - **Guides** moved from a bottom card section to a **slim single-row strip at the top** (apparent but low-focus); `GuidesPanel.tsx` removed for `GuidesStrip.tsx`
  - Page re-laid as a compact **bento** (KPI strip → charts row → needs-attention → warehouse tail + recent orders) with tighter spacing, a slim "all caught up" state and a compact recent-orders list — far less scrolling
  - Changelog: `changelogs/2026-08-12-dashboard-analytics-and-compact.md`
  - Files: `app/api/admin/dashboard/overview/route.ts`, `app/(admin)/admin/_components/{DashboardOverview,WarehouseTail,GuidesStrip}.tsx`, `app/(admin)/admin/page.tsx`, `app/(admin)/admin/_components/{NeedsAttention,CollapsibleAlert}.tsx`, `lib/admin/authed-fetch.ts`

- **Admin dashboard remodel + Guides wiki**
  - The admin **Dashboard** is reorganized and re-skinned to the site palette. Full color-fill boxes (the red auto-shipment banner, the amber low-stock banner, and the emerald/blue/purple stat-icon chips) are replaced with **white cards on the neutral line color**; off-palette colors (red/amber/status hues) now appear **only as accents** — an icon, a count, or a status dot — never as a filled background
  - **Needs attention**: products to restock and auto-shipment failures — previously two separate, collapsed banners — are now one **Needs attention** section rendering the items **inline** in a responsive two-column grid, each card previewing 5 items with a **View all** link, plus a stable "You're all caught up" state. Admins keep the per-row **dismiss** and **clear all** actions on failures; rows still link to the order/products
  - **Stat cards** now use the single **bronze** palette accent for all four icons; **Recent Orders** status pills become a neutral pill with a small colored **status dot** (the only accent)
  - New **Guides & How-tos** wiki at `/admin/guides` (index) and `/admin/guides/[slug]` (reader), a **Help › Guides** sidebar item, and a featured guides section on the dashboard. Content lives in a hand-authored registry (`lib/admin/guides.tsx`); seeded with four guides across two categories — **How to set up an affiliate**, **Affiliate vs. Sales Person** (with a comparison table), **How to set up pricing for a customer**, and **How to set up pricing for affiliates** (the pricing guides spell out the implications: template vs. dedicated stickiness, snapshot-not-live applies, the per-use convert rate vs. the global FX rate, locked affiliate invoice prices, and the two synced affiliate lists). Admin/assistant only
  - Changelog: `changelogs/2026-08-12-dashboard-remodel-and-guides.md`
  - Files: `app/(admin)/admin/page.tsx`, `app/(admin)/admin/_components/{NeedsAttention,GuidesPanel,CollapsibleAlert,FulfillmentAlerts}.tsx` (removed `AutoShipmentAlerts.tsx`), `lib/admin/guides.tsx`, `app/(admin)/admin/guides/{page,[slug]/page}.tsx`, `app/(admin)/admin/layout.tsx`

- **Pricing: round re-priced numbers (nearest $5 / $10 / charm $9)**
  - The reusable "apply a price list" form gains a **rounding** step after the multiplier and the optional CAD→USD convert: snap each final price to the **nearest $5**, **nearest $10**, or a **charm price ending in 9** (…9, 19, 29), rounded **Higher** or **Lower**. **Off** keeps exact prices
  - Defaults to **Nearest $10 · Higher**. A live worked example (`e.g. $47 → $50`) and the shared preview show the exact numbers that will be written; rounding is applied server-side by the same helper, so preview == stored. A rounded apply is recorded as a **dedicated** price set and captured in the audit log (`round_to` / `round_dir`)
  - A positive price never floors to `$0` when rounding down. The control appears everywhere the pricing form is embedded (affiliate pricing tab, per-customer editor, customer create/edit modals)
  - Also: the **Pricing** tab on the sales-person / affiliate detail page now uses the full page width (dropped the `max-w-3xl` cap)
  - Changelog: `changelogs/2026-08-12-pricing-rounding-and-full-width-pricing-tab.md`
  - Files: `lib/pricing-transform.ts`, `lib/pricing-transform.test.ts`, `vitest.config.ts`, `app/api/admin/pricing/apply-transformed/route.ts`, `app/(admin)/admin/customers/_components/CustomerPricingPanel.tsx`, `app/(admin)/admin/sales-people/[id]/page.tsx`, `docs/adr/0006-pricing-multiplier-and-currency-convert-tool.md`

- **Price list: Preview & email (with a real PDF attachment)**
  - The **Price list** control on a sales-person or customer detail page gains a second action, **Preview & email**, alongside the existing **Download PDF**
  - Opens a modal (styled to the admin design system) with a **live preview of the exact PDF** that will be attached, an editable **To** (pre-filled with the current entity's email; add more recipients with commas, shown as chips), an optional **CC**, and a pre-generated but fully editable **Subject** and **Message**
  - The **Include inventory** toggle flows through: flipping it regenerates the preview and the attached PDF
  - The attachment is a real PDF rendered server-side with `pdfkit` (PURAMASS header, bronze accents, per-page footer — same visual language as the invoice PDF); the previous print-ready HTML download is unchanged
  - **Send history**: every send is recorded (success or failure) in a new `price_sheet_email_log` table, and the modal shows a per-entity history — when it was sent, who sent it, the recipients (To/CC), whether inventory was included, currency and product count. `entity_id` is polymorphic (customer or sales-person), disambiguated by `entity_type`; served by a `GET /api/admin/price-sheet/email` handler that degrades to an empty list if the migration hasn't been run
  - `lib/admin/price-sheet.ts` refactored to expose render-agnostic data (`buildPriceSheetData` / `PriceSheetData`) shared by the HTML view and the PDF; new `lib/admin/price-sheet-pdf.ts`; new routes `GET /api/admin/price-sheet/pdf` and `POST`/`GET /api/admin/price-sheet/email` (admin/assistant-only, Node runtime; the send regenerates the PDF server-side and is audit-logged as `price_sheet.emailed`)
  - Migration: `price-sheet-email-log-migration.sql` (run in the Supabase SQL editor)
  - Changelog: `changelogs/2026-08-11-price-sheet-email-and-inventory-checkbox.md`
  - Files: `app/(admin)/admin/_components/{PriceSheetButton,PriceSheetEmailModal}.tsx`, `app/api/admin/price-sheet/{pdf,email}/route.ts`, `lib/admin/price-sheet.ts`, `lib/admin/price-sheet-pdf.ts`, `price-sheet-email-log-migration.sql`, `app/(admin)/admin/sales-people/[id]/page.tsx`, `app/(admin)/admin/customers/[id]/page.tsx`

- **Products list: sortable ordering, alphabetical by default**
  - The admin Products table now defaults to **Name A–Z** (alphabetical), matching the downloadable Stock Report (`.order('name')`); it previously showed products newest-first (the API's `created_at DESC` order)
  - New **Sort** dropdown in the toolbar (between the CAD/USD toggle and **Columns**) with eight options across four fields: Name A→Z / Z→A, Price Low→High / High→Low, Stock Low→High / High→Low, and Recently added / Oldest first. The button shows the active sort ("Sort · Name A–Z") and the menu check-marks the current choice
  - Name sorts are case-insensitive and natural (numeric collation, so "B12"/"BPC-157" order sensibly), with a stable Name-A→Z tiebreak; price sorts follow the displayed CAD/USD currency; sorting composes with search and resets to page 1
  - The choice is persisted per browser (`localStorage`, key `aminocan.productTable.sort`); no schema or API changes (sorting is client-side)
  - Changelog: `changelogs/2026-08-11-product-list-sorting.md`
  - Files: `app/(admin)/admin/products/page.tsx`

- **Pricing: re-price a source with a multiplier + optional CAD→USD convert**
  - The "apply a price list" form (`CustomerPricingPanel`) can now pick a source that is either a saved **price list** or **another customer's** current custom prices, then re-price it before applying: a percentage **multiplier** toggle (25 / 50 / 75 / 100 / 150 / 200 / 300; 100 = unchanged) and, for CAD sources, a **Convert CAD → USD** toggle that divides by an editable, per-use rate (default `1.45` CAD per USD, i.e. `USD = CAD ÷ 1.45`). The per-use rate is deliberately separate from the site-wide FX rate in Site Settings
  - The transform is shared by the live preview and the server write (`lib/pricing-transform.ts`) so previewed numbers are exactly what gets stored; applying targets the customer/affiliate whose form it is
  - New admin route `app/api/admin/pricing/apply-transformed/route.ts` — the multiplier/convert superset of `apply-to-customer`; keeps template/dedicated tagging (ADR 0005), currency tagging, and affiliate list sync (ADR 0004) intact
  - The form is now also embedded on the per-customer pricing editor (`/admin/pricing/customer/[id]`) and, for affiliates, on the sales-person detail page under a new **Pricing** tab
  - New **Affiliate Pricing** tab on the Pricing page: each affiliate shown alongside the bound-customer prices their list drives, each with an **Edit pricelist** link
  - Customer Pricing cards: replaced the per-card **Add override** + **See all** with a single **Edit pricelist** action that opens the customer's full pricing editor
  - ADR: `docs/adr/0006-pricing-multiplier-and-currency-convert-tool.md`
  - Files: `lib/pricing-transform.ts`, `app/api/admin/pricing/apply-transformed/route.ts`, `app/(admin)/admin/customers/_components/CustomerPricingPanel.tsx`, `app/(admin)/admin/pricing/page.tsx`, `app/(admin)/admin/pricing/_components/{AffiliatePricingView,CustomerOverridesView}.tsx`, `app/(admin)/admin/pricing/customer/[id]/page.tsx`, `app/(admin)/admin/sales-people/[id]/page.tsx`

- **Payment links charge the invoice's own prices**
  - A card payment link (`POST /api/pay/:token/checkout`) now names its amounts on the Stealth Health order instead of letting PuraMass re-price it: each line sends `unit_price_cents` (the invoice line's `line_total` ÷ quantity, so a per-line discount is charged) and the order sends `shipping_total_cents` from the invoice's shipping — `0` where it ships free, which is what switches off PuraMass's default $35.00 rate. Per order only; nothing is saved as a new default for the SKU
  - Still no shipping address on the hand-off — PuraMass collects it on its own page
  - A line under the wholesale price PuraMass invoices us for is refused (`400 STORE_PRICE_BELOW_WHOLESALE`). The customer sees a plain "pay another way" message; the SKU and its floor go to the invoice's payment timeline for an admin, never to the customer. Amounts we can't legally send (negative, fractional, over $100,000) throw before the request rather than silently reverting to the catalog price
  - A pending payment link is now reused only while it still matches the invoice — edit an item, quantity, price, or the shipping and the next visit mints a fresh hand-off instead of charging the old total
  - The payment webhook records the order's grand total (shipping included) when the payload carries one, falling back to subtotal + shipping and then the ledger's subtotal
  - Migration `puramass-order-shipping-total-migration.sql` adds `puramass_orders.shipping_total_cents` (what we asked to be charged for shipping); the hand-off still records itself if the migration hasn't been run. The PuraMass Orders page shows each line's price
  - Tax and the processing fee are not expressible on a partner order, so an invoice carrying either is still charged its lines + shipping and shows as partially paid for an admin to reconcile
  - Files: `lib/payments/puramass.ts`, `lib/payments/invoice-payment.ts`, `app/api/pay/[token]/checkout/route.ts`, `app/api/webhooks/stealth-health/route.ts`, `app/(admin)/admin/puramass-orders/page.tsx`, `puramass-order-shipping-total-migration.sql`, docs

### Fixed

- **PuraMass SKU sync now skips inactive products**
  - The sync loaded every product, so deactivated ones (`active = false`, e.g. "Bacteriostatic Water Pfizer 30mL") were matched and cluttered the unmatched report. It now filters to `active = true`, matching the storefront's own product query
  - File: `app/api/admin/puramass/sync-skus/route.ts`

- **PuraMass SKU sync/hand-off could target a non-`puramass-` SKU**
  - The sync split the catalog only by suffix (`-vial` vs not), so the box matcher could land a storefront product on a legacy/general SKU that lacks the `puramass-` prefix (e.g. an old `bacteriostatic-water-10ml`, or general products like `tempramed-vivi-cap`)
  - The catalog is now filtered to real PuraMass SKUs before matching: a case/box must start `puramass-` and end `-10-pack` **or** `-case` (e.g. `puramass-bacteriostatic-water-30ml-case`); a single vial must start `puramass-` and end `-vial`. The hand-off route and the checkout-upsell gate enforce the same rule, so an invalid mapping is treated as unmapped rather than sent to PuraMass
  - The sync now also **auto-repairs** an existing non-`puramass-` value: it's treated as unset and rewritten to the correct `puramass-…` SKU on the next sync (no `overwrite` needed)
  - Files: `app/api/admin/puramass/sync-skus/route.ts`, `app/api/checkout/puramass/route.ts`, `app/checkout/page.tsx`

- **Price list "Include inventory" checkbox now toggles when you click the box**
  - In the Price list menu the custom `Checkbox` (a `<button>`) was nested inside another `<button>`, so clicking the box fired both handlers and cancelled out — only clicking the label text worked
  - The box and its label are now sibling controls (no nested interactive elements), so a click on either toggles exactly once; the toggle is also keyboard-operable
  - Files: `app/(admin)/admin/_components/PriceSheetButton.tsx`

- **Number inputs no longer show an unremovable placeholder `0`**
  - When creating invoice/purchase-order line items, the Qty / Unit $ / Disc % fields (and the Tax, Shipping, Processing fee, Discount, Commission, and Lead-time inputs) rendered a `0`/`1` bound to numeric state that couldn't be cleared — deleting it snapped straight back
  - Added a reusable `NumberInput` (`components/admin/NumberInput.tsx`) that represents an empty field as `null`: the field now starts blank, can be fully cleared, and still accepts partial decimal input (e.g. `1.`) while typing
  - Line-item and summary numeric state is now `number | null`; totals coerce a blank field to `0`, and on save Qty falls back to `1` and prices/rates to `0`, so behaviour is unchanged for filled-in forms
  - Files: `components/admin/NumberInput.tsx`, `components/admin/InvoiceForm.tsx`, `app/(admin)/admin/purchase-orders/PurchaseOrderForm.tsx`, `app/(admin)/admin/purchase-orders/suppliers/page.tsx`

- **Warehouse packed-photo upload — "Bucket not found"**
  - Warehouse packed-product photo upload/delete targeted a storage bucket that was never created (the only setup file, `storage-products-bucket-setup.sql`, is reference-only / marked "do not run"), so taking or uploading a photo failed with "Bucket not found"
  - Photos now use a dedicated public **`packages`** bucket (was defaulting to the shared `products` bucket); `WAREHOUSE_PHOTOS_BUCKET` still overrides it
  - Added `warehouse-packages-bucket-migration.sql` — a runnable, idempotent migration that creates the public `packages` bucket (and, where permitted, a public-read policy on `storage.objects`)
  - Files: `app/api/warehouse/queue/[id]/photo/route.ts`, `warehouse-packages-bucket-migration.sql`

- **Deactivated accounts can no longer log in**
  - Root cause: the login page called `supabase.auth.signInWithPassword` directly and redirected on any successful session without ever checking the `active` field on the `customers` row
  - Fix: after a successful auth, the login page fetches `active` from the `customers` table before proceeding. If `active === false`, it immediately calls `signOut()` and shows an error message
  - Race condition fix: `CustomerContext` detects the successful auth and can trigger the `useEffect` redirect before the `active` check completes. Added `verifyingActive` state that blocks the `useEffect` redirect while the check is in flight; only cleared after the check resolves
  - `app/api/auth/customer/route.ts` — returns 403 if `active === false`, blocking the admin panel login path and session restores
  - `lib/customer/api.ts` — `signInCustomer` also checks `active` and signs out if deactivated (covers any other callers)
  - `app/api/admin/users/[id]/route.ts` — PUT handler now calls `auth.admin.updateUserById` with `ban_duration: '876600h'` when deactivating and `'none'` when reactivating, blocking login at the Supabase Auth level in addition to the application-level checks
  - `lib/admin/api.ts` — `toggleUserActive` and the soft-delete branch in `deleteUser` now route through `PUT /api/admin/users/[id]` so the auth ban is always synced alongside the table update
  - Files modified: `app/(customer)/login/page.tsx`, `app/api/auth/customer/route.ts`, `lib/customer/api.ts`, `app/api/admin/users/[id]/route.ts`, `lib/admin/api.ts`

### Added

- **Affiliate ↔ customer de-duplication on create (detect & merge)**
  - An affiliate already owns a `customers` row (role `affiliate`) and can be invoiced like any customer (ADR 0003), so the same email landing on a separate plain-customer record splits one person's invoices, orders and prices across two records
  - **Creating a customer** whose email already belongs to an **affiliate** now stops and prompts to *use the existing affiliate record* instead of minting a duplicate — the entered contact info is folded into the affiliate's record (no new row). The invoice quick-add "new account" path surfaces the same collision and points the user at the picker
  - **Creating an affiliate** whose email already belongs to a **customer** now prompts to merge: a customer with a login is **promoted in place** (role → `affiliate`, keeping their id/login and all history); a guest customer is **folded into the new affiliate** (invoices/orders/prices re-pointed, then the duplicate removed)
  - New `merge_customer_records(source, target)` SQL function (+ matching app-side fallback in `lib/admin/customer-merge.ts`) re-points every customer-owned table (invoices, orders, price overrides, ship-to clients, carts, waitlist, affiliate requests, inactive-notification log) with proper unique-constraint handling, back-fills missing profile fields, then deletes the duplicate
  - **Backfill migration** `user-dedup-affiliate-customer-merge-migration.sql` reconciles existing same-email affiliate/customer pairs (idempotent)
  - Files: `app/api/admin/customers/route.ts`, `app/api/admin/affiliates/route.ts`, `lib/admin/customer-merge.ts`, `lib/admin/api.ts`, `components/admin/InvoiceForm.tsx`, `app/(admin)/admin/customers/_components/CreateCustomerModal.tsx`, `app/(admin)/admin/affiliates/_components/CreateAffiliateModal.tsx`, `user-dedup-affiliate-customer-merge-migration.sql`

- **Products Report — "Affiliate" pricing source**
  - The Customize Report modal's *Pricing source* now has a third tab, **Affiliate**, alongside General and Customer: price the report from a chosen affiliate's price list (`affiliate_price_overrides`). Any product the list doesn't set keeps its catalog price, and the report names the source and its currency
  - Added `GET /api/admin/affiliates` (admin/assistant) returning affiliates with their price-list size and currency for the picker
  - Files: `app/(admin)/admin/products/page.tsx`, `app/api/admin/products/report/route.ts`, `app/api/admin/affiliates/route.ts`

- **Fulfillment queue — views, remove/restore & draft handling**
  - Split the queue into two views: **To Fulfill** (active) and **Fulfilled / Removed** (archive), each with a live count. Fulfilling an order now moves it out of the active view instead of lingering dimmed in the same list
  - **Remove from queue** button on the order detail (with a **Restore to queue** action in the archive) so cancelled/on-hold orders can be taken out of the active queue; backed by a new `removed_from_queue` flag. Removed orders are excluded from the "to fulfil" counts and show a **Removed** badge
  - **Drafts can now be fulfilled**: instead of a hard "Draft invoices cannot be fulfilled" error, the detail shows a **warning** with a **Mark invoice as ready** action that promotes the draft (`draft` → `sent`) so it can be packed/shipped
  - Migration: `aminocan/fulfillment-queue-remove-migration.sql` (adds `removed_from_queue`, `removed_at`, `removed_by`)
  - Files: `app/(warehouse)/warehouse/page.tsx`, `_components/QueueRow.tsx`, `_components/QueueDetail.tsx`, `app/api/warehouse/queue/route.ts`, `app/api/warehouse/queue/[id]/route.ts`, `lib/warehouse/api.ts`

- **Fulfillment queue — search, day grouping, drafts & invoice download**
  - The warehouse fulfillment queue is now **searchable by customer name** (also matches email / invoice # / order #)
  - Queue is **grouped and divided by day** (newest day first) with a per-day count, and **paginated** (12 per page); within a day, active orders sort before completed
  - **Draft invoices are now shown** in the queue (previously hidden) with a **Draft** badge on the row and detail header; drafts are still excluded from the "to fulfil" summary counts
  - New **Download Invoice** button at the top of the order detail — opens the exact same invoice document as **Admin → Invoices** (reuses the invoice PDF route, allowed for warehouse + admin)
  - Files: `app/(warehouse)/warehouse/page.tsx`, `app/(warehouse)/warehouse/_components/QueueRow.tsx`, `app/(warehouse)/warehouse/_components/QueueDetail.tsx`, `app/api/warehouse/queue/route.ts`, `lib/warehouse/api.ts`

- **Admin Changelog — internal release-notes timeline**
  - New **Admin → Changelog** page: a centralized, searchable timeline of platform updates grouped by day, serving as an internal release-notes and documentation hub
  - Each entry is a card with a **category badge**, title, short summary, author, date/time, tags, affected areas, optional **version** and **impact** (Critical/Major/Minor), and a **Read More** action
  - **Read More** opens a slide-in **detail drawer** (keeps the timeline in context) rendering the full markdown body, affected areas, tags and related links — no navigation away
  - **Sidebar filters**: month **calendar** (days with entries show a dot; click a day to filter), multi-select **categories**, **author** dropdown, and **importance** filter; plus full-text **search** over title/summary/body/tags, and 10-per-page pagination
  - Categories (Admin, Storefront, Feature, Patch, Bug Fix, Performance, Security, API, Database, UI, Mobile) each get a distinct badge colour for fast scanning
  - Admins can **create/edit/delete** entries via a form modal (assistants get read-only access; affiliates cannot see the page). Mutations are recorded in the audit log
  - **Create Report** button: pick a day from a calendar popup to get a copyable list of that day's update titles plus a shareable link to the changelog pre-filtered to that day (page honors a `?date=YYYY-MM-DD` deep link)
  - New table `changelog_entries` (migration `aminocan/changelog-migration.sql`) with admin/assistant RLS read policy; on first run it seeds **26 entries generated from the project's `aminocan/changelogs/` write-ups** via `scripts/gen-changelog-seed.mjs`, so the timeline ships pre-filled with real history
  - Files: `app/(admin)/admin/changelog/page.tsx` + `_components/*`, `app/api/admin/changelog/route.ts`, `app/api/admin/changelog/[id]/route.ts`, `lib/admin/changelog.ts`, `lib/supabase.ts` (types), `app/(admin)/admin/layout.tsx` (nav), `tailwind.config.ts` (drawer animation)
  - Detailed write-up: `changelog/2026-07-08-admin-changelog-interface.md`

- **Admin orders — bulk shipping actions, row loading & day select**
  - The Orders bulk toolbar gains **Create shipments** (bulk-create Easyship shipment records) and **Buy labels** (bulk-buy labels for shipments awaiting one), alongside the existing bulk delete
  - **Create shipments** runs a pre-flight over the selection and shows a confirmation dialog listing which orders will be **skipped and why** (already shipped, local pickup, or missing label fields); only the eligible orders are created on continue
  - **Buy labels** shows a confirmation warning to ensure the **Easyship wallet is funded** before purchasing (buying charges the wallet and can't be undone); the button reflects the eligible count
  - **Per-row loading**: while a bulk action runs, each affected order's Shipping column shows a spinner with what's happening ("Creating shipment…" / "Buying label…"), processed with a small concurrency pool
  - **Select by day**: day divider rows are now checkboxes — click one to select/deselect that whole day's visible orders (with an indeterminate state for partial selection)
  - New shared `lib/shipping/labelReadiness.ts` (`evaluateLabelReadiness`) reused by the single-order readiness route and the new `POST /api/admin/orders/bulk-shipment-readiness` batch pre-flight; new reusable `components/admin/ConfirmActionDialog.tsx`
  - Files: `app/(admin)/admin/orders/page.tsx`, `app/api/admin/orders/bulk-shipment-readiness/route.ts`, `app/api/admin/orders/[id]/label-readiness/route.ts`, `lib/shipping/labelReadiness.ts`, `lib/admin/api.ts`, `components/admin/ConfirmActionDialog.tsx`, `components/admin/DayDivider.tsx`
  - Detailed write-up: `changelogs/2026-07-07-admin-orders-bulk-shipping.md`

- **Admin tables grouped by day**
  - The admin **Orders**, **Invoices**, and **Dashboard** (Recent Orders) tables now group their rows by day, with a divider row between days showing the date in a readable format ("Today", "Yesterday", or e.g. "Monday, July 6, 2026") and a count of that day's rows
  - Grouping runs over the rows already displayed (current page, after search/filter/pagination), so it adds no extra data fetching and respects existing filters
  - New shared helper `lib/dayGroups.ts` (`localDayKey`, `formatDayHeading`, `groupByDay`) and divider component `components/admin/DayDivider.tsx`
  - Files: `app/(admin)/admin/orders/page.tsx`, `app/(admin)/admin/invoices/page.tsx`, `app/(admin)/admin/page.tsx`, `lib/dayGroups.ts`, `components/admin/DayDivider.tsx`
  - Detailed write-up: `changelogs/2026-07-06-admin-tables-group-by-day.md`

- **Product COA button, COA-only toggle & catalog ordering**
  - The COA button on product cards (homepage featured + full catalog) moved from an overlay on the product image to a bronze-outline "Lab"-style button sitting next to the Add to Cart button (icon-only on mobile)
  - New **COA only** toggle on the products page shows only compounds that have a Certificate of Analysis
  - The purity badge no longer renders when a product's purity is null or blank, avoiding an empty pill
  - Products without an image are now sorted to the bottom of the catalog grid (ahead of the existing out-of-stock push)
  - Files: `components/Products.tsx`, `app/products/page.tsx`
  - Detailed write-up: `changelogs/2026-07-06-product-coa-button-and-catalog-toggles.md`

- **USD Pricing for Products (CAD/USD toggle)**
  - Products can now be shown and charged in USD as well as CAD. CAD stays the base price; USD is either an explicit per-product value or auto-calculated from a single CAD→USD rate
  - Products admin page: a CAD/USD toggle by the search box switches the Price/Vial columns between currencies. In USD mode the Price cell is editable (blank = auto-calculated); the create/edit form gains a "Price (USD)" field
  - Invoice form: the existing "Paid In" CAD/USD control now actually converts prices — switching currency re-prices product lines and the totals into the selected currency
  - Site Settings → USD Pricing: set the CAD→USD multiplier, with a best-effort "Live rate" button that fetches the current market rate for review. Changing the rate instantly updates every auto (non-overridden) USD price
  - Data: `products.price_usd` (nullable; null = `price × rate`) and `site_settings.usd_exchange_rate` (default `0.73`), added by `product-usd-price-migration.sql`
  - Files: `lib/pricing.ts`, `lib/supabase.ts`, `app/api/admin/settings/route.ts`, `app/api/admin/settings/usd-rate/route.ts`, `app/(admin)/admin/settings/page.tsx`, `app/api/admin/products/route.ts`, `app/api/admin/products/[id]/route.ts`, `app/(admin)/admin/products/page.tsx`, `components/admin/InvoiceForm.tsx`
  - Detailed write-up: `changelogs/2026-07-06-product-usd-pricing.md`

- **Assistant Role — Read-Only Admin Access**
  - Assistants can log in to the admin dashboard and view all pages but cannot mutate any data
  - Orders page: status dropdown replaced with a static colored badge for assistant users
  - Customers page: role badges now reflect the `role` column (`Customer` / `Assistant` / `Administrator`) with correct colors; admin toggle hidden for assistants and replaced with "View only" text
  - Admin layout already provided the role context (`useUserRole`) and read-only banner — wired into orders and customers pages
  - Files modified: `app/(admin)/admin/layout.tsx`, `app/(admin)/admin/orders/page.tsx`, `app/(admin)/admin/customers/page.tsx`

- **User Management — Full CRUD at `/admin/users`**
  - New "Users" nav item added to the admin sidebar
  - Stats bar showing total, active (green), and inactive (red) user counts
  - Search by name or email; filter by role (Customer / Assistant / Admin) and status (Active / Inactive)
  - Create user: form with email, name, phone, role dropdown, password generator (show/hide + copy to clipboard), active toggle
  - Edit user: pre-filled form; password field optional (blank = keep current password)
  - Deactivate user: sets `active = false`, preserves all data, reversible
  - Permanently delete user: removes row from `customers` table and deletes from Supabase Auth
  - Admin-only actions (Add / Edit / Delete / Toggle); assistants see the table read-only
  - Files created: `app/(admin)/admin/users/page.tsx`, `app/(admin)/admin/users/_components/CreateUserModal.tsx`, `app/(admin)/admin/users/_components/EditUserModal.tsx`, `app/(admin)/admin/users/_components/DeleteConfirmDialog.tsx`, `lib/password.ts`

- **Server-Side Admin User API Routes**
  - `auth.admin.*` Supabase APIs require the service role key and cannot be called from client components
  - `POST /api/admin/users` — creates Supabase Auth user with `email_confirm: true` (no email confirmation required for admin-created users) then inserts a `customers` row; rolls back the auth user if the insert fails
  - `PUT /api/admin/users/[id]` — updates auth credentials (email/password) and customer profile fields
  - `DELETE /api/admin/users/[id]` — hard-deletes from `customers` then removes from Supabase Auth
  - All routes verify the caller has `role = 'admin'` in the customers table before proceeding
  - Both route files use `createClient` with `SUPABASE_SERVICE_ROLE_KEY` directly (same pattern as `app/api/admin/products/route.ts`)
  - `lib/admin/api.ts` — `createUser`, `updateUser`, `deleteUser` updated to call these routes (passing the session Bearer token) instead of calling `supabase.auth.admin.*` with the anon client. Soft delete still runs client-side (only updates the `customers` table, no auth.admin call needed)
  - Files created: `app/api/admin/users/route.ts`, `app/api/admin/users/[id]/route.ts`

### Technical Notes

- `SUPABASE_SERVICE_ROLE_KEY` must be set in `.env.local` to the **service_role** JWT from Supabase Dashboard → Project Settings → API (the one labeled "secret", decodes to `"role":"service_role"`). Do not use the anon key.
- Admin-created users never need to confirm their email (`email_confirm: true` + `email_verified: true` on the customers row).

---

### Added (previous)
- **Bulk Price Override Flow** - New 2-step workflow for faster customer pricing management
  - Step 1: Multi-customer selection with search and autocomplete
  - Step 2: Bulk product pricing grid with all products displayed
  - Shows product name, SKU, default price, and status indicators
  - Conflict detection when multiple customers have different existing prices ("Mixed" badge)
  - Pre-fills existing price overrides for selected customers
  - Only saves modified prices, skips blank entries
  - Batch API integration for efficient bulk updates
  - Added "Bulk Edit Pricing" button to admin pricing page

### Fixed
- **Products Page Hydration Error** - Fixed nested anchor tag issue causing React hydration error
  - Moved certificate (COA) button outside product image link to prevent `<a>` nesting
  - Certificate button now properly positioned with `z-10` to maintain visual layering
  - Resolves console error: "In HTML, <a> cannot be a descendant of <a>"

### Technical Details
- Location: `/app/(admin)/admin/pricing/page.tsx`
- Reuses existing components: `MultiSelectCustomer`, `NumericStepper`
- Uses existing API endpoint: `/api/admin/price-overrides` (POST with upsert behavior)
- No database schema changes required
