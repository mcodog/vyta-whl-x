# Product Image Uploads & New Product Catalog Additions

**Date:** June 18, 2026
**Type:** Data migration
**Status:** Completed ✅

---

## Overview

A multi-batch effort to populate product images (hosted in the Supabase
`runway-uploads` and `runway-uploads-2` buckets) across the `products` table.
Existing products had their `image_url` refreshed, several products that did
not yet exist were created, and a handful of items were flagged for missing
prices or missing images.

All matching was done by product **name** against the live catalog, then keyed
by product **ID** in the SQL.

---

## Batch 1 — `runway-uploads`

### Existing products re-imaged (5)
| Product | Product ID |
|---|---|
| AHK-Cu 100mg | `4caef3a4-2943-4cde-91e1-047e69ede3b9` |
| Dihexa 10mg | `60e826f6-69e0-48e2-b059-00ed67e5b713` |
| Hexarelin Acetate 5mg | `5191b73a-ddfb-4e1e-90ef-779ef7ef7fab` |
| L-Carnitine 1200mg | `499b087f-f5fa-4787-9a0b-6b567a920767` |
| Oxytocin Acetate 2mg | `a22b8bb6-5c2c-43d4-82ea-e34848d19c21` |

### New products created (11)
These had images but no catalog row. None appeared in the supplied CAD price
list, so each was inserted with **`price = 0`** and **`active = FALSE`**
(placeholders to be priced/activated later; `price` is `NOT NULL`).

| Product | Slug | Category (assigned) | New ID |
|---|---|---|---|
| AHK-Cu 50mg | `ahk-cu-50mg` | Anti-Aging / Beauty | `a344ef1c-5a55-4f93-aa77-0bfe7c6f8572` |
| Alprostadil 20mcg | `alprostadil-20mcg` | Sexual Health | `57375d27-22f7-4aa2-ab31-2de45a6de4e6` |
| FOX-04 10mg | `fox-04-10mg` | Anti-Aging / Beauty | `f667fcaf-5796-45f4-bde8-7c4435bba141` |
| Gonadorelin Acetate 2mg | `gonadorelin-acetate-2mg` | Hormonal / Fertility | `073a2b26-266b-42d9-93b5-d25a2016a741` |
| P21 10mg | `p21-10mg` | Cognitive / Focus | `03ab1b7e-d800-4e7a-b4a4-9668b868f7e3` |
| PE 22-28 10mg | `pe-22-28-10mg` | Cognitive / Focus | `797a676b-dab3-46f6-b458-9cd5e88e546c` |
| PNC 10mg | `pnc-10mg` | General Health | `841aad5a-81ce-4c34-99fc-ee7aa7af45f9` |
| Semax 10mg + Selank 10mg | `semax-10mg-selank-10mg` | Cognitive / Focus | `ba23adfd-2df2-43f3-ac2e-05ac9781bcfc` |
| Tesamorelin 12mg + Ipamorelin 6mg | `tesamorelin-12mg-ipamorelin-6mg` | Bodybuilding / Fitness | `739b7c7d-a8fc-4cf9-a7b8-73bcdb851010` |
| Testagen 20mg | `testagen-20mg` | General Health | `ece949e9-5a50-435c-8981-07491cd0fe96` |
| Vilon 20mg | `vilon-20mg` | General Health | `7a4ddd09-ae0e-4b91-87ec-646c85d7b42d` |

> AHK-Cu 50mg shipped as both `.png` and `.jpg`; the `.png` was used (matching
> AHK-Cu 100mg). Categories were best-guess assignments.

---

## Batch 2 — `runway-uploads-2`

All 6 matched existing products:

| Product | Product ID |
|---|---|
| Cerebrolysin 60mg | `a04e73bc-984e-4505-abbb-89a69620ac04` |
| Epithalon 40mg | `992a2595-8548-45ab-a313-19bd468e4ddc` |
| MOTS-C 20mg | `53a4f946-c43b-44a5-952e-cc7505821db2` |
| Pinealon 10mg (dup row #1) | `f09512ed-57e5-432d-8898-bb05eed30623` |
| Pinealon 10mg (dup row #2) | `cafe63fe-6034-454b-8a71-e0c92567fb79` |
| Tesamorelin 20mg | `0b604e9a-bc51-4073-9942-e0ad38e154fc` |
| Vitamin C | `3fe705f8-e1aa-4668-acc4-67375c5b872d` |

> **Pinealon 10mg has two rows** (duplicate). Both were updated; consider
> deduping.

---

## Batch 3 — Bacteriostatic Water (`runway-uploads-2`)

| Product | Product ID | Action |
|---|---|---|
| Bacteriostatic Water 10mL | `44987a86-9fb7-414d-afce-419032554eb5` | image updated |
| Bacteriostatic Water 30mL | `a7ccab6d-8a29-4e7c-a524-9d1a382fe117` | image updated |
| Bacteriostatic Water 3mL | `b344df10-2df8-4c91-909f-889fb36485b7` | image updated |
| Bacteriostatic Water 100mL | _new row_ | created (`price = 0`, `active = FALSE`) — `category = General Health`, `form = Solution / Diluent` |

---

## Outstanding Follow-ups

- **Pricing pending** for all placeholder rows (the 11 new Batch-1 products and
  Bacteriostatic Water 100mL). Once priced:
  `UPDATE products SET price = …, active = TRUE WHERE slug = '…';`
- **Still no image** (no asset supplied in any batch):
  - Vitamin E
  - Retatrutide 10mg Pen
  - Retatrutide 20mg Pen
  - Retatrutide 30mg Pens
  - Retatrutide 40mg Pen
- **Duplicate row:** Pinealon 10mg exists twice — dedupe when convenient.
- **Copy:** `description` / `benefits` / `mechanism` are empty on the new rows
  and should be filled before they go live.
- **Categories** on new rows were best-guess — review before activation.
