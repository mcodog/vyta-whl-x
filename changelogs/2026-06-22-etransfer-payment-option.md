# Interac e-Transfer Payment Option at Checkout

**Date:** June 22, 2026
**Type:** Feature Addition
**Status:** Completed ✅

---

## Overview

Added an explicit **Interac e-Transfer** payment option to the email/invoice
checkout flow. When a customer places an order, they now select e-Transfer as
their payment method and receive an email with their order and a message saying
payment instructions will follow shortly. The admin is notified that they need
to send those instructions.

This formalizes the store's single payment path (the email-invoice flow; crypto
remains disabled site-wide) as a clearly labeled e-Transfer method.

---

## What Changed

### 1. Checkout Page — Payment Method section
**File:** `app/checkout/page.tsx` (`EmailCheckoutContent`)

- Added a **Payment Method** card showing **Interac e-Transfer** as the selected
  method, with the note that payment instructions are emailed shortly after the
  order is placed.
- The submit payload now includes `paymentMethod: "etransfer"`.
- Updated the order-confirmation screen and the sidebar note to reflect the new
  protocol: *"We've emailed your order … and will send your Interac e-Transfer
  payment instructions shortly."*

### 2. Order API
**File:** `app/api/orders-email/route.ts`

- Resolves `paymentMethod` server-side (currently always `'etransfer'`) and
  passes it to both the customer invoice and admin notification emails. The
  value is not trusted from the client.

### 3. Email Templates
**File:** `lib/email-smtp.ts`

- `sendCustomerInvoiceSMTP()` — accepts an optional `paymentMethod` and the
  payment block now reads: *"Payment — Interac e-Transfer: We will send you
  instructions for your payment shortly. Your order will be processed once
  payment is received."* (previously "send payment via e-Transfer to the email
  address provided separately").
- `sendAdminInvoiceNotificationSMTP()` — accepts an optional `paymentMethod`,
  shows a **Payment Method** row, and adds an **Action needed** banner reminding
  the admin to send e-Transfer instructions to the customer.

### 4. Admin Orders UI
**Files:** `lib/paymentMethod.ts` (new), `app/(admin)/admin/orders/page.tsx`,
`app/(admin)/admin/orders/[id]/page.tsx`

- New `paymentMethod` helper maps an order's `crypto` column to a friendly
  label (`email`/`etransfer` → "Interac e-Transfer"), with a short variant for
  table cells.
- Order detail page now shows **"Interac e-Transfer"** as the Payment Method
  (previously rendered the raw `EMAIL`).
- Orders list gained a **Payment** column showing the method per order.

---

## Protocol

```
1. Customer fills checkout form, sees "Interac e-Transfer" as the payment method
2. Submits order → POST /api/orders-email (paymentMethod: 'etransfer')
3. Order created with status 'pending_invoice'
4. Customer receives invoice email: order summary + "instructions shortly"
5. Admin receives notification with "Action needed: send e-Transfer instructions"
6. Admin sends payment instructions, then processes the order on payment
```

---

## Files Modified

- `app/checkout/page.tsx` — Payment Method section, confirmation/sidebar copy, payload
- `app/api/orders-email/route.ts` — pass `paymentMethod` to emails
- `lib/email-smtp.ts` — e-Transfer wording + admin action reminder

---

**Status:** ✅ Ready
