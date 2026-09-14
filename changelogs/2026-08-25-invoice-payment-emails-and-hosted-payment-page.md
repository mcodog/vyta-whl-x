# Invoice payment emails, a hosted payment page, and crypto wallets

**Date:** 2026-08-25
**Area:** Admin › Invoices · Admin › Settings · Storefront `/pay`

## Summary

Invoices gain a **second customer email**. The existing one — the invoice PDF —
is untouched. The new **payment request** points at a page on our own site
(`/pay/<token>`) where the customer sees their order and is asked to pay one of
two ways. An admin can have us **email** that link, or just **copy** it and send
it however they like:

- **Crypto** — an instructions page showing a receiving wallet (address, QR
  code, memo) configured in admin Settings, plus a box for the customer to hand
  back their transaction hash.
- **Visa / Mastercard** — the **PuraMass (Stealth Health) hosted checkout**. We
  hand the invoice's line items off and redirect to the returned payment link;
  the paid status comes back over the webhook we already run.

The invoice screens then show which method the customer chose, the Stealth
Health payment link with the date it was created (so it can be resent), any
crypto reference submitted, and a timeline of everything that happened.

## Customer: the payment page

- `/pay/<token>` — the order summary (line items, subtotal, shipping, tax,
  amount already paid, **balance due**) followed by the two payment options. The
  token in the URL is the only credential, so a guest with no account can pay.
- The page reflects state: a paid or cancelled invoice shows as settled rather
  than asking for money, and a customer who has already declared a crypto
  transfer sees that we're confirming it.
- `/pay/<token>/crypto` — the instructions page. Picks a wallet (when more than
  one is configured), shows the exact amount due, the address with a locally
  rendered QR code, and any required memo/tag — each with a copy button. The
  wording is explicit that submitting a transaction hash does **not** mark the
  invoice paid.
- **Visa/Mastercard** creates a PuraMass hosted-checkout order for the invoice
  and redirects. Re-opening the page reuses the in-flight hand-off rather than
  creating a second order.
- Neither page is indexable, and `/pay` is public even if site-wide auth is
  turned on — otherwise every emailed payment link would break.

## Admin › Invoices

- New **Request Payment** panel on the invoice screen. Two ways to get the link
  to the customer, on a segmented toggle:
  - **Email it** — send/resend the payment email to an editable recipient.
  - **Copy link** — mints the link without sending anything, for pasting into a
    chat, a text, or your own message. Both hand out the **same** URL, so a link
    copied today and an email sent tomorrow point at the same page.

  The panel then reads back
  - when it was last sent, to whom, by which admin, and how many times,
  - the payment-page link (copyable),
  - the method the customer chose and when,
  - the **Stealth Health checkout** — its status, **the date it was created**,
    the **payment link** for resending, and the transaction id,
  - any **crypto transaction reference** the customer submitted, with a reminder
    to verify it on-chain before recording the payment,
  - a collapsible **payment activity** timeline.
- The invoices **list** (table and mobile cards) now carries a payment-method
  badge beside the status, so the chosen method is visible without opening the
  invoice.
- Sending is admin-only; assistants and affiliates see the panel read-only.

## Admin › Settings

Two new sections, both reachable from the right-side nav:

- **Payment Emails** — the payment-request template (subject + message, with
  merge-variable chips including `{{payment_url}}`), and per-method toggles for
  crypto and Visa/Mastercard. Each toggle warns when the method can't actually
  run — no wallets configured, or no PuraMass credentials on the server.
- **Crypto Payments** — the receiving wallets offered on the payment page. Each
  has a label, network, address, optional memo, and an on/off switch, so a
  wallet can be hidden without losing the address. Free-text instructions can be
  shown alongside them, falling back to sensible built-in wording.

## Payment tracking

- A paid card payment arrives on the existing `/api/webhooks/stealth-health`
  endpoint. Hand-offs are now tagged with an **origin**: a storefront cart
  hand-off still creates a fulfillment invoice, while an invoice payment-page
  hand-off **records a payment against that invoice** — rolling its status
  forward (partial → paid) and decrementing stock, exactly as a manually
  recorded payment does.
- Recording is idempotent on the transaction reference, so a webhook redelivery
  can't double-pay an invoice, and the amount is clamped to the balance due.
- PuraMass charges its own catalog prices, which can differ from the invoice
  total. Whatever actually lands is recorded, so a shortfall shows up as a
  partially paid invoice for an admin to reconcile rather than being silently
  treated as settled.
- Crypto payments stay manual on purpose: the customer's declaration is stored
  and surfaced, but an admin verifies the transfer and records the payment.

## Migration

Run `invoice-payment-request-migration.sql` in the Supabase SQL editor. It adds:

- `invoices` — `payment_token`, payment-email tracking columns, the selected
  method, and the crypto declaration fields.
- `site_settings` — `crypto_wallets`, `crypto_payment_instructions`, the
  payment-email template, and the two per-method toggles.
- `invoice_payment_email_log` — every payment-request send (success or failure).
- `invoice_payment_events` — the customer-facing payment timeline.
- `puramass_orders.origin` — storefront vs invoice hand-off.
- Widens the `payments.method` check so `crypto` and `card` inserts can't fail.

Every new read is written defensively, so the app keeps working on a database
where this migration hasn't run yet — the new UI simply reads as unconfigured.
