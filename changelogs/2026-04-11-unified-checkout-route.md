# Unified /checkout Route

**Date:** April 11, 2026
**Type:** Refactor
**Status:** Completed ✅

---

## Overview

Consolidated two separate checkout pages (`/checkout` and `/checkout-email`) into a single `/checkout` route. The page now fetches the active `checkout_type` setting on load and renders either the crypto or email invoice UI accordingly — same URL, swappable component.

---

## What Was Changed

### 1. Unified Checkout Page
**File:** `app/checkout/page.tsx`

- Renamed the original crypto checkout component to `CryptoCheckoutContent`
- Ported the email invoice checkout from `app/checkout-email/page.tsx` into this file as `EmailCheckoutContent`
  - Fixed login redirect from `/login?redirect=/checkout-email` → `/login?redirect=/checkout`
- Added a `CheckoutContent` wrapper that:
  1. Fetches `GET /api/admin/settings` on mount to read `checkout_type`
  2. Shows a loading spinner while resolving
  3. Renders `<CryptoCheckoutContent />` or `<EmailCheckoutContent />` based on the setting
  4. Defaults to `crypto` if the fetch fails
- Added `PICKUP_ADDRESS` constant (previously only in the email page)
- Added missing lucide icons to the import: `Mail`, `Truck`, `Store`

### 2. Cart Page — Simplified Routing
**File:** `app/cart/page.tsx`

- Removed the `checkoutType` state and its `useEffect` settings fetch
- Removed the conditional `checkoutUrl` variable
- Hardcoded `href="/checkout"` on the "Proceed to Checkout" button
- Replaced the conditional payment trust badge (`📧`/`₿`) with a static `💳` badge
- Cleaned up unused `useState` and `useEffect` imports

### 3. Checkout Email — Redirect
**File:** `app/checkout-email/page.tsx`

- Replaced the full page component with a server-side `redirect('/checkout')`
- Any existing bookmarks or links to `/checkout-email` transparently land on `/checkout`

---

## Routing After Change

| Entry point | Destination |
|---|---|
| Cart → "Proceed to Checkout" | `/checkout` |
| `/checkout-email` (old link) | Redirects → `/checkout` |
| Login redirect param | `/login?redirect=/checkout` |
| `checkout_type = 'crypto'` | Renders crypto payment UI |
| `checkout_type = 'email'` | Renders email invoice UI |
