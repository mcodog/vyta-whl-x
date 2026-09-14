# PuraMass Hosted Checkout — Build Spec

> Definitive, **portable** spec for implementing the PuraMass (Stealth Health)
> hosted-checkout payment processor in a Next.js + Supabase e-commerce codebase.
> Precise enough that an AI given only this document can rebuild the integration
> on a similar site without seeing the original code.
>
> Generated from the reference implementation in `aminocan/`:
> `lib/payments/puramass.ts`, `lib/payments/puramass-catalog.ts` (+ `.test.ts`),
> `puramass-hosted-checkout-migration.sql`, `app/api/checkout/puramass/route.ts`,
> `app/api/admin/puramass/sync-skus/route.ts`, `app/api/admin/puramass/orders/route.ts`,
> `app/api/admin/settings/route.ts`, `app/checkout/page.tsx`,
> `app/(admin)/admin/settings/page.tsx`, `app/(admin)/admin/puramass-orders/page.tsx`,
> `app/(admin)/admin/layout.tsx`, `docs/PURAMASS_HOSTED_CHECKOUT.md`.
> Stack: Next.js 15 (App Router) + Supabase (Postgres) + TypeScript + Tailwind.
>
> **Reading guide.** Section 2 (partner API contract) is *universal* — it is
> fixed by PuraMass and identical on any site. Sections 3–10 are the reference
> integration; adapt names/paths/UI to the target site, keep the behavior.

---

## 1. Overview

The store hands its cart off to an **externally hosted checkout**. The customer
never pays on the store; instead the store's backend POSTs the cart's SKUs to
the PuraMass partner API, receives a `payment_link` on the PuraMass
patient-portal domain (`app.puramass.com`), and redirects the customer there.
**PuraMass re-reads prices from its own catalog and owns payment, fulfilment,
and order emails from the redirect onward.**

It is an **opt-in alternative** to whatever checkout the store already runs
(in the reference site, an email/invoice flow). An admin toggle switches the
storefront `/checkout` between the existing flow and the PuraMass hand-off. When
off, nothing changes.

The integration spans five surfaces:

1. **Server API client** — talks to the partner API (catalog + create order +
   order status).
2. **Storefront checkout screen** — collects contact info, calls the hand-off
   route, redirects to the payment link.
3. **Admin config** — enable toggle, credential status, and a SKU-mapping sync.
4. **Admin ledger** — a table recording every hand-off for reconciliation.
5. **Status sync** — a signed webhook (plus a polling fallback) that updates each
   hand-off's paid/expired/cancelled state after the customer pays.

The one hard problem is **SKU mapping**: the store's own product SKUs almost
never equal PuraMass's SKUs, so a per-product mapping (`products.puramass_sku`)
is populated by matching product name + strength against the PuraMass catalog.

---

## 2. Partner API contract (universal — fixed by PuraMass)

### 2.1 Base + auth

- **Base URL:** `https://api.stealth.health` (make it configurable).
- **Auth headers, sent on every call, SERVER-SIDE ONLY** (the key is a live
  secret — never ship it to the browser):
  - `X-Partner-ID: ptr_puramass`
  - `X-Api-Key: sk_live_…`
- Credentials are provisioned per partner. Treat the key like a payment secret.

### 2.2 `GET /partner/store/products` — catalog (live SKU source of truth)

Request: the two auth headers, no body.

Response: each product's `sku`, `name`, current price, and image. The exact
envelope is **not guaranteed** by the onboarding docs, so parse defensively —
accept a bare array, `{ products: [...] }`, or `{ data: [...] }`, and accept
price as either `price` (dollars) or `price_cents` (integer cents):

```jsonc
// One plausible shape — do not hard-code the envelope.
{ "products": [
  { "sku": "puramass-bpc-157-10mg-10-pack", "name": "BPC-157 10mg", "price": 103.20, "image": "https://…" }
] }
```

Used for: populating/refreshing the `puramass_sku` mapping. Read-only, safe to
call anytime.

### 2.3 `POST /partner/store/orders` — create hosted-checkout order

Request headers: the two auth headers + `Content-Type: application/json`.

Request body:

```jsonc
{
  "items": [
    { "sku": "puramass-bpc-157-10mg-10-pack", "quantity": 1 },
    { "sku": "puramass-tb500-5mg-10-pack",    "quantity": 2 }
  ],
  "customer": { "email": "customer@example.com", "first_name": "Jane", "last_name": "Doe" },
  "payment": { "mode": "customer" },
  "partner_reference": "your-internal-order-id"
}
```

- `customer.email` is **required**; `first_name` / `last_name` / `phone` /
  shipping are optional — anything omitted is collected on the PuraMass page.
- `payment.mode: "customer"` — the customer pays on the hosted page.
- **Prices are optional, and are the store's choice per order.** Send `sku` +
  `quantity` alone and PuraMass prices the order from its own catalog — that is
  what the storefront cart does, so a tampered cart cannot change what is
  charged. A trusted server-side caller may instead name the amounts:
  `unit_price_cents` on a line and `shipping_total_cents` on the order, and
  those are what the customer is charged (the invoice payment-link path does
  this — see §2.5).
- `partner_reference` (≤120 chars) is echoed back; use it to tie PuraMass's
  `transaction_id` to your order. **Reusing the same reference is a safe retry.**

Response:

```jsonc
{
  "order": {
    "status": "payment_pending",
    "transaction_id": "aBc123…",
    "payment_link": "https://app.puramass.com/transaction/aBc123…",
    "subtotal_cents": 25872,
    "items": [ /* … */ ]
  }
}
```

The store **redirects the customer to `payment_link`**. Parse defensively: the
order may be at the top level or under `order`.

### 2.4 Semantics, limits, and guarantees

- **Two SKU forms.** Each product exists as a **case/box** (SKU `…-10-pack`, or
  `…-case` for some sizes, e.g. `…-30ml-case`) and a **single vial** (SKU
  `…-vial`), each a distinct SKU with its own price. Pick by cart-line type
  (see §4.3).
- **Quantity = number of catalog units.** For a 10-pack line, `quantity` is the
  number of packs (`total vials / pack size`); for a single-vial line it is the
  number of vials. **Clamped 1–99.**
- **Pricing is server-side by default.** Unless the order names its own amounts
  (§2.5), per-customer pricing, discounts, coupons, and shipping/tax on the
  *store* do **not** apply — PuraMass charges its own catalog price and computes
  shipping/tax on the hosted page.
- **Fulfilment + emails are PuraMass's.** The store's warehouse/inventory and
  order emails are bypassed for these orders.
- **Link expiry:** checkout links expire after **7 days**; if one expires,
  create a new order (a fresh hand-off) — do not try to refresh the link.
- **Status sync:** a signed webhook (`store_order.payment_complete`) plus a
  status-polling endpoint (`GET /partner/store/orders/{transaction_id}`) keep the
  order's paid/expired/cancelled state current (see §8).

### 2.5 Naming your own prices (optional, per order)

Three optional fields let a server-side caller decide what an order costs
instead of taking the catalog price:

| Field | Where | Meaning |
| --- | --- | --- |
| `unit_price_cents` | per line | what that SKU costs on **this** order |
| `shipping_rate_cents` | per line | that line's shipping rate |
| `shipping_total_cents` | per order | shipping for the whole order |

```jsonc
{
  "items": [
    { "sku": "puramass-magnesium-glycinate-10-pack", "quantity": 2, "unit_price_cents": 3200 },
    { "sku": "puramass-nxgen-pen-2-vial",            "quantity": 1, "unit_price_cents": 14900 }
  ],
  "shipping_total_cents": 0,
  "customer": { "email": "jane@example.com" },
  "payment": { "mode": "customer" },
  "partner_reference": "amcinv_…"
}
```

- **Per order, never a new default.** The same SKU can be a different price next
  time; nothing is saved.
- **`0` is a real value, not "unset".** `"shipping_total_cents": 0` is how free
  shipping is requested — it switches off the $35.00 default rate.
- **`shipping_total_cents` wins** over per-line `shipping_rate_cents` when both
  are sent, so the total is the one you named rather than one re-derived per
  shipping group. We only ever send the total.
- **What you send is what is charged** — on the hosted link and on a
  card-on-file order alike — and it comes back in the response totals and in the
  `store_order.payment_complete` webhook.
- **Floor: `unit_price_cents` may not go below the wholesale price** PuraMass
  invoices us for that item (owed regardless of what we charge our customer), or
  the order is rejected `400 STORE_PRICE_BELOW_WHOLESALE` with the SKU and its
  floor in the message. Shipping has no floor and may be zero.
- **Malformed amounts** — negative, fractional, or above $100,000 — come back as
  `400 STORE_PRICE_OVERRIDE_INVALID`. `lib/payments/puramass.ts` checks the same
  bounds before sending and throws rather than silently dropping an override
  (dropping one would quietly charge the catalog price instead).
- **Omit the fields and nothing changes** — that is the storefront cart path.

Used by the invoice payment link (`POST /api/pay/:token/checkout`), which sends
each invoice line's price and the invoice's shipping. No shipping address is
sent on either path; PuraMass collects it on the hosted page.

---

## 3. Database schema

Exact DDL (`puramass-hosted-checkout-migration.sql`). Idempotent; safe to re-run.

```sql
-- 1. Per-product PuraMass SKU mapping
ALTER TABLE products ADD COLUMN IF NOT EXISTS puramass_sku VARCHAR(80);       -- case/box SKU (…-10-pack or …-case)
ALTER TABLE products ADD COLUMN IF NOT EXISTS puramass_sku_vial VARCHAR(80);   -- single-vial SKU
CREATE INDEX IF NOT EXISTS idx_products_puramass_sku
  ON products (puramass_sku) WHERE puramass_sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_puramass_sku_vial
  ON products (puramass_sku_vial) WHERE puramass_sku_vial IS NOT NULL;

-- 2. Admin toggle on the singleton site_settings row
ALTER TABLE site_settings
  ADD COLUMN IF NOT EXISTS puramass_checkout_enabled BOOLEAN NOT NULL DEFAULT false;

-- 3. Hand-off ledger
CREATE TABLE IF NOT EXISTS puramass_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_reference TEXT NOT NULL UNIQUE,       -- our id, echoed back; unique => safe retry
  transaction_id    TEXT,                       -- PuraMass id
  payment_link      TEXT,
  status            TEXT NOT NULL DEFAULT 'payment_pending',
  subtotal_cents    INTEGER,
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_email    TEXT,
  items             JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ sku, quantity }, …] sent to PuraMass
  referral_code     TEXT,                       -- captured for manual reconciliation
  -- Added by the webhook-status migration (§8):
  paid_at           TIMESTAMPTZ,                -- set when status → paid
  currency          TEXT,                       -- e.g. 'usd'
  last_event_id     TEXT,                       -- last processed webhook event_id (dedupe)
  -- Added by the fulfillment-invoice migration (§8.4):
  invoice_id        UUID REFERENCES invoices(id) ON DELETE SET NULL,  -- one fulfillment invoice per order
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fulfillment-invoice migration also adds a marker to invoices:
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source TEXT;  -- 'stealth_health' for hosted-checkout orders
CREATE INDEX IF NOT EXISTS idx_puramass_orders_transaction ON puramass_orders (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_customer    ON puramass_orders (customer_id)     WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_puramass_orders_created     ON puramass_orders (created_at DESC);

-- updated_at trigger + RLS: service-role only (all access is server-side).
ALTER TABLE puramass_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON puramass_orders FOR ALL USING (true) WITH CHECK (true);
```

**Assumptions about the host schema** (adapt to the target site):
- `products` has a primary key `id`, a `name`, and a `strength` column (nullable).
- `site_settings` is a **singleton** settings row.
- `customers` has `id` and `role`; roles include an admin-ish role. Drop the
  `customer_id` FK if the target has no such table.

**Schema usage**

| Table.column | Read by | Written by |
| --- | --- | --- |
| `products.puramass_sku` / `puramass_sku_vial` | hand-off route (resolve cart→SKU, box vs vial) | SKU-sync endpoint (both) |
| `site_settings.puramass_checkout_enabled` | storefront router, hand-off route, admin settings | settings PUT |
| `puramass_orders.*` | admin ledger read | hand-off route (insert) |

---

## 4. Components (reference implementation)

### 4.1 `lib/payments/puramass.ts` — server API client
- **Type:** server-only module (imported only by route handlers). Reads env at
  call time.
- **Env:** `PURAMASS_API_KEY` (required), `PURAMASS_PARTNER_ID` (default
  `ptr_puramass`), `PURAMASS_API_BASE_URL` (default `https://api.stealth.health`),
  `PURAMASS_WEBHOOK_SECRET` (for webhook verification, §8).
- **Exports:**
  - `isPuramassConfigured(): boolean` — `Boolean(apiKey && partnerId)`.
  - `fetchPuramassCatalog(): Promise<PuramassCatalogProduct[]>` — GET catalog,
    envelope/price-tolerant (§2.2).
  - `createPuramassOrder({ items, customer, partnerReference }): Promise<PuramassOrder>`
    — POST order; sends only `{ sku, quantity }`, `payment.mode:"customer"`,
    `partner_reference`; validates `payment_link` + `transaction_id` present.
  - `fetchPuramassOrderStatus(transactionId): Promise<PuramassOrderStatus>` —
    GET order status (§8.2).
  - `verifyPuramassSignature(rawBody, header): boolean` /
    `isPuramassWebhookConfigured(): boolean` — HMAC-SHA256 webhook verify (§8.1).
  - `PuramassApiError` (carries `status` + sanitized `detail`; **never** the key).
- **Transport:** `fetch` with a 20s `AbortController` timeout, `cache:"no-store"`,
  auth headers injected centrally. Timeout → `PuramassApiError(504)`; network →
  `502`.

Key signatures:

```ts
interface PuramassOrderLine { sku: string; quantity: number } // quantity = packs, 1–99
interface PuramassCustomer  { email: string; first_name?: string; last_name?: string; phone?: string }
interface PuramassOrder {
  status: string; transaction_id: string; payment_link: string;
  subtotal_cents: number; items: { sku?: string; quantity?: number }[];
}
```

### 4.2 `lib/payments/puramass-catalog.ts` — snapshot + SKU matcher
- **Type:** pure module (no I/O), unit-tested (`.test.ts`).
- **Exports:**
  - `PURAMASS_CATALOG_SNAPSHOT: {sku,name}[]` — bundled copy of the catalog, used
    as a matcher **fallback** (offline / when the live call fails) and for tests.
    Keep in sync with the live catalog.
  - `normalizeName(raw): string` — lowercase, strip punctuation to spaces,
    collapse whitespace, and **glue a bare number to a following unit** so
    `"10 IU"` and `"10mg"` become one dose token (`10iu`, `10mg`). `®`/`™`/`-`
    all fold away.
  - `matchProductToPuramass(productName, strength, catalog?): PuramassMatchResult`
    — see algorithm below.
- **Matcher algorithm** (dose-anchored, human-verified), tiers most-confident first:
  1. `exact` — normalized names equal (tries `productName`, then
     `productName + " " + strength`).
  2. `matched` — the product's **dose signature** (set of `\d+(mg|mcg|g|ml|iu|kg)`
     tokens) equals a candidate's **and** every non-dose word of the product is
     present in the candidate; when several qualify, the candidate that adds the
     **fewest** extra words wins if that minimum is unique.
  3. `ambiguous` — several candidates tie on minimal extra words → returned for a
     human to pick (never auto-written).
  4. `unmatched` — nothing shares dose + words.

  Result: `{ status, sku|null, entry|null, candidates[] }`. Dose must always
  match, so 10mg is never crossed with 20mg. Examples: store `"5-Amino 10mg"` →
  `puramass-5-amino-1mq-10mg-10-pack` (matched); `"GHRP 10mg"` → ambiguous
  (GHRP-2 vs GHRP-6); `"Vitamin C"` → unmatched.

### 4.3 `app/api/checkout/puramass/route.ts` — cart hand-off (storefront-facing)
- **Type:** `POST` route handler. Public (called from the storefront).
- **Request:** `{ items: [{ id, packSize, quantity }], customer: { email, firstName?, lastName? }, referralCode? }`.
- **Logic (in order):**
  1. Rate-limit by IP (reuse the app's limiter; reference uses 5/min).
  2. `isPuramassConfigured()` false → **503**.
  3. Read `site_settings.puramass_checkout_enabled` (independent, defensive
     `.single()`); falsy/absent → **403** ("disabled").
  4. Validate: non-empty items, valid email regex.
  5. Load `products (id, name, puramass_sku, puramass_sku_vial)` for the cart ids
     (service-role client; fall back to box-only select if the vial migration
     hasn't run). **Never trust a client-sent SKU or price.**
  6. Per line, pick the mapping by type: **`packSize === 1` → `puramass_sku_vial`**
     with `quantity = vials`; else **`puramass_sku`** with
     `quantity = round(vials / packSize)` (packs). Clamp 1–99.
  7. Merge lines by resolved SKU (sum, clamp 99). Any line whose needed mapping is
     null/blank → **409** `{ error, unmapped: [names] }` (vial lines tagged
     `(single vial)`).
  8. Best-effort `customer_id`: if an `Authorization: Bearer` token is present,
     verify it and take the user id; else null.
  9. `partnerReference = "amc_" + crypto.randomUUID()`.
  10. `createPuramassOrder(...)`. On `PuramassApiError`: surface 4xx messages,
      collapse everything else to **502**. Never echo credentials.
  11. Insert a `puramass_orders` row (best-effort; a failure logs but does **not**
      block the redirect).
  12. Respond `{ payment_link, transaction_id, status }`.

### 4.4 `app/api/admin/puramass/sync-skus/route.ts` — SKU auto-fill (admin)
- **Type:** `POST`, admin-only (verify bearer token → `customers.role` is admin,
  not a read-only assistant role).
- **Body:** `{ overwrite?: boolean, dryRun?: boolean }`.
- **Logic:** load catalog (live `fetchPuramassCatalog()` when configured, else
  snapshot; report which `source`); load all **active** `products (id, name,
  strength, puramass_sku, puramass_sku_vial)` (`active = true` — inactive products
  are skipped, so they aren't mapped or listed as unmatched). Splits the catalog
  into a **box** set and a
  **vial** set, filtering **both** to real PuraMass SKUs — a case/box SKU must
  start `puramass-` **and** end `-10-pack` or `-case` (e.g. `…-30ml-case`); a
  vial SKU must start `puramass-` **and** end `-vial`. This keeps the matcher off
  legacy/general non-`puramass-` SKUs.
  Runs `matchProductToPuramass` against each and writes `puramass_sku` /
  `puramass_sku_vial` for confident matches (unless already set and `overwrite`
  false). **Auto-repair:** an existing value that is *not* a `puramass-` SKU is
  treated as unset and rewritten to the correct one (no `overwrite` needed).
  Returns a **per-mapping** report (`box` / `vial`, each with
  updated/ambiguous/unmatched). `dryRun` previews without writing; resilient if
  the vial column is missing (`vial_column_available: false`). Writes an
  audit-log entry.
- **Response:** `{ source, catalog_count, dry_run, counts:{updated,skipped_already_set,ambiguous,unmatched}, updated[], skipped_already_set[], ambiguous[], unmatched[] }`.

### 4.5 `app/api/admin/puramass/orders/route.ts` — ledger read (admin)
- **Type:** `GET`, admin/assistant read-only.
- **Query:** `page` (0-indexed), `pageSize` (1–100, default 25).
- **Logic:** select the ledger columns with `{ count: 'exact' }`, `order created_at desc`, `.range(from, to)`.
- **Response:** `{ orders[], total, page, pageSize }`.

### 4.6 `app/api/admin/settings/route.ts` — settings wiring
- `GET` shape adds `puramass_checkout_enabled` (bool) and **`puramass_configured`**
  (from `isPuramassConfigured()`, read-only — the key is never returned).
- `PUT` accepts `puramass_checkout_enabled` (must be boolean) and writes it.
- **Critical gotcha:** the reference settings reader uses a *progressive column
  fallback* (tries the fullest column set, then fewer, to tolerate un-run
  migrations). `puramass_checkout_enabled` **must be read on its own**, merged
  into the result — folding it into the fallback lets an unrelated missing column
  silently drop it, which makes the admin toggle appear to revert to off and the
  storefront ignore it even though the DB row is `true`.

### 4.7 `app/checkout/page.tsx` — storefront router + `PuramassCheckoutContent`
- **Type:** Client Component.
- **Router (`CheckoutContent`):** fetch `/api/admin/settings` with
  **`cache:"no-store"`**; if `puramass_checkout_enabled` → render
  `PuramassCheckoutContent`, else the existing checkout. (Cart "Proceed",
  "Buy Now", and cart-drawer all navigate to `/checkout`, so this one branch
  covers every entry point.)
- **`PuramassCheckoutContent`:** collects email (+ optional first/last, prefilled
  from the signed-in customer), shows an **indicative** cart summary (clearly
  labeled "amount charged is set on the secure checkout page"), notes the total is
  charged in **USD** on the hosted page, and on submit POSTs to
  `/api/checkout/puramass` (attaching the session bearer token if signed in and
  any stored referral code), then `window.location.href = payment_link`. Handles
  empty cart, guest-checkout-disabled (account-required gate), invalid email, and
  the `409 unmapped` response (surfaces the affected item names).
- **Checkout upsell.** Fetches `GET /api/products?addon=1` (products flagged
  `is_checkout_addon`, e.g. bacteriostatic water) and renders a "Complete your
  order" card. **Store stock is ignored** (PuraMass fulfils these). Each tile
  opens the shared `AddToCartModal` (§4.13) to choose form + quantity, adding to
  the cart (whose summary updates live). **Only fulfillable forms are offered:**
  a form is shown only when its PuraMass mapping is a valid SKU of that form
  (`puramass_sku` ends `-10-pack` or `-case`, `puramass_sku_vial` ends `-vial`);
  a product with neither valid is dropped, and the modal's `allowedPackSizes`
  (§4.13) is narrowed accordingly.

### 4.8 Admin Settings section — `app/(admin)/admin/settings/page.tsx`
"PuraMass Checkout" card: Enabled/Disabled toggle (persists
`puramass_checkout_enabled`), a **credential-status banner** driven by
`puramass_configured` (green = detected / amber = missing key), and a
"**Sync SKUs from catalog**" button that POSTs to the sync endpoint and renders a
report (mapped / already-set / needs-review / unmatched, with the ambiguous
candidates and unmatched names listed).

### 4.9 Admin ledger page — `app/(admin)/admin/puramass-orders/page.tsx`
Paginated table: date, customer email, items (`sku × qty`), subtotal (USD from
`subtotal_cents`), status badge (with the `paid` date under it when set),
transaction (linked to `payment_link`), our `partner_reference`, referral code,
and a per-row **Refresh** action (§4.12). Loading / empty / error states. Fetches
`/api/admin/puramass/orders` with the session bearer token, `cache:"no-store"`.

### 4.10 Admin nav — `app/(admin)/admin/layout.tsx`
One nav item `{ href: '/admin/puramass-orders', label: 'PuraMass Orders' }` under
the "Orders & Fulfillment" group. Nav visibility + route access are gated by the
existing admin-page permission check (admin/assistant only).

### 4.11 Webhook receiver — `app/api/webhooks/stealth-health/route.ts`
- **Type:** `POST` route handler, `export const runtime = 'nodejs'` (needs raw
  body + `crypto`). Public — the signature is the auth.
- **Purpose:** apply PuraMass status events to the ledger. Full contract in §8.1.
- **Data access:** matches/updates `puramass_orders` (service-role client) by
  `transaction_id`, then `partner_reference`.
- **Registered URL:** `<base>/api/webhooks/stealth-health` (name reflects the
  Stealth Health partner API that delivers the event).

### 4.12 Status refresh (polling) — `app/api/admin/puramass/orders/refresh/route.ts`
- **Type:** `POST { transaction_id }`, admin/assistant only.
- **Purpose:** manual/backfill counterpart to the webhook — calls
  `fetchPuramassOrderStatus` and updates the row's status/paid_at/currency/
  subtotal. Surfaced as the per-row **Refresh** button on §4.9. See §8.2.

### 4.13 `components/AddToCartModal.tsx` — form + quantity modal (shared)
- **Type:** Client Component, reused from the product pages by the checkout
  upsell (§4.7).
- **Purpose:** pick pack size (single vial vs pack of 10) + quantity, then
  add-to-cart / buy-now. Prices shown per the active display currency.
- **Prop added for the upsell:** `allowedPackSizes?: (1 | 10)[]` (default both).
  When narrowed to one, the selector collapses to a "Sold as …" label and the
  default size follows the allowed set — this is how the checkout upsell hides a
  form PuraMass can't fulfil.

---

## 5. UI/UX overview

> Per the porting goal, match the **target site's** design system rather than
> copying these exact tokens. Reproduce the **structure, states, and copy**; swap
> the palette.

**Reference design tokens** (`tailwind.config.ts`, "PURA" system):

| Token (class) | Hex | Use |
| --- | --- | --- |
| `ink` | `#07203A` | primary text, primary buttons |
| `ink-muted` | `#4E6E85` | secondary text |
| `vital` | `#438B9E` | accent, links, selected state |
| `surface` | `#F7FAFB` | subtle panels, table header |
| `line` | `#D5E2E7` | borders / dividers |
| radius | `rounded-xl` (0.75rem) / `rounded-2xl` (1rem) | cards, inputs, buttons |
| font | system sans (`-apple-system`, SF Pro, Segoe UI, Roboto) | all |

- **Storefront checkout:** centered, `max-w-4xl`; a `ShieldCheck` banner
  explaining the redirect + that pricing/shipping are set on the hosted page;
  two-column (contact form / indicative order summary) collapsing to one on `md`;
  full-width primary CTA "Continue to secure checkout" (disabled until email is
  valid, spinner + "Redirecting…" while submitting); a "charged in USD" note under
  the CTA. Account-required and empty-cart states render centered cards.
- **Checkout upsell:** a "Complete your order" card above the CTA — a `Sparkles`
  header + a grid of add-on tiles (image, name, "from $X / form", a `+` button).
  A tile opens `AddToCartModal`; only fulfillable forms are shown.
- **Admin settings card / ledger table:** standard admin card (`bg-white`,
  `border-line`, `rounded-xl`); toggle = two bordered buttons with a `vital`
  selected border + a check; status banner green/amber; ledger is an
  `overflow-x-auto` table with a `surface` header and prev/next pagination.

---

## 6. Data flow & behavior

**Enable + map (admin, one-time):**
1. Set env `PURAMASS_API_KEY` (+ optional partner id / base URL) server-side.
2. Run the migration.
3. Admin → Settings → PuraMass Checkout → **Sync SKUs from catalog**; resolve any
   ambiguous/unmatched products by setting `products.puramass_sku` /
   `puramass_sku_vial` by hand.
4. Flip the **Enabled** toggle.

**Checkout hand-off (customer):**
```
Cart/Buy Now → /checkout
  → router reads puramass_checkout_enabled (no-store) → PuramassCheckoutContent
  → (optional) add an is_checkout_addon upsell via AddToCartModal
  → customer enters email → POST /api/checkout/puramass
      → gate (configured? enabled?) → validate
      → per line: packSize 1 → puramass_sku_vial (qty=vials)
                  else       → puramass_sku      (qty=round(vials/packSize))
      → clamp 1–99, merge by sku
      → createPuramassOrder → insert puramass_orders row
  → 200 { payment_link } → window.location = payment_link
  → app.puramass.com (pay · ship · email)
```

**Intricacies to preserve (do not drop any):**
- Send only `sku`+`quantity`; resolve SKUs server-side from the DB; never trust
  client prices/SKUs (defense in depth even though PuraMass re-prices).
- Pick the SKU by line type: `packSize === 1` → `puramass_sku_vial`
  (`quantity` = vials); else `puramass_sku` (`quantity` = `round(vials/packSize)`
  packs). Clamp 1–99, merge duplicate SKUs.
- Only ever target a real PuraMass SKU: it must start `puramass-` and end with
  the right form (`-10-pack` or `-case` for a pack/case line, `-vial` for a vial
  line). The sync filters the catalog to these before matching (and auto-repairs
  a stored value that isn't one), the hand-off treats anything else as unmapped,
  and the upsell hides a form whose mapping isn't valid.
- `partner_reference` is our idempotency key; unique in the ledger; reuse = safe
  retry.
- Ledger insert is best-effort and must never block the customer redirect.
- Read `puramass_checkout_enabled` independently of any progressive column
  fallback (§4.6 gotcha).
- Settings fetch on the storefront must be `no-store` — it decides routing.
- Links expire after 7 days → just create a new order.
- Upsell offers only fulfillable forms: a form appears only when its mapping is a
  valid SKU (`-10-pack`/`-case` for a case, `-vial` for a vial); store stock is
  ignored (PuraMass fulfils).

---

## 7. Edge cases & states

- **Not configured** (no key): hand-off route → 503; admin banner amber; toggle
  can be on but checkout won't run.
- **Disabled toggle:** hand-off route → 403; storefront uses the existing flow.
- **Unmapped product** in cart: 409 `{ unmapped: [...] }`; storefront shows which
  items aren't available for hosted checkout.
- **Empty cart / invalid email:** 400; storefront shows inline errors / empty-cart
  card.
- **Guest checkout disabled + not signed in:** storefront shows account-required
  gate.
- **Partner API 4xx/5xx/timeout:** surface 4xx message, else 502/504; no charge
  occurs (order never created).
- **Ledger insert fails after order created:** logged; customer still redirected
  (reconcile from PuraMass side using `partner_reference` if needed).
- **Ambiguous/unmatched SKUs at sync:** never auto-written; listed for a human.
- **Unauthorized admin calls:** 401/403.

---

## 8. Reconciliation & payment status

At hand-off, `puramass_orders.status` starts at `payment_pending`. It is kept
current two ways (both implemented):

### 8.1 Webhook — `store_order.payment_complete` (automatic, universal contract)

PuraMass POSTs this when a customer pays a link minted via `POST
/partner/store/orders`:

```jsonc
{
  "event_id": "evt_…",
  "event_type": "store_order.payment_complete",
  "partner_reference": "amc_…",           // whatever we sent at create time
  "data": {
    "status": "paid",
    "occurred_at": "2026-08-05T14:12:31Z",
    "transaction_id": "aBc123…",           // same id as the create response
    "order_id": "aBc123…",
    "payment_mode": "customer",
    "currency": "usd",
    "items": [ { "sku": "…", "name": "…", "quantity": 2, "unit_price_cents": 10320 } ]
  },
  "created_at": "2026-08-05T14:12:31Z"
}
```

Receiver: **`POST /api/webhooks/stealth-health`** (Node runtime; public, auth is the
signature). Steps:
1. Read the **raw body** (`await req.text()` — never a re-serialized object).
2. Verify header `X-Stealth-Signature: sha256=<hex>` = HMAC-SHA256 of the raw
   body keyed by `PURAMASS_WEBHOOK_SECRET`, constant-time compare (guard length
   before `timingSafeEqual`). Fail → **401**. Missing secret → **500**.
3. Match `puramass_orders` by `data.transaction_id` (then `partner_reference`).
4. **Idempotency:** skip if `last_event_id === event_id` (at-least-once + retries
   at 30s/5m/30m/2h/12h; dedupe on `event_id`).
5. Update `status`, `last_event_id`, `currency`, and `paid_at` (`= occurred_at`
   when `status === 'paid'`); fill `transaction_id` if matched by reference.
6. **ACK 2xx within 10s** for any authentic event (even unmatched/unknown, so it
   isn't retried forever); only signature/secret/DB-write failures return non-2xx
   to trigger their retry. Missed events can be replayed via `GET /partner/events`.

### 8.2 Polling — `GET /partner/store/orders/{transaction_id}` (manual fallback)

Same auth headers. Returns `{ order: { transaction_id, status, partner_reference,
currency, subtotal_cents, payment_link, created_at, paid_at, expires_at, items } }`.
Wired as `fetchPuramassOrderStatus()` + an admin **Refresh** button per ledger row
(`POST /api/admin/puramass/orders/refresh`), which updates status/paid_at/
currency/subtotal. Use it to backfill events that fired before the webhook URL
was registered.

### 8.3 Status vocabulary

`payment_pending` (link minted, unpaid) → `paid` (captured; `paid_at` set;
moves to fulfilment) → or `expired` (7-day link lapsed; mint a new order) /
`cancelled` (by PuraMass staff, rare). Note: webhook/polling `items` reflect what
the customer *actually* paid for (a line removed on the hosted page won't appear).

Fulfilment/shipping status beyond payment still lives in the PuraMass portal.

### 8.4 Fulfillment invoice (queue integration)

If the store fulfils these orders itself, the `paid` webhook also creates a
**fulfillment invoice** so the items appear in the warehouse queue
(`createStealthHealthFulfillmentInvoice`, called best-effort from the webhook;
a failure never fails the ACK):

- Invoice: `source = 'stealth_health'`, `status = 'paid'`,
  `fulfillment_status = 'pending'`, `fulfillment_type = 'shipment'`, USD, no
  shipping address, minimal customer (email + optional id). Line items are built
  from the paid webhook items, mapped back to storefront products by SKU
  (`puramass_sku` / `puramass_sku_vial`) for the product link; `price_type` is
  `vial` for `…-vial` else `box`.
- **Idempotent:** one invoice per order — guarded by `puramass_orders.invoice_id`
  (set after creation), so webhook retries don't duplicate it.
- The warehouse queue (invoice-backed) carries `invoices.source` through
  `QUEUE_SELECT` → `QueueItem.source`; `QueueRow` / `QueueDetail` render a
  "Stealth Health" badge and a tooltip on the externally-managed (blank) fields
  (customer name/phone, shipping address). Requires the migration's `source`
  column — like the rest of `QUEUE_SELECT`, run the migration before deploying.

---

## 9. Security

- The API key is **server-only** (`PURAMASS_API_KEY` env); never in client code,
  never returned by any endpoint (`puramass_configured` exposes only a boolean).
- Errors never include the key (`PuramassApiError` carries status + sanitized
  detail only).
- Hand-off route resolves SKUs from the DB and ignores client-sent prices/SKUs;
  PuraMass also re-prices server-side.
- `puramass_orders` is service-role only (RLS); all access is server-side.
- Admin endpoints verify a bearer token → role; storefront hand-off is
  rate-limited.

---

## 10. Implementation checklist (target site)

1. **Env:** add `PURAMASS_API_KEY`, `PURAMASS_PARTNER_ID`, `PURAMASS_API_BASE_URL`
   (server-only); document in `.env.example`.
2. **Client:** port `lib/payments/puramass.ts` (fetch/timeout/error patterns may
   already exist in the target — reuse them).
3. **Catalog+matcher:** port `lib/payments/puramass-catalog.ts` (+ tests); refresh
   the snapshot from the live catalog.
4. **DB:** run the migration (§3), adjusting `products`/`site_settings`/`customers`
   names to the target schema.
5. **Settings:** add `puramass_checkout_enabled` (read/write) and
   `puramass_configured` (read-only) to the settings endpoint — **read the toggle
   independently** (§4.6).
6. **Hand-off route:** `POST /api/checkout/puramass` (§4.3) — gate, validate,
   map SKUs, pack-quantity math, create order, insert ledger row.
7. **SKU sync:** `POST /api/admin/puramass/sync-skus` (§4.4), admin-gated.
8. **Ledger read:** `GET /api/admin/puramass/orders` (§4.5), admin-gated.
9. **Storefront:** branch the checkout on the toggle → a `PuramassCheckoutContent`
   screen (§4.7); ensure every cart entry point routes through it; settings fetch
   `no-store`.
10. **Admin UI:** settings "PuraMass Checkout" card (toggle + status + sync) and a
    ledger page + nav item, using the target's design system.
11. **Verify:** unit-test the matcher; end-to-end test with a real hand-off in a
    non-production partner mode if available; confirm the key is never sent to the
    browser.
12. **Status sync (§8):** set `PURAMASS_WEBHOOK_SECRET`; add
    `POST /api/webhooks/stealth-health` (verify HMAC over raw body, update the row by
    `transaction_id`/`partner_reference`, dedupe on `event_id`, ACK 2xx);
    register the endpoint URL with PuraMass; add the polling
    `fetchPuramassOrderStatus` + admin refresh action as a fallback.

---

## 11. Open questions & unverified items

- **Catalog response envelope + price unit are unverified** — the client parses
  defensively (array / `products` / `data`; `price` dollars or `price_cents`).
  Confirm the real shape against a live call and tighten the types.
- **Order response envelope** (`order` wrapper vs top-level) is likewise parsed
  defensively; confirm.
- **Status sync is implemented** (§8): webhook `store_order.payment_complete` +
  polling `GET /partner/store/orders/{transaction_id}`. The webhook is
  at-least-once with a 10s ACK window and `event_id` dedupe; `items` reflect what
  was actually paid.
- **`payment.mode`** other than `"customer"` (e.g. partner-billed) is not used
  here; confirm if the target needs it.
- **Rate-limit, auth, Supabase-client, toast, and audit-log helpers** are the
  reference app's; the target should substitute its own equivalents.
- **Single-vial lines:** supported via `products.puramass_sku_vial` and the
  `…-vial` catalog. A cart line is routed to the vial SKU when `packSize === 1`.
  If the target has no single-vial concept, only the 10-pack mapping is used.
- **General (non-peptide) products** (e.g. `tempramed-*`) exist in the PuraMass
  catalog; matching for those is name-only (no dose) — verify mappings by hand.
