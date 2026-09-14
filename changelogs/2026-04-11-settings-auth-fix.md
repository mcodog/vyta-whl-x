# Admin Settings Authentication Fix

**Date:** April 11, 2026
**Type:** Bug Fix
**Status:** Completed ✅

---

## Overview

Fixed a "Not authenticated" error that occurred when admin users attempted to change the checkout type or manage admin email addresses on the Settings page. The route was using a server-side session lookup that has no browser cookie context in Next.js App Router, causing it to always return null.

---

## What Was Changed

### 1. Settings API Route — Auth Pattern
**File:** `app/api/admin/settings/route.ts`

Replaced `supabase.auth.getSession()` (cookie-based, incompatible with App Router server routes) with the Bearer token pattern used by all other admin routes:

- Removed the shared `supabase` anon client import
- Added a service-role Supabase client (consistent with `users`, `products`, `affiliates` routes)
- `PUT` handler now reads the `Authorization: Bearer <token>` header and verifies the user via `supabase.auth.getUser(token)`
- Fetches the caller's role directly from the `customers` table instead of proxying through `/api/auth/customer`

### 2. Settings Page — Sending Auth Header
**File:** `app/(admin)/admin/settings/page.tsx`

Updated the `saveSettings` function to include the session token with every mutating request:

- Imported the client-side `supabase` instance
- Gets the current session via `supabase.auth.getSession()` before each PUT call
- Sends `Authorization: Bearer <access_token>` header alongside the JSON body

---

## Root Cause

The original `PUT` handler called `supabase.auth.getSession()` on the server, which relies on browser cookies. In Next.js App Router API routes, the cookie context is not automatically available to the anon Supabase client, so the session was always `null` — causing every settings save attempt to return `401 Not authenticated`.

---

## Files Modified

| File | Change |
|------|--------|
| `app/api/admin/settings/route.ts` | Switched to Bearer token auth, removed anon client dependency |
| `app/(admin)/admin/settings/page.tsx` | Added session retrieval and Authorization header to PUT requests |
