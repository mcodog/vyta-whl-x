# Product COA Button, COA-Only Toggle & Catalog Ordering

Date: 2026-07-06

Client-facing product card and catalog improvements centered on Certificates of
Analysis (COA), the purity badge, and how cards are ordered in the catalog grid.

## COA button moved next to Add to Cart

- On both the homepage featured cards (`components/Products.tsx`) and the catalog
  cards (`app/products/page.tsx`), the COA button no longer floats as an overlay
  on the product image.
- It now sits in the card footer next to the **Add to Cart** button, styled as a
  bronze-outline "Lab"-style button using the `FlaskConical` icon. The `COA`
  label is hidden on mobile (icon only) to keep narrow cards tidy, matching the
  Add button.
- Behavior is unchanged: it opens the first certificate in a new tab; the product
  detail page still lists all certificates. When a product has more than one, the
  button shows a `×N` count.

## "COA only" toggle on the products page

- A **COA only** switch was added to the results bar on the catalog page. When
  on, the grid shows only compounds that have at least one Certificate of
  Analysis.
- Toggling it participates in the existing sort and resets pagination to the top.

## Empty purity badge no longer renders

- The bronze purity badge is now only rendered when `purity` is a non-empty,
  non-whitespace string. Products with a `null` or blank purity no longer show an
  empty pill.

## Imageless products sort to the bottom

- The catalog sort now pushes products **without an image** to the bottom of the
  grid (ahead of the existing out-of-stock push), so cards without artwork don't
  appear at the top. Ordering within each group is preserved (stable sort).

## Files

- `components/Products.tsx` — COA button relocated to the footer; purity badge
  guarded; removed the image overlay.
- `app/products/page.tsx` — COA button relocated to the footer; `COA only`
  toggle + filter; purity badge guarded; imageless-first sort key.
