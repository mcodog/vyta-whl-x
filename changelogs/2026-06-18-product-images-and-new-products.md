# Product Images Upload & New Product Rows

**Date:** June 18, 2026
**Type:** Data migration
**Status:** Completed ✅

---

## Overview

Uploaded a batch of new product images (hosted in the `runway-uploads`
Supabase bucket) into the `products` table, refreshing `image_url` on existing
products and creating rows for products that did not yet exist. New products
that had no price in the supplied CAD price list were inserted as inactive
placeholders.

---

## What Was Done

### 1. Updated images on 5 existing products

`image_url` set to the new `runway-uploads` asset (and `updated_at` bumped):

| Product | Product ID |
|---|---|
| AHK-Cu 100mg | `4caef3a4-2943-4cde-91e1-047e69ede3b9` |
| Dihexa 10mg | `60e826f6-69e0-48e2-b059-00ed67e5b713` |
| Hexarelin Acetate 5mg | `5191b73a-ddfb-4e1e-90ef-779ef7ef7fab` |
| L-Carnitine 1200mg | `499b087f-f5fa-4787-9a0b-6b567a920767` |
| Oxytocin Acetate 2mg | `a22b8bb6-5c2c-43d4-82ea-e34848d19c21` |

> Hexarelin Acetate 5mg previously had an image; it was overwritten with the new one.

### 2. Inserted 11 new products

Each had an image but no matching row in the database. None appeared in the
supplied CAD price list, so they were inserted with **`price = 0`** and
**`active = FALSE`** (placeholders to be priced/activated later). The `price`
column is `NOT NULL`, hence `0` rather than `NULL`.

| Product | Slug | Category (assigned) | Strength |
|---|---|---|---|
| AHK-Cu 50mg | `ahk-cu-50mg` | Anti-Aging / Beauty | 50mg |
| Alprostadil 20mcg | `alprostadil-20mcg` | Sexual Health | 20mcg |
| FOX-04 10mg | `fox-04-10mg` | Anti-Aging / Beauty | 10mg |
| Gonadorelin Acetate 2mg | `gonadorelin-acetate-2mg` | Hormonal / Fertility | 2mg |
| P21 10mg | `p21-10mg` | Cognitive / Focus | 10mg |
| PE 22-28 10mg | `pe-22-28-10mg` | Cognitive / Focus | 10mg |
| PNC 10mg | `pnc-10mg` | General Health | 10mg |
| Semax 10mg + Selank 10mg | `semax-10mg-selank-10mg` | Cognitive / Focus | 10mg + 10mg |
| Tesamorelin 12mg + Ipamorelin 6mg | `tesamorelin-12mg-ipamorelin-6mg` | Bodybuilding / Fitness | 12mg + 6mg |
| Testagen 20mg | `testagen-20mg` | General Health | 20mg |
| Vilon 20mg | `vilon-20mg` | General Health | 20mg |

All new rows used `form = 'Lyophilized powder / Injectable'`, `stock_qty = 0`,
and the corresponding `runway-uploads` image URL. `description`, `benefits`,
and `mechanism` were left `NULL`.

---

## Notes / Follow-ups

- **Pricing pending:** the 11 new products need CAD prices. Once provided, set
  them live with e.g.
  `UPDATE products SET price = …, active = TRUE WHERE slug = '…';`
- **AHK-Cu 50mg:** two files were supplied (`.png` and `.jpg`); the `.png` was
  used, matching AHK-Cu 100mg.
- **Categories** for the new rows were best-guess assignments and may need
  review.
- **Copy:** `description` / `benefits` / `mechanism` are empty for the new
  products and should be filled in before they go live.
