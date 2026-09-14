-- Admin Changelog — inspect what's already in the LIVE database
-- =============================================================
-- Run this against the live DB BEFORE applying changelog-append-migration.sql
-- to see which entries already exist. The append migration is idempotent
-- (per-title WHERE NOT EXISTS), so it won't duplicate anything below — this is
-- just for a human sanity check.

-- 1) Everything currently seeded/created, newest first.
SELECT entry_date::date AS day,
       category,
       impact,
       title,
       author
  FROM changelog_entries
 ORDER BY entry_date DESC, title;

-- 2) Count by day — quick way to confirm 2026-07-08 is (or isn't) present yet.
-- SELECT entry_date::date AS day, count(*)
--   FROM changelog_entries
--  GROUP BY 1
--  ORDER BY 1 DESC;

-- 3) Check specifically for the five new 2026-07-08 titles this seed adds.
-- SELECT title,
--        (SELECT count(*) FROM changelog_entries e WHERE e.title = t.title) AS present
--   FROM (VALUES
--     ('Admin Changelog — internal release-notes timeline'),
--     ('Per-customer currency tags, CAD/USD analytics & admin UX polish'),
--     ('USD pricing: change history + storefront billing'),
--     ('Fulfillment queue — views, drafts, remove/restore, search & invoice download'),
--     ('Warehouse queue — viewable invoices, packed-photo bucket fix & mobile UX')
--   ) AS t(title);
