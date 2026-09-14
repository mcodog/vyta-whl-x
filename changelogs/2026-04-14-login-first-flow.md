# Login-First Landing Flow & Auth Config

**Date:** April 14, 2026
**Type:** Feature
**Status:** Completed ✅

---

## Overview

Changed the customer landing flow so that the home page (`/`) requires a login. Unauthenticated visitors are redirected to `/login`, and after a successful login customers land on `/products`. A config file allows toggling whether authentication is required to access all pages site-wide.

---

## What Was Changed

### 1. Auth Config File
**File:** `auth.config.js` *(new)*

A simple JS config file at the project root that controls site-wide auth enforcement:

```js
const authConfig = {
  requireAuth: false, // Set to true to require login for all pages
};
```

- `requireAuth: false` (default) — all pages are publicly accessible
- `requireAuth: true` — unauthenticated users can only access `/login`, `/affiliate/login`, and `/affiliate/signup`; all other routes redirect to `/login`

---

### 2. Home Page (`/`) — Auth-Aware
**File:** `app/page.tsx`

Converted from a static marketing page to a client component that checks login state:

- **Logged in** → renders the full home page (Navigation, Hero, Products, Features, Footer)
- **Not logged in** → redirects to `/login`
- **Loading** → shows a loading screen while Supabase session resolves

---

### 3. Login Page — Post-Login Redirect
**File:** `app/(customer)/login/page.tsx`

Changed the default post-login redirect destination from `/account/dashboard` to `/products`.

The `?redirect=` query parameter still works — any explicit redirect overrides the default.

---

### 4. RouteGuard Component
**File:** `components/RouteGuard.tsx` *(new)*

Client component added to the root layout that enforces `auth.config.js`:

- When `requireAuth: false` — completely transparent, no overhead
- When `requireAuth: true`:
  - While auth state is loading → shows a loading screen to prevent content flash
  - Not logged in + protected route → redirects to `/login`, renders nothing
  - Not logged in + public route (`/login`, `/affiliate/login`, `/affiliate/signup`) → renders normally
  - Logged in → renders normally

---

### 5. Root Layout — RouteGuard Wrapper
**File:** `app/layout.tsx`

Wrapped `{children}` with `<RouteGuard>`. `<ChatBubble>` and `<AgeVerification>` remain outside the guard and always render.

---

## Behaviour Summary

| Config | User state | Visits `/` | Visits `/products` | Visits `/login` |
|---|---|---|---|---|
| `requireAuth: false` | not logged in | → `/login` | shows page | shows login form |
| `requireAuth: false` | logged in | shows home page | shows page | → `/products` |
| `requireAuth: true` | not logged in | → `/login` | → `/login` | shows login form |
| `requireAuth: true` | logged in | shows home page | shows page | → `/products` |

---

## Files Modified / Created

| File | Change |
|------|--------|
| `auth.config.js` | New — site-wide auth config |
| `app/page.tsx` | Replaced static landing with auth-aware client component |
| `app/(customer)/login/page.tsx` | Default post-login redirect changed to `/products` |
| `components/RouteGuard.tsx` | New — enforces `requireAuth` config |
| `app/layout.tsx` | Wrapped children with `RouteGuard` |
