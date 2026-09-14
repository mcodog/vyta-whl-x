# Storefront UX Modernization — Roadmap & Parking Lot

Working branch: `claude/storefront-ux-modernization-scp03u`

This file tracks the storefront modernization ideas discussed, their status, and
enough detail to pick each one back up later without re-deriving the plan.

Legend: ✅ accepted / 🅿️ parked (revisit later) / 🔨 in progress / 🚢 shipped

---

## Accepted — to build

| # | Idea | Status | Notes |
|---|------|--------|-------|
| 1 | Slide-out cart drawer + "faster to checkout" UX bundle | ✅ | Priority. See "Faster-to-checkout" section below. |
| 3 | Breadcrumbs on catalog/product pages | ✅ | Adds nav clarity + SEO structured data. |
| 4 | Free-shipping progress indicator | ✅ | Lives in the cart drawer + cart page. |
| 5 | Recently viewed products | ✅ | `localStorage`-backed strip on catalog + product pages. |
| 8 | Richer product detail page | ✅ | Image gallery/zoom, sticky add-to-cart bar, collapsible info accordions. |
| 9 | Command-palette / instant global search (⌘K) | ✅ | Nav-level search overlay with instant results + thumbnails. |
| 10 | Dark mode | ✅ | Theme tokens already semantic (`ink`/`surface`/`line`/`bronze`); add `dark:` set + toggle. |
| 11 | Product comparison | ✅ | See "Product comparison — how" section below. |
| 12 | PWA polish | ✅ | Add-to-home-screen, offline catalog caching, skeleton polish. |

---

## 🅿️ Parked — revisit later

### #2 — Hero section rework (parked)
Not a swap of the current Unsplash image (`components/Hero.tsx:118`) but a full
redesign of the hero. Revisit as its own design pass. When we come back:
- Decide on the new concept/direction first (layout, imagery, message).
- Still fix the external-image dependency (LCP + brand) as part of it.

### #6 — Wishlist / "save for later" (parked)
- Heart toggle on product cards (`app/products/page.tsx`) and product detail.
- Persist for logged-in customers (new `wishlist` table keyed to customer id);
  fall back to `localStorage` for guests, merge on login.
- Pairs with the existing "Notify Me" back-in-stock flow (`NotifyMeButton.tsx`).

### #7 — Product reviews / ratings (parked)
- Customer-facing verified-purchase ratings + review text on product detail.
- Aggregate star rating + count under product name on cards and detail page.
- Needs: `reviews` table, moderation/admin surface, "verified purchase" tie to
  orders, and anti-spam. Higher effort — treat as its own project.

---

## Faster-to-checkout — UX concepts (for #1)

Goal: shorten the path from "interested" to "paid" and reduce drop-off.

Discussion notes captured in chat; short list of candidates:
- Slide-out cart drawer that opens on add (stay in catalog, no page nav).
- "Add to cart" → optional "Buy now" (skip cart, straight to checkout).
- Persistent sticky mini-cart / checkout affordance.
- Free-shipping progress bar (motivates one more item, but also speeds intent).
- Express/one-page checkout review; remember returning-customer details.
- Reduce required fields; address autocomplete already exists
  (`components/AddressAutocomplete.tsx`) — lean on it.
- Cart persistence across sessions/devices for logged-in customers.
- Clear, always-visible cart count + subtotal in nav.

(Refine and prioritize before building.)

---

## Product comparison — how (for #11)

Approach sketch:
- Add a "Compare" checkbox/affordance on product cards (`app/products/page.tsx`).
- Track selected compare ids in a small context or `localStorage` (cap at 3–4).
- Floating "Compare (n)" bar appears once ≥2 selected.
- Comparison view: side-by-side table of the fields already in the `Product`
  model — purity, strength, price, price/vial, category, COA availability,
  stock. No schema changes needed; it's a new read-only view over existing data.
- Mobile: horizontal scroll or stacked accordion per attribute.
