# Warehouse queue — viewable invoices, packed-photo bucket fix & mobile UX

**Date:** 2026-07-08
**Area:** Warehouse queue detail, storage
**PRs:** [#138](https://github.com/thepuragroup-droid/aminocan-whl/pull/138), [#139](https://github.com/thepuragroup-droid/aminocan-whl/pull/139)
**Migration:** `aminocan/warehouse-packages-bucket-migration.sql`

## Summary

A round of warehouse-queue fixes and polish: invoices you can actually view
(not just auto-print), a fix for packed-photo uploads that were failing with
"Bucket not found", and a mobile interaction that jumps to the order detail
when a record is tapped.

## View Invoice vs. Download

- The invoice action is renamed **View Invoice** and now **opens the invoice
  for viewing** (no auto-print).
- A separate **Download** action triggers the print / save-as-PDF dialog, so
  viewing and saving are no longer conflated.

## Packed-photo upload fix — dedicated `packages` bucket

- Warehouse packed-product photo upload/delete targeted a storage bucket that
  was never created (the only setup file is reference-only, marked "do not
  run"), so taking or uploading a photo failed with **"Bucket not found"**.
- Photos now use a dedicated public **`packages`** bucket (was defaulting to
  the shared `products` bucket); `WAREHOUSE_PHOTOS_BUCKET` still overrides it.
- Added `warehouse-packages-bucket-migration.sql` — a runnable, idempotent
  migration that creates the public `packages` bucket and, where permitted, a
  guarded public-read policy on `storage.objects`.

## Mobile UX

- On mobile, tapping a queue record now **auto-scrolls to the order detail**
  so the tapped record's details come into view instead of staying hidden
  below the list.

## Migration (run before deploying)

`warehouse-packages-bucket-migration.sql` creates the public `packages`
storage bucket and a guarded public-read policy. Idempotent.

## Files

- `app/(warehouse)/warehouse/_components/QueueDetail.tsx`
- `app/api/warehouse/queue/[id]/photo/route.ts`
- `warehouse-packages-bucket-migration.sql`
