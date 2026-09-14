# Inactive-Customer Alerts & Customer Takeover

Date: 2026-07-03

Two related additions to help the admin team follow up on customers who sign up
but don't buy.

## 1. Inactive-customer notifications

A new **Inactive Customer Alerts** section in **Admin → Settings** emails the
configured admin addresses when a customer registers but still hasn't placed an
order after a set amount of time.

- An **On/Off** toggle and one or more **day thresholds** (e.g. 3, 7, 14).
  Each threshold sends a separate reminder, once per customer.
- A daily job (`/api/cron/inactive-customers`) finds customers with no orders
  whose account age falls in a threshold's window and emails the admin list,
  including whether the customer currently has items in their cart and a link to
  take them over. Each (customer, threshold) fires exactly once, tracked in
  `customer_inactive_notifications`.
- **Scheduled from Supabase** via `pg_cron` + `pg_net` (see the migration) — no
  external cron service. The job stays a Next.js route so it reuses the existing
  nodemailer email stack.

## 2. Customer takeover / contact tracking

A new admin page, **`/admin/customers/[id]/takeover`**, linked from the
new-customer and inactive-customer emails and from a **Contact** button on the
Customers list. It shows the customer's contact details, order history, whether
they've **ordered** and whether they have items **in cart**, and lets an admin
**take over** the customer for contacting (or **release** them). Customers show
as *Available for takeover* until an admin claims them; the claiming admin's
name/email is recorded. Requires a signed-in **admin** (assistants view only).

To power the "in cart" indicator (the cart was previously browser-only), a
signed-in customer's cart is now mirrored server-side to `customer_carts`
(best-effort, debounced) on change.

## Data model

- `site_settings`: `inactive_customer_notification_enabled` (bool),
  `inactive_customer_notify_days` (int[]).
- `customers`: `assigned_admin_id` (→ `customers`), `assigned_admin_name`,
  `assigned_admin_email`, `assigned_at`.
- New `customer_inactive_notifications` (customer × threshold sent-log) and
  `customer_carts` (latest cart snapshot per customer).

## Files

- `inactive-customer-notifications-and-takeover-migration.sql` — schema +
  pg_cron/pg_net schedule.
- `app/api/cron/inactive-customers/route.ts` — the daily no-order check.
- `app/api/admin/customers/[id]/takeover/route.ts` — GET details, POST take
  over, DELETE release.
- `app/api/customers/cart/route.ts` — cart snapshot sync.
- `app/(admin)/admin/customers/[id]/takeover/page.tsx` — the takeover page.
- `app/(admin)/admin/settings/page.tsx`, `app/api/admin/settings/route.ts` —
  the new settings section + persistence.
- `lib/email-smtp.ts` — `sendInactiveCustomerAdminNotification` + takeover link
  on the new-customer email; wired into the test-email catalog.
- `contexts/CartContext.tsx` — server cart sync for signed-in customers.
