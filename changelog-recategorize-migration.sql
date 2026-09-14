-- Admin Changelog — re-categorize seeded entries
-- ==============================================
-- Run this ONLY if you seeded the changelog before the category values were
-- revised (so the Admin/Storefront category filters return the right entries).
-- Matches each auto-seeded entry by its exact title + author ("Engineering"),
-- so entries you created yourself are left untouched. Idempotent — safe to
-- re-run. Fresh installs get the correct categories from changelog-migration.sql
-- and do NOT need this file.

UPDATE changelog_entries SET category = $cl$storefront$cl$
  WHERE title = $cl$Email Checkout System Implementation$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$ui$cl$
  WHERE title = $cl$Pricing Management UI Improvements$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$admin$cl$
  WHERE title = $cl$Product Management System with Role-Based Access Control$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$bugfix$cl$
  WHERE title = $cl$Admin Settings Authentication Fix$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$storefront$cl$
  WHERE title = $cl$Unified /checkout Route$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$admin$cl$
  WHERE title = $cl$Checkout Configuration Enhancements$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$storefront$cl$
  WHERE title = $cl$Login-First Landing Flow & Auth Config$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$admin$cl$
  WHERE title = $cl$Invoice Splitting on Backorder + Low-Stock Alerts$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$admin$cl$
  WHERE title = $cl$Purchase Orders — Discount, Shipping Fee, Order Date & Receiving Fixes$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$admin$cl$
  WHERE title = $cl$Supplier Pricelists$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$admin$cl$
  WHERE title = $cl$Product Image Uploads & New Product Catalog Additions$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$storefront$cl$
  WHERE title = $cl$Product Images Upload & New Product Rows$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$storefront$cl$
  WHERE title = $cl$Interac e-Transfer Payment Option at Checkout$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$feature$cl$
  WHERE title = $cl$Warehouse Packing — Checklist, Per-line Fulfillment/Backorder, Packed Photos$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$admin$cl$
  WHERE title = $cl$Invoice Markings — Currency (CAD/USD) and With/Without Labels$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$ui$cl$
  WHERE title = $cl$Admin Customers — Pagination$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$admin$cl$
  WHERE title = $cl$Invoice Customer — New vs. Existing Account Detection$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$admin$cl$
  WHERE title = $cl$Admin Products — Price & Stock Change History$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$feature$cl$
  WHERE title = $cl$Vial Pricing — explicit single-vial price, history & box/vial tagging$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$admin$cl$
  WHERE title = $cl$Inactive-Customer Alerts & Customer Takeover$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$feature$cl$
  WHERE title = $cl$Automatic e-Transfer Invoice Email With Configurable Delay$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$ui$cl$
  WHERE title = $cl$Admin Tables — Grouped by Day$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$storefront$cl$
  WHERE title = $cl$Product COA Button, COA-Only Toggle & Catalog Ordering$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$storefront$cl$
  WHERE title = $cl$Product USD Pricing (CAD ↔ USD toggle)$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$admin$cl$
  WHERE title = $cl$Admin Orders — Bulk Shipping Actions, Row Loading & Day Select$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$security$cl$
  WHERE title = $cl$Self-service password change$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$admin$cl$
  WHERE title = $cl$Admin Changelog — internal release-notes timeline$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$admin$cl$
  WHERE title = $cl$Per-customer currency tags, CAD/USD analytics & admin UX polish$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$feature$cl$
  WHERE title = $cl$Fulfillment queue — views, drafts, remove/restore, search & invoice download$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$storefront$cl$
  WHERE title = $cl$USD pricing: change history + storefront billing$cl$ AND author = $cl$Engineering$cl$;
UPDATE changelog_entries SET category = $cl$admin$cl$
  WHERE title = $cl$Warehouse queue — viewable invoices, packed-photo bucket fix & mobile UX$cl$ AND author = $cl$Engineering$cl$;
