# Invoicing a customer under a sales person makes them that sales person's customer

Date: 2026-07-27

When an invoice has both a **customer** and a **sales person**, the customer is
now tied to the affiliate behind that sales person — so they show up in that
affiliate's **dashboard** count and **customer list**.

## What changed

- **New helper** `bindCustomerToSalesPersonAffiliate` in
  `lib/admin/invoice-access.ts`. Given a customer + sales person, it resolves the
  affiliate behind the sales person and sets `customers.affiliate_id` +
  `customers.default_sales_person_id` on the customer.
  - Conservative & best-effort: only binds when the sales person maps to an
    **affiliate** account and the customer **isn't already bound** to an
    affiliate (never reassigns another affiliate's customer), and never binds an
    affiliate to themselves.
- **Wired into invoice create** (`app/api/admin/invoices/route.ts`) — both the
  single-invoice and split (backorder) paths.
- **Wired into invoice edit** (`app/api/admin/invoices/[id]/route.ts`) — runs
  when the sales person / commission is (re)set, independent of the commission
  amount.

Because affiliate scoping keys off `customers.affiliate_id`, the newly-bound
customer immediately appears in the affiliate's "Your Customers" count
(`/api/affiliate/me`) and in their `/admin/customers` list.

## Already in place (this branch)

The related visibility rules were shipped earlier on this branch and already
satisfy "hide $0 / inactive-on-their-pricelist products on the product page and
line items":

- Storefront (`/api/products`, `/api/products/featured`) drops products a
  customer is priced **$0** for or whose status is **Hidden**.
- The affiliate invoice builder's line-item picker drops those same products for
  the affiliate's own pricing.
