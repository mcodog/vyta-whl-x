# Convert to Prepaid, Prepaid Layout & Backorder Delete

**Date:** July 16, 2026
**Type:** Feature / UX
**Status:** Completed ✅

---

## Overview

Three follow-ups to the prepaid-invoice feature.

## What Changed

### 1. Convert an existing invoice into a prepaid invoice
- **Convert to Prepaid** button on the invoice page (admin only, shown on
  standard invoices). It flips the invoice to prepaid and **auto-routes each
  product line to its cheapest supplier** (overridable afterwards).
- Backed by `POST /api/admin/invoices/:id/convert-to-prepaid`, which updates line
  items **in place** (never deletes/re-inserts them) so fulfillment progress is
  preserved. A confirmation dialog explains the effect before converting.

### 2. Prepaid invoice page layout
- The **Supplier Purchase Orders** panel moved out of the full-width footer (where
  it stranded whitespace whenever the right column was taller) into the **main
  column, right under the line items** it procures — so it reads as core content.

### 3. Delete a backorder
- Per-row **delete** button on the Backorders page (admin only), with a
  confirmation dialog. Backed by `DELETE /api/admin/backorders/:id`; the linked
  invoice and any purchase order are left untouched (`backorder_items` cascade).
