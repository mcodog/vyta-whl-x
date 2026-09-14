# Module 3 — Products (Public / Storefront)

The customer-facing product catalog: the catalog grid page (`/products`), the single
product detail page (`/products/[slug]`), the home-page "Featured Compounds" section,
and the home-page product ticker. It reads products from Supabase through customer-pricing-aware
API routes, renders them with skeleton + "smart" loading affordances, gracefully handles
out-of-stock and unpriced (price = 0) products, exposes Certificates of Analysis (the
`coa_url` string-array column that replaced the old single `certificate_url`), and lets
shoppers join a per-product "Notify me when back in stock" waitlist. All data is fetched
through `/api/products` and `/api/products/featured` (service-role, RLS-bypassing routes)
so that customer-specific price overrides can be merged in.

---

## Data model

All storefront reads hit the `products` table plus two satellite tables: `customer_price_overrides`
(per-customer pricing) and `stock_notifications` (restock waitlist).

### Table: `products`

Base table (`products-schema.sql`) plus columns added by later migrations. Note: the base
schema shipped a `stock_qty` column, but the live app reads/writes **`stock_quantity`**
(introduced by `update-products.sql` / `ecommerce-backend-migration.sql`); `stock_qty` is
vestigial. The canonical TypeScript shape lives in `lib/supabase.ts` (`export interface Product`).

| Column | Type | Default | Notes / Constraints |
|---|---|---|---|
| `id` | `UUID` | `gen_random_uuid()` | PK |
| `name` | `VARCHAR(255)` | — | `NOT NULL` |
| `slug` | `VARCHAR(255)` | — | `UNIQUE NOT NULL`; unique index `idx_products_slug`. Used for `/products/[slug]` routing |
| `category` | `VARCHAR(100)` | — | `NOT NULL`; index `idx_products_category`. Free-text; storefront maps known values to a fixed category bar (see UI) |
| `description` | `TEXT` | — | Full description (detail page) |
| `description_short` | `TEXT` | — | Short blurb |
| `benefits` | `TEXT` | — | Comma-separated; detail page splits on `,` into a bulleted list |
| `mechanism` | `TEXT` | — | "Mechanism of Action" section |
| `price` | `DECIMAL(10,2)` | — | `NOT NULL`. **`price = 0` is the convention for "unavailable / N/A"** (renders N/A, disables add-to-cart) |
| `stock_quantity` | `INTEGER` | `0` | `0` = out of stock → shows "Notify me" / "Out of Stock" |
| `low_stock_threshold` | `INTEGER` | `10` | `NOT NULL` (see Module 4 / Inventory; not surfaced on storefront) |
| `low_stock_alerted` | `BOOLEAN` | `false` | `NOT NULL` (admin-only dedupe flag) |
| `strength` | `VARCHAR(50)` | — | e.g. `10mg` |
| `purity` | `VARCHAR(50)`/`TEXT` | — | e.g. `99%+`; shown as a vital badge |
| `form` | `VARCHAR(100)` | — | e.g. `Lyophilized powder / Injectable` |
| `image_url` | `TEXT` | — | Public URL in the `products` storage bucket; falls back to a Beaker icon when null |
| `coa_url` | `TEXT[]` (JSON array) | `[]` | **Array of Certificate-of-Analysis PDF URLs.** Replaced the legacy single `certificate_url`. API normalizes to a filtered `string[]` |
| `featured` | `BOOLEAN` | `false` | Drives the home "Featured Compounds" section |
| `active` | `BOOLEAN` | `true` | Only `active = true` rows are returned to the storefront |
| `created_at` | `TIMESTAMPTZ` | `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | `NOW()` | |

RLS (from `products-schema.sql`):
```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Products are viewable by everyone" ON products
  FOR SELECT USING (true);
```
Public SELECT is allowed, but the storefront still reads through the service-role API routes
(so price overrides can be joined). `ProductTicker.tsx` is the only component that queries the
table directly via the anon client (relying on this public-SELECT policy).

### Table: `customer_price_overrides` (`customer-pricing-migration.sql`)

| Column | Type | Default | Constraints |
|---|---|---|---|
| `id` | `UUID` | `gen_random_uuid()` | PK |
| `customer_id` | `UUID` | — | `NOT NULL` → `customers(id) ON DELETE CASCADE` |
| `product_id` | `UUID` | — | `NOT NULL` → `products(id) ON DELETE CASCADE` |
| `override_price` | `DECIMAL(10,2)` | — | `NOT NULL CHECK (override_price >= 0)` |
| `created_at` | `TIMESTAMPTZ` | `NOW()` | |
| `updated_at` | `TIMESTAMPTZ` | `NOW()` | maintained by trigger `price_overrides_updated_at` |

`CONSTRAINT unique_customer_product UNIQUE(customer_id, product_id)`. Indexes on `customer_id`,
`product_id`, and the pair. RLS: service-role full access (`USING/ WITH CHECK true`); customers
may `SELECT` their own rows (`auth.uid() = customer_id`).

### Table: `stock_notifications` (`stock-notifications-migration.sql`)

Backing store for "Notify me when back in stock."

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | `UUID` | `gen_random_uuid()` | PK |
| `product_id` | `UUID` | — | `NOT NULL` → `products(id) ON DELETE CASCADE` |
| `customer_id` | `UUID` | — | nullable → `customers(id) ON DELETE SET NULL` |
| `email` | `TEXT` | — | `NOT NULL`; stored lower-cased by the API |
| `status` | `TEXT` | `'pending'` | `NOT NULL`; one of `pending` \| `notified` \| `cancelled` |
| `created_at` | `TIMESTAMPTZ` | `now()` | |
| `notified_at` | `TIMESTAMPTZ` | — | set when the restock email is sent |

Indexes: partial unique `uniq_stock_notifications_pending (product_id, email) WHERE status='pending'`
(one active request per product/email, dedupes case-insensitively); `idx_stock_notifications_product`
(partial, pending) and `idx_stock_notifications_status`. No RLS policy is defined — all access is
through service-role API routes.

---

## API endpoints

### `GET /api/products` — `app/api/products/route.ts`

Public. Service-role Supabase client.

Query params:
- `slug` — return a single product (uses `.single()`; response `products` is an object, not array)
- `category` — filter (ignored when `All`)
- `customer_id` — merge that customer's price overrides

Logic: selects `*` from `products WHERE active = true`, ordered by `name` (unless `slug`).
If `customer_id` present, fetches `customer_price_overrides` for the customer and, per product,
sets `price = override_price` when an override exists, plus `has_override: boolean` and
`original_price` (the catalog price). If the overrides query fails it silently returns default
prices. Response: `{ products }` (array or single object). Errors: `{ error }` with 500.

### `GET /api/products/featured` — `app/api/products/featured/route.ts`

Public. Selects a narrow column set (`id, name, slug, description_short, price, purity, strength,
image_url, coa_url, stock_quantity`) from `products WHERE active = true AND featured = true AND
stock_quantity > 0`, ordered by `name`, `limit(8)`. **Out-of-stock featured products are
intentionally excluded from the home page.** Each row passes through `normalizeCoa()` which coerces
`coa_url` to a filtered `string[]`. Same `customer_id` override merge as above. Response `{ products }`.

### `GET /api/stock-notifications?product_id=&email=` — `app/api/stock-notifications/route.ts`

Public. Validates email against `EMAIL_RE`. Returns `{ subscribed: boolean }` — true when a
`pending` row exists for that `(product_id, lower(email))`. Bad/invalid email returns
`{ subscribed: false }`. Missing params → 400.

### `POST /api/stock-notifications`

Public. Body `{ product_id, email, customer_id? }`. Lower-cases & validates email; confirms the
product exists (404 if not); idempotent — if a `pending` row exists returns
`{ success: true, alreadySubscribed: true }`; otherwise inserts a `pending` row. A unique-index
race (PG code `23505`) is also treated as `alreadySubscribed`. Validation error message:
`"Please enter a valid email address"`. Success: `{ success: true }`.

### `DELETE /api/stock-notifications`

Public. Body `{ product_id, email }`. Sets matching `pending` rows to `status = 'cancelled'`.
Returns `{ success: true }`. (The restock email itself is sent from the admin PUT product route —
see Module 4.)

---

## Frontend

All pages/components are client components (`'use client'`). State is plain React hooks +
two contexts; **no React Query is used on the storefront** (despite `@tanstack/react-query`
being a dependency). Data loading for the catalog and featured sections goes through the
`useSmartLoad` hook.

### Routes / pages

| Path | File | Notes |
|---|---|---|
| `/products` | `app/products/page.tsx` | Catalog grid, category bar, search |
| `/products/[slug]` | `app/products/[slug]/page.tsx` | Product detail + related products |
| (home section) | `components/Products.tsx` | "Featured Compounds" grid (8 items) |
| (home ticker) | `components/ProductTicker.tsx` | Scrolling name/price marquee |

### Shared components

- `components/NotifyMeButton.tsx` — restock-waitlist button + modal (`compact` and `full` variants)
- `components/LoadingFeedback.tsx` — `SlowLoadingNotice` and `LoadingError`
- `lib/hooks/useSmartLoad.ts` — loading state machine
- `components/PeptideLoader.tsx` — full-screen animated loader (used by auth flows, not the catalog; available for reuse)
- `components/Navigation.tsx`, `components/Footer.tsx` — page chrome

### Contexts / data flow

- `useCart()` (`contexts/CartContext`) — `addItem({ id, name, price, strength, image_url })`
- `useCustomer()` (`contexts/CustomerContext`) — supplies `customer.id` (passed as `customer_id`
  to the product APIs to apply overrides) and `customer.email` (prefilled in the Notify-me modal)

Flow: page mounts → `useSmartLoad` calls `fetch('/api/products?...customer_id')` → API merges
overrides → component stores array → client-side filter (category + search) + sort (out-of-stock
to the bottom) via `useMemo`. The detail page uses a manual `useEffect` (not `useSmartLoad`):
it fetches the product by slug, then fetches its category to build a Related Products list
(filters out the current product, slices to 4).

### `useSmartLoad` state machine

`useSmartLoad<T>(loader, deps, { slowThresholdMs })` returns `{ data, loading, slow, error, reload }`.
- `loading` true until the promise settles
- `slow` becomes true if still loading after `slowThresholdMs` (default **8000ms**)
- `error` true if the loader rejects (logged to console)
- `reload()` re-runs the loader (bumps an internal counter); used by both notice components
- Cancels cleanly on unmount / dep change (guards against setting state after unmount)

---

## UI/UX specification

Design tokens (Tailwind theme): `ink` (near-black `#07203A`), `ink-muted`, `vital` /
`vital-50` / `vital-dark`, `surface` (light grey), `line` (borders), `white`. Bronze is the
accent for purity/COA badges. Cards/inputs use `rounded-xl`; focus rings are `ring-vital/40`.

### Catalog page `/products`

1. **Hero** — white, faint molecular dot-grid SVG (`#molecular-grid`, ~2% opacity). Bronze pill
   badge `Beaker` icon + "Pharmaceutical Grade Quality". H1 "Research Compound Catalog".
   Subhead "HPLC-verified peptides with 99%+ purity for scientific research". Entrance fade/slide
   via framer-motion.
2. **Category bar** — `surface` band, centered wrap of pill buttons. Categories (label → slug):
   All→`All`, Metabolic→`Weight Loss / Metabolic`, Healing→`Healing / Recovery`,
   Anti-Aging→`Anti-Aging / Beauty`, Performance→`Bodybuilding / Fitness`,
   Cognitive→`Cognitive / Focus`, Sexual Health→`Sexual Health`, General Health→`General Health`,
   Hormonal→`Hormonal / Fertility`, Tanning→`Beauty / Tanning`. Each pill: lucide icon + label +
   live count. Active pill: `bg-ink text-white`; inactive: white pill with `border-line`.
3. **Search + results bar** — left: search input (`Search` icon, placeholder "Search compounds...").
   Right: when a category is active, "Clear filter" link (X icon); count line
   `{n} compounds [in {Category}]`. Search matches name/description/category (case-insensitive).
4. **Products grid** — `grid-cols-2 md:grid-cols-3 lg:grid-cols-4`. Out-of-stock items sorted to
   the bottom (stable within in-stock / out-of-stock groups). Card entrance staggered
   (`delay: index * 0.02`).

   Card anatomy:
   - Square image area (`bg-surface`, `object-contain`, hover scale-105); Beaker fallback icon.
   - **Purity badge** top-left: vital text on `vital-50`, e.g. `99%+`.
   - **COA pill** bottom-left (only if `coa_url.length > 0`): `FileText` icon + label `COA`,
     or `COA ×N` when more than one. Links to `coa_url[0]` in a new tab. `title` =
     "View Certificate of Analysis" / "View Certificate of Analysis (N available)".
   - Strength (uppercase, muted), product name (links to detail).
   - Price/action row:
     - `price === 0` → price renders "N/A" (muted); card gets `opacity-60`; action = "Unavailable" (muted text).
     - `stock_quantity === 0 && price > 0` → `NotifyMeButton` (compact).
     - `stock_quantity === 0` (and price 0) → "Out of Stock" (red text).
     - otherwise → price `$NN` + **Add** button (`ShoppingCart` icon; label "Add" hidden on mobile, `bg-ink`).

5. **States**:
   - **Loading skeleton** — 8 pulsing placeholder cards (`animate-pulse`: grey square + two bars).
     If `slow`, a `SlowLoadingNotice` renders above the grid.
   - **Error** — `LoadingError` (see below) replaces the grid.
   - **Empty** — centered: grey circle w/ `Search` icon, H3 "No compounds found", "Try adjusting
     your search or filter", and a "View all compounds" button (resets category + search).
6. **Trust bar** — dark `bg-ink` rounded panel, 4 stats: `99%+ / Verified Purity`,
   `3rd Party / HPLC Tested`, `Same Day / Order Processing`, `Discreet / Secure Packaging`
   (first value in vital).

### Product detail `/products/[slug]`

- **Loading**: skeleton — pulsing breadcrumb bar + two-column (square image block, text bars).
- **Not found**: H1 "Product Not Found", "The product you're looking for doesn't exist.",
  vital "Back to Products" link (ArrowLeft).
- **Hero**: molecular-grid background, "Back to Products" link, two pills: `{category}` (neutral)
  and `{purity} Purity` (vital).
- **Two-column body**:
  - Left: large square image (`bg-surface`, Beaker fallback).
  - Right: H1 name, full `description`.
  - **Specs grid** — adapts: `grid-cols-3` (Purity / Strength / Form) when no COA, else
    `grid-cols-2 sm:grid-cols-4` adding a **COA tile** (vital `FileText`, label `COA` or
    `COA ×N`) linking to `coa_url[0]`.
  - **All certificates** — when `coa_url.length > 1`, a "All certificates" label + pill list
    `COA #1`, `COA #2`, … each opening its URL in a new tab.
  - **Benefits** — if present, "Benefits" heading + bullet list (split on `,`), each with a vital `Check`.
  - **Price + qty + CTA** (bordered, `mt-auto`):
    - `price === 0` → big "N/A"; CTA = disabled "Currently Unavailable" button.
    - `stock_quantity === 0` (priced) → full-width `NotifyMeButton variant="full"`.
    - in stock → price `$NN.NN`; **quantity stepper** stepping by 10 (min 10, default 10);
      CTA `bg-ink` "Add to Cart - $TOTAL" where total = `price * quantity`. After click it
      flips to a green `Added to Cart!` state for 2s. **Add-to-cart batches in groups of 10**
      (calls `addItem` `quantity/10` times).
    - **Trust badges** row: Lab Tested (Shield), Secure Pack (Package), Fast Ship (Truck).
  - **Mechanism of Action** card (if `mechanism`): vital `FlaskConical` icon + heading + text.
  - **Essential Add-on** — dark panel cross-selling "Bacteriostatic Water 30ML" ($20.00,
    "View Product" → `/products/bacteriostatic-water-30ml`), hidden when the current product
    *is* that item.
  - **Quality Certifications** — dark panel, 4 cards: 99%+ Purity, GMP Certified, ISO Compliant,
    COA Available; footer "For Research Purposes Only - Not for human consumption."
  - **Related Products** — up to 4 cards (same category), each linking to its detail page;
    price shows "N/A" when 0.

### Home "Featured Compounds" — `components/Products.tsx`

Section header: vital pill "Featured Compounds", H2 "Popular Research Peptides", subhead
"High-purity compounds for scientific research", and a "View full catalog" link → `/products`.
Grid `grid-cols-2 lg:grid-cols-4`, up to 8 in-stock featured products. Same card pattern
(purity badge, COA pill, Add / Notify-me). Loading: header-bar skeleton + 8 pulsing cards
(+ `SlowLoadingNotice` if slow). Error: `LoadingError`. The COA pill here is a `<button>` that
`window.open`s the first COA (prevents the wrapping `Link` navigation).

### Product ticker — `components/ProductTicker.tsx`

Dark (`bg-gray-900`) full-width marquee. Queries up to 10 active products directly via the anon
client and duplicates the list for a seamless `animate-ticker` scroll. Each entry: bullet dot,
product name, `$price.toFixed(2)`, links to the detail page. Renders nothing while empty.

### `NotifyMeButton` (restock waitlist) — `components/NotifyMeButton.tsx`

Two trigger variants:
- `compact` (grid cards): small `bg-surface` pill, vital `Bell` icon, label "Notify me"
  (desktop) / "Notify" (mobile).
- `full` (detail page): full-width bordered button, vital `Bell`, "Notify me when back in stock".

Clicking opens a centered modal (`bg-ink/40` backdrop blur, `role="dialog"`, body scroll locked):
- Header: vital Bell tile, title "Restock alerts", product name subtitle, X close.
- On open it prefills the logged-in customer's email and `GET`s subscription status; while
  checking it shows a centered spinner (`Loader2`).
- **Already subscribed** view: green `Check`, heading "You're on the list" (just subscribed) or
  "Alert is active", body "We'll email **{email}** as soon as {product} is back in stock.", and
  two buttons: "Remove alert" (`BellOff`, hover red, DELETEs) and "Done".
- **Subscribe form**: copy "We'll send a one-time email to this address when it's available
  again." (or, after removal, "Your alert was removed. Want back on the list? Confirm your email
  below."). Label "Email address" (uppercase), email input (`placeholder="you@example.com"`,
  `required`), submit "Notify me" (Bell). While saving: spinner + "Saving...".
- Errors render as small red text; default message "Please try again later."

### Shared loading/error components — `components/LoadingFeedback.tsx`

- **`SlowLoadingNotice`** — vital-tinted bar: spinning `RefreshCw`, "This is taking a while.",
  and a vital "Click here to reload" button.
- **`LoadingError`** — centered: red circle w/ `AlertCircle`, "Please try again later",
  `bg-ink` "Try again" button (`RefreshCw`).

### Responsive

Mobile-first: grids collapse to 2 columns; detail page collapses to a single column; "Add"
labels and some copy hide on small screens (`hidden sm:inline`). Modals are full-width with `p-4`
gutters. Inputs/buttons stack via `flex-col sm:flex-row`.

---

## Dependencies

- **npm**: `@supabase/supabase-js`, `next` (15, App Router), `react`/`react-dom` (19),
  `framer-motion` (animations), `lucide-react` (icons), `tailwindcss`. (`@tanstack/react-query`
  is installed but not used by these pages.)
- **Env vars**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon client &
  `ProductTicker`), `SUPABASE_SERVICE_ROLE_KEY` (the `/api/products*` and `/api/stock-notifications`
  routes). The restock email path (admin side) additionally needs SMTP/Resend config —
  see Module 4.
- **Other modules**: CartContext & CustomerContext (cart + customer pricing identity);
  `lib/supabase.ts` (`supabase` shared client); the Inventory / low-stock module owns the
  `stock_quantity` / `low_stock_threshold` semantics; the restock *email send* lives in the
  Admin Products PUT route (Module 4) using `lib/email-smtp`.

---

## Porting notes

- **No affiliate logic on the storefront** — these public pages and APIs are affiliate-free; nothing to strip here.
- **COA migration**: ensure the target DB uses the `coa_url TEXT[]` array column (default `[]`),
  not a single `certificate_url`. Always normalize to a filtered `string[]` server-side
  (see `normalizeCoa`) so the UI's `.length`/`[0]` access is safe.
- **Two "out of stock / unavailable" cases are distinct**: `stock_quantity === 0` (waitlist /
  "Out of Stock") vs `price === 0` (truly "Unavailable / N/A", `opacity-60`, no waitlist). Keep both.
- **Featured excludes out-of-stock** (`stock_quantity > 0` filter) — intentional.
- **Customer pricing is optional**: the override merge degrades gracefully (returns base prices on
  any override-fetch failure). If you don't port customer-specific pricing, simply omit the
  `customer_id` param and the override block.
- **Add-to-cart quantity is in multiples of 10** on the detail page — preserve the stepper-by-10
  + batch-add behavior or adjust deliberately.
- **`useSmartLoad`** is the recommended loading pattern (skeleton + slow-notice + retry). Port it
  first; the catalog and featured sections depend on it. Detail page currently uses a manual
  `useEffect` — could be migrated to `useSmartLoad` for consistency but isn't required.
- Implementation order: (1) `products` schema + `stock_notifications` table, (2) `useSmartLoad`
  + `LoadingFeedback`, (3) `/api/products` & `/api/products/featured`, (4) catalog & detail pages,
  (5) `NotifyMeButton` + `/api/stock-notifications`, (6) home Featured + Ticker.
