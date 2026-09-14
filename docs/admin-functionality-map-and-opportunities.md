# Admin Functionality Map & Feature Opportunities

> **Purpose.** A complete diagnosis of the current back-office (`/admin`) surface, mapped
> against how the business actually runs — a wholesale operation that **bills a customer,
> ships to that customer's client, works leads through sales people, and remembers each
> customer's pricing and preferences.** Part 1 maps everything that exists. Part 2 traces
> the three business flows through it. Part 3 is the point of the exercise: a prioritized
> set of features worth building, each grounded in what's already here.
>
> **Scope:** the `admin`, `assistant`, and `affiliate` back-office. Warehouse floor and
> storefront are summarized where they touch these flows.
> **Generated:** 2026-07-30.

---

## How to read this

The admin is **already a mature system** — ~19 modules, five roles, a genuinely
sophisticated invoice/pricing/fulfillment core. This document deliberately separates:

- **What exists** (Part 1 + the "Foundation" list) — so we don't rebuild it.
- **What's thin or missing** (Part 2 "gaps" + Part 3) — where new work pays off.

Every recommendation is tagged for **impact** (to *this* business model) and **leverage**
(how much it reuses infrastructure that already exists):

- **Quick win** — mostly reuses cron/email/audit/pricing plumbing already built.
- **Build** — a real feature, but on top of existing tables and patterns.
- **Bigger bet** — new surface area (a portal, a tracking dimension), higher payoff.

---

# Part 1 — The functional map

Five nav groups, roughly 19 modules. Roles: **admin** (full CRUD), **assistant**
(read-most, no writes), **affiliate** (scoped B2B "client" portal), **warehouse**
(fulfillment floor), **customer** (storefront). RBAC is enforced server-side in every API
route and mirrored client-side for the UI (`lib/permissions.ts`).

### Overview
- **Dashboard** — revenue / pending / affiliate / pending-commission stat cards, recent
  orders, low-stock alerts, live fulfillment feed, auto-shipment failure feed. Affiliates
  get a trimmed version scoped to their own book.
- **Analytics** — date-ranged revenue (invoiced / paid / outstanding / overdue, **CAD & USD
  tracked separately, never converted**), inventory on-hand value, incoming-PO value, and
  leaderboards (top customers / sales people / affiliates / products). Downloadable,
  section-toggleable report.

### Orders & Fulfillment
- **Invoices** — the core. Create/edit with a customer picker, line builder (box **or**
  vial pricing, labeled/unlabeled, CAD/USD), auto-applied per-customer pricing, sales
  person + auto-commission, tax %, shipping, processing fee, dates, notes. **Bill-to
  customer / ship-to client** with a blind packing list. Record payment (Card / E-Transfer
  / Cash / Crypto / Other), overpayment-guarded, auto status + stock decrement. Split on
  backorder, aging report, prepaid conversion (auto-generates supplier POs), PDF, templated
  email with CC defaults, and **cross-site export** to sister sites.
- **Backorders** — open / handled / history; "Fulfill" deep-links to a prefilled PO;
  recomputed automatically from line qty vs stock.
- **Stock Requests** — "notify me" waitlist aggregated per product, most-wanted first;
  restocking emails everyone waiting.
- **Purchase Orders** — supplier picker (+ inline create), line items, discount/shipping/
  tax, **landed-cost allocation** (true COGS), per-line receiving with history, cheaper-
  supplier detection, PO PDF. Receiving increments stock.
- **Warehouse (admin view)** — manage warehouse staff, per-packer performance, email-send
  permission, live activity log.
- **Fulfillment Queue** (`/warehouse`) — realtime queue, method-aware packing checklist,
  packed-photo capture, per-line fulfill/backorder, label status, packed/shipped emails.

### Catalog
- **Products** — table with inline edit (price / USD price / vial price / stock / vials-per-
  box / threshold), image + multi-COA upload, CSV import, stock reports, low-stock
  highlighting, per-field price/stock **history with revert**.
- **Pricing** — four-layer resolution (**per-customer override → active pricelist → catalog
  → vial fallback**), named price lists (create/copy/activate/apply-to-customer),
  per-customer overrides (single + bulk grid + CSV import/export), labeled/unlabeled and
  per-vial prices, per-customer product visibility, CAD/USD-aware.
- **Lab Results** — Certificate-of-Analysis records (lab, sample ID, compound/CAS, purity,
  method, dates); covered products derived by matching against each product's COA links.

### People
- **Customers** — the billing party **and** the login account. Profile, alternate email,
  address, default sales person, currency preference, labeled/unlabeled default, custom
  pricing, product visibility, saved ship-to clients, magic-link sign-in, soft-deactivate,
  CSV report. *(No dedicated detail page — the list + modals + the takeover page are the
  hub.)*
- **Genealogy** — an ownership tree: sales person / affiliate → customer → client (ship-to),
  with rolled-up invoice count, revenue, and client footprint. Pan/zoom, search, re-root by
  sales person or affiliate.
- **Affiliates** — apply/approve or admin-create; referral codes; affiliate-specific
  pricelists copied onto bound customers; a scoped `/admin` portal (their customers,
  invoices, commissions); performance metrics. **10% customer discount + 10% affiliate
  commission** (hardcoded).
- **Sales People** — lightweight internal reps (may have no login), default **5% commission**,
  live paid/pending earnings. Attached to invoices and settable as a customer's default.
- **Commissions** — unified affiliate + sales ledger, filter/search, mark paid (per row or
  per recipient), CSV export. Rates are **snapshotted** onto each invoice so changing a rate
  never rewrites history.
- **Users** — staff CRUD, role assignment (customer / warehouse / assistant / admin),
  active = auth ban/unban.

### System
- **Changelog** — a full internal changelog surface (categories, impact, calendar, report).
- **Audit Logs** — append-only log of virtually every admin mutation, with a per-actor
  viewer and action badges.
- **Error Logs** — 5xx capture grouped by fingerprint, resolve/unresolve.
- **Settings** — checkout, admin/CC emails, invoice email templates (live preview),
  Easyship config + auto-shipment, fees & thresholds, USD exchange rate, inactive-customer
  alerts, scheduled stock-report email, and cross-site invoice export destinations.

**Automation (cron):** payment checks, inactive-customer alerts, delayed e-Transfer emails,
scheduled stock reports. **Stock is the hub** — POs increase it, packing/paying decreases it
(idempotent RPCs), cancel restores it, every change writes an inventory + price/stock
history row and fires low-stock + waitlist logic.

---

# Part 2 — Your business, mapped through the system

### Flow 1 — Wholesale invoicing (info, line items, saved pricing & preferences)
**Well covered.** Picking a customer prefills their ship-to, currency, sales person, and
label preference; the line builder auto-prices from that customer's saved list; on save you
can push the sales person, label choice, prices, and address *back* onto the customer so the
next invoice is faster. Custom per-customer / per-vial / labeled-vs-unlabeled pricing all
persist. This is the strongest part of the system.

*Thin spots:* no **one-click reorder / duplicate** of a prior invoice (wholesale is repeat
business — this is retyped every time); no **quote/estimate** step before a firm invoice;
tax is a **single manual %** with no per-customer tax profile (resellers are often
tax-exempt with a resale certificate).

### Flow 2 — Bill the customer, ship to their client (blind drop-ship)
**Covered, and genuinely well-designed.** An invoice carries a `client_id` and a
`ships_to_client` flag; the parcel ships to the client's address under the customer's name,
and the client receives **only a packing list (no pricing) — never the invoice.** Clients
are a reusable per-customer address book, and the genealogy tree already visualizes
customer → client.

*Thin spots:* clients can only be **created inline on an invoice** — there's no place to
**edit or manage** a client, see a **client's own order history**, reorder for a specific
client, or store per-client shipping notes. Given this is the model's differentiator, the
client record is under-built. There's also **no per-client analytics** — you can't see which
end-clients actually drive volume (i.e. which ones should become direct customers).

### Flow 3 — Sales people put customers forward
**Covered on the money side.** A customer has a default sales person; invoices snapshot the
rep's rate and accrue a commission row; the unified commissions ledger pays them out.
Genealogy shows each rep's book of business.

*Thin spots:* internal sales people have **no login/portal** (only affiliates do) — a rep
can't self-serve their own customers, invoices, or pipeline; there are **no notes, follow-up
tasks, or a "last contacted"** anywhere on a customer (the only CRM-ish primitive is
"takeover" contact-ownership); and there are **no rep targets or a pipeline view**.

---

# Part 3 — Feature opportunities (prioritized)

Grouped by theme. Ordered roughly by payoff-to-effort for *this* business.

## A. Get paid faster & manage credit (AR maturity)

1. **Automated invoice reminders / dunning.** *(High impact · Quick win)*
   Before-due, on-due, and overdue reminder emails on a schedule. The cron runner, email
   templates, CC lists, and the `overdue` status all already exist — this is mostly a new
   scheduled job plus a per-invoice "reminders" toggle. Directly accelerates cash.

2. **Per-customer credit terms + credit limit + hold.** *(High · Build)*
   Today `due_date` is a flat +30 days. Add Net 15/30/60 per customer (auto-set due date),
   an optional credit limit, and a soft "over limit / on hold" flag surfaced at invoice
   creation. Natural extension of the existing customer + invoice tables.

3. **Customer statements.** *(High · Build)*
   A per-customer "here's everything open, with a running balance" statement (PDF + email),
   built from invoices you already have. The aging report is account-wide; this is the
   per-customer view a wholesale buyer expects at month-end.

4. **Credit notes / refunds / returns (RMA).** *(Medium · Build)*
   Cancel currently restores stock but there's no partial **credit memo** against a paid
   invoice or a returns path. Add credit notes (apply to balance or refund) and a light RMA
   so returns re-stock correctly and show on the statement.

5. **Online payment / "request payment" link.** *(Medium · Build → Bigger bet)*
   A hosted pay link on the invoice (structured e-Transfer confirm now; a card/crypto option
   later). Even a "Request payment" email with clear instructions + a one-click customer
   confirm shortens collection.

## B. The customer & client relationship (the differentiator)

6. **Customer 360 detail page.** *(High · Build — foundational)*
   There is no real customer detail page today. A single view — profile, pricing, sales rep,
   balance, every invoice, every client, and an activity timeline — becomes the home base
   for everything else in this section. Highest-leverage structural addition.

7. **Full clients (ship-to) management.** *(High · Build)*
   Promote clients from "created inline on an invoice" to first-class: edit/deactivate a
   client, per-client order history, **reorder for this client**, and per-client shipping
   notes. This is the model's core relationship and it's currently the thinnest record in
   the system.

8. **Per-client analytics.** *(Medium · Build)*
   Volume/revenue per end-client, and a "this client orders like a direct customer" signal.
   Genealogy already carries the customer→client structure; this adds the numbers.

9. **Customer notes + follow-up tasks (light CRM).** *(Medium · Build)*
   Free-text notes, a "last contacted" stamp, and simple follow-up reminders on a customer —
   the thing sales reps actually need day-to-day. Reuses the audit/timeline pattern.

## C. Sell more, repeat business

10. **One-click reorder / duplicate invoice / saved templates.** *(High · Quick win)*
    "New invoice from this one," and per-customer saved baskets. Wholesale reorders the same
    lines constantly; the invoice + pricing engine already exists, so this is largely a
    clone-and-reprice action. Big daily time saver.

11. **Quotes / estimates → convert to invoice.** *(Medium · Build)*
    A real quote (with expiry and an "accepted" state) that converts to an invoice on
    approval. Draft invoices half-cover this; a named quote makes the sales motion cleaner.

12. **Sales-rep portal + targets.** *(Medium · Bigger bet)*
    Mirror the affiliate portal for internal reps: their customers, their invoices, their
    commissions, and a monthly target/pipeline. The scoping pattern (`affiliateScope`) and a
    trimmed `/admin` already exist to copy from.

13. **Wholesale customer self-service portal.** *(High · Bigger bet)*
    Let customers view and pay their invoices, download statements and packing lists,
    reorder, and manage their own ship-to clients. The affiliate portal proves the scoped-
    access pattern; this is the largest single lever on both AR and repeat volume.

## D. Inventory & compliance (industry-specific)

14. **Smart reorder suggestions.** *(Medium · Build)*
    Reorder point = sales velocity × supplier `lead_time_days` (already stored). Turn passive
    low-stock alerts into "order N now" suggestions that prefill a PO. Fewer stockouts and
    backorders.

15. **Lot / batch + expiry tracking with COA-per-lot.** *(High strategic · Bigger bet)*
    For research peptides, tie received stock to a **lot number, expiry, and its own COA**,
    and record which lot shipped to whom — so a recall or a customer COA request is one
    query. Product-level COAs exist; this adds the batch dimension the industry expects.

16. **Per-customer tax profile / resale-certificate vault.** *(Medium · Build)*
    Tax-exempt flag + stored resale certificate per customer (and a general per-customer/
    invoice document store). Removes the manual tax % guesswork and keeps compliance docs
    where they belong.

## E. Ops & communication

17. **WhatsApp / SMS notifications.** *(Medium · Build)*
    The business already uses WhatsApp on the storefront. Offer payment-received and shipped
    notices over WhatsApp/SMS in addition to email — higher open rates for B2B.

18. **Unified action inbox.** *(Medium · Quick win)*
    One "needs attention" queue — overdue invoices, backorders to fulfill, POs to receive,
    follow-ups due. The dashboard already assembles several of these feeds; this consolidates
    them into a single worklist.

19. **Granular roles.** *(Low–Medium · Build)*
    Assistant is all-or-nothing read-only. As the team grows, add narrower roles (e.g.
    record-payments-only, or scoped-to-own-customers) between assistant and admin.

---

## Recommended sequence

1. **Customer 360 page (#6)** — the surface everything else hangs off.
2. **Two quick wins in parallel:** invoice reminders (#1) and one-click reorder (#10).
3. **Client management + per-client history (#7)** — shore up the differentiator.
4. **Credit terms + statements (#2, #3)** — AR maturity.
5. Then choose a bigger bet by appetite: **customer portal (#13)** for growth, or
   **lot/expiry tracking (#15)** for compliance.

## Foundation already in place (do not rebuild)

Blind bill-to/ship-to packing lists · four-layer per-customer pricing (box/vial, labeled/
unlabeled, CAD/USD) · saved per-customer preferences · sales-person & affiliate commissions
with rate snapshots · invoice split-on-backorder → PO → receiving → stock · landed-cost POs
· realtime warehouse queue with packing checklist & photos · Easyship labels + auto-shipment
+ tracking webhooks · aging report · prepaid invoices → supplier POs · cross-site invoice
export · full audit log + error log + changelog · low-stock alerts, stock waitlist, and a
cron layer (payments, inactive customers, e-Transfer emails, stock reports).
