# Admin Customers — Pagination

Date: 2026-06-26

The admin customers table previously rendered every matching customer in one
long list. It now paginates at **20 per page**.

- Client-side pagination over the already-loaded, ranked, and filtered list
  (the page loads all customers and searches/filters in the browser, so no
  server round-trip is added).
- A footer shows "Showing X–Y of Z" with **Prev / Next** controls and a
  "Page N of M" indicator, matching the admin invoices table.
- Changing the search box or the affiliate/status filters resets to the first
  page; deleting a customer that empties the last page clamps back into range.
- The card header now reads "{total} total" instead of "{n} shown".

File: `app/(admin)/admin/customers/page.tsx`.
