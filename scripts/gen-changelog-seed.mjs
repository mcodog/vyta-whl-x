#!/usr/bin/env node
/**
 * Generates `changelog-migration.sql` from the markdown write-ups in
 * `aminocan/changelogs/`. The schema is hand-authored here; the seed rows are
 * derived from the files so the Admin Changelog ships pre-filled with the real
 * project history. Values are emitted with Postgres dollar-quoting ($cl$…$cl$)
 * so arbitrary markdown (quotes, backslashes, newlines) needs no escaping.
 *
 * Run from the `aminocan/` dir:  node scripts/gen-changelog-seed.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const changelogsDir = join(here, '..', 'changelogs');
const outFile = join(here, '..', 'changelog-migration.sql');

/**
 * Curated per-file metadata (category / impact / tags / affected areas). Keyed
 * by filename. Title, date, summary and body are pulled from the files.
 */
const META = {
  '2026-03-27-email-checkout-system.md': {
    category: 'storefront', impact: 'major',
    tags: ['Checkout', 'Email'], areas: ['Checkout', 'Storefront'],
  },
  '2026-03-30-pricing-management-ui-improvements.md': {
    category: 'ui', impact: 'minor',
    tags: ['Pricing', 'UI'], areas: ['Admin', 'Pricing'],
  },
  '2026-03-30-product-management-system.md': {
    category: 'admin', impact: 'major',
    tags: ['Products', 'RBAC'], areas: ['Admin', 'Products'],
  },
  '2026-04-11-settings-auth-fix.md': {
    category: 'bugfix', impact: 'major',
    tags: ['Auth', 'Settings'], areas: ['Admin', 'Settings'],
  },
  '2026-04-11-unified-checkout-route.md': {
    category: 'storefront', impact: 'minor',
    tags: ['Checkout', 'Routing'], areas: ['Checkout', 'Storefront'],
  },
  '2026-04-14-checkout-config-enhancements.md': {
    category: 'admin', impact: 'minor',
    tags: ['Checkout', 'Config'], areas: ['Admin', 'Checkout'],
  },
  '2026-04-14-login-first-flow.md': {
    category: 'storefront', impact: 'minor',
    tags: ['Auth', 'Landing'], areas: ['Storefront', 'Auth'],
  },
  '2026-06-04-invoice-split-and-low-stock-alerts.md': {
    category: 'admin', impact: 'major',
    tags: ['Invoices', 'Backorders', 'Alerts'], areas: ['Admin', 'Invoices', 'Inventory'],
  },
  '2026-06-11-purchase-orders-discount-shipping-orderdate.md': {
    category: 'admin', impact: 'minor',
    tags: ['Purchase Orders'], areas: ['Admin', 'Purchase Orders'],
  },
  '2026-06-11-supplier-pricelists.md': {
    category: 'admin', impact: 'minor',
    tags: ['Suppliers', 'Pricing'], areas: ['Admin', 'Purchase Orders'],
  },
  '2026-06-18-product-image-uploads-full-summary.md': {
    category: 'admin', impact: 'minor',
    tags: ['Products', 'Images', 'Uploads'], areas: ['Admin', 'Products'],
  },
  '2026-06-18-product-images-and-new-products.md': {
    category: 'storefront', impact: 'minor',
    tags: ['Products', 'Images'], areas: ['Admin', 'Products', 'Storefront'],
  },
  '2026-06-22-etransfer-payment-option.md': {
    category: 'storefront', impact: 'minor',
    tags: ['Checkout', 'Payments', 'e-Transfer'], areas: ['Checkout', 'Storefront'],
  },
  '2026-06-22-warehouse-packing-checklist.md': {
    category: 'feature', impact: 'major',
    tags: ['Warehouse', 'Fulfillment'], areas: ['Warehouse', 'Invoices'],
  },
  '2026-06-24-invoice-currency-and-labels.md': {
    category: 'admin', impact: 'minor',
    tags: ['Invoices', 'Currency'], areas: ['Admin', 'Invoices'],
  },
  '2026-06-26-admin-customers-pagination.md': {
    category: 'ui', impact: 'minor',
    tags: ['Customers', 'Pagination'], areas: ['Admin', 'Customers'],
  },
  '2026-06-26-invoice-new-vs-existing-account.md': {
    category: 'admin', impact: 'minor',
    tags: ['Invoices', 'Customers'], areas: ['Admin', 'Invoices'],
  },
  '2026-06-28-product-price-stock-history.md': {
    category: 'admin', impact: 'minor',
    tags: ['Products', 'History'], areas: ['Admin', 'Products'],
  },
  '2026-06-28-vial-pricing.md': {
    category: 'feature', impact: 'major',
    tags: ['Pricing', 'Products'], areas: ['Admin', 'Products', 'Storefront'],
  },
  '2026-07-03-inactive-customer-alerts-and-takeover.md': {
    category: 'admin', impact: 'minor',
    tags: ['Customers', 'Alerts'], areas: ['Admin', 'Customers'],
  },
  '2026-07-04-etransfer-email-automation.md': {
    category: 'feature', impact: 'minor',
    tags: ['Email', 'Automation', 'Payments'], areas: ['Admin', 'Invoices'],
  },
  '2026-07-06-admin-tables-group-by-day.md': {
    category: 'ui', impact: 'minor',
    tags: ['Admin', 'UI'], areas: ['Admin'],
  },
  '2026-07-06-product-coa-button-and-catalog-toggles.md': {
    category: 'storefront', impact: 'minor',
    tags: ['Products', 'COA', 'Catalog'], areas: ['Admin', 'Products', 'Storefront'],
  },
  '2026-07-06-product-usd-pricing.md': {
    category: 'storefront', impact: 'major',
    tags: ['Pricing', 'USD', 'Currency'], areas: ['Admin', 'Products', 'Storefront'],
  },
  '2026-07-07-admin-orders-bulk-shipping.md': {
    category: 'admin', impact: 'major',
    tags: ['Orders', 'Shipping'], areas: ['Admin', 'Orders'],
  },
  '2026-07-07-self-service-password-change.md': {
    category: 'security', impact: 'major',
    tags: ['Auth', 'Security', 'Password'], areas: ['Storefront', 'Auth'],
  },
  '2026-07-08-admin-changelog-interface.md': {
    category: 'admin', impact: 'major',
    tags: ['Changelog', 'Release Notes', 'Admin'], areas: ['Admin'],
  },
  '2026-07-08-currency-tags-and-admin-ux.md': {
    category: 'admin', impact: 'major',
    tags: ['Pricing', 'Currency', 'Analytics', 'UI'],
    areas: ['Admin', 'Pricing', 'Customers', 'Analytics'],
  },
  '2026-07-08-usd-pricing-history-and-storefront.md': {
    category: 'storefront', impact: 'major',
    tags: ['Pricing', 'USD', 'Currency'],
    areas: ['Storefront', 'Products', 'Checkout', 'Invoices'],
  },
  '2026-07-08-fulfillment-queue.md': {
    category: 'feature', impact: 'major',
    tags: ['Warehouse', 'Fulfillment', 'Invoices'], areas: ['Warehouse', 'Invoices'],
  },
  '2026-07-08-warehouse-queue.md': {
    category: 'admin', impact: 'minor',
    tags: ['Warehouse', 'Fulfillment', 'Storage'], areas: ['Warehouse'],
  },
};

const AUTHOR = 'Engineering';

/** `YYYY-MM-DD` from the filename prefix, at local noon (avoids TZ day-shift). */
function entryDate(filename) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(filename);
  return m ? `${m[1]}-${m[2]}-${m[3]} 12:00:00` : '2026-01-01 12:00:00';
}

function extractTitle(text, filename) {
  const line = text.split('\n').find((l) => /^#\s+/.test(l));
  if (line) return line.replace(/^#\s+/, '').trim();
  // Fall back to a title-cased version of the filename slug.
  return filename.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '').replace(/-/g, ' ');
}

/** First paragraph under a Summary/Overview heading, else first real paragraph. */
function extractSummary(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const collectFrom = (startIdx) => {
    const buf = [];
    for (let i = startIdx; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === '' || t === '---') {
        if (buf.length) break;
        continue;
      }
      if (/^#{1,6}\s/.test(t)) {
        if (buf.length) break;
        continue;
      }
      buf.push(t);
    }
    return buf.join(' ').trim();
  };

  const headingIdx = lines.findIndex((l) => /^#{2,6}\s+(summary|overview)\b/i.test(l.trim()));
  if (headingIdx !== -1) {
    const para = collectFrom(headingIdx + 1);
    if (para) return para;
  }
  // No Summary/Overview section: first paragraph after the metadata block.
  // Skip both bold (`**Date:**`) and plain (`Date:`) leading metadata lines.
  const META_LINE =
    /^\**(date|type|status|author|developer|area|pr|migrations?|documentation version|version|file|features)\**\s*:/i;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '' || t === '---' || /^#/.test(t) || META_LINE.test(t)) continue;
    const para = collectFrom(i);
    if (para) return para;
  }
  return '';
}

/** Body = from the first `##` heading to the end, with divider-only lines dropped. */
function extractBody(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let start = lines.findIndex((l) => /^##\s/.test(l));
  if (start === -1) {
    // No sub-heading: use everything after the first `#` title line.
    const titleIdx = lines.findIndex((l) => /^#\s/.test(l));
    start = titleIdx === -1 ? 0 : titleIdx + 1;
  }
  return lines
    .slice(start)
    .filter((l) => l.trim() !== '---')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sqlArray(items) {
  if (!items || items.length === 0) return `ARRAY[]::text[]`;
  const parts = items.map((s) => `$cl$${s}$cl$`);
  return `ARRAY[${parts.join(', ')}]`;
}

function dollar(value) {
  return value == null ? 'NULL' : `$cl$${value}$cl$`;
}

const files = readdirSync(changelogsDir)
  .filter((f) => f.endsWith('.md'))
  .sort(); // chronological (filenames are date-prefixed)

const rows = files.map((filename) => {
  const text = readFileSync(join(changelogsDir, filename), 'utf8');
  const meta = META[filename] || { category: 'feature', impact: 'minor', tags: [], areas: [] };
  return {
    category: meta.category,
    title: extractTitle(text, filename),
    summary: extractSummary(text),
    body: extractBody(text),
    author: AUTHOR,
    impact: meta.impact,
    tags: meta.tags,
    areas: meta.areas,
    entry_date: entryDate(filename),
  };
});

const valuesSql = rows
  .map((r) => {
    return `  (
    ${dollar(r.category)},
    ${dollar(r.title)},
    ${dollar(r.summary)},
    ${dollar(r.body)},
    ${dollar(r.author)},
    NULL::text,
    ${dollar(r.impact)},
    ${sqlArray(r.tags)},
    ${sqlArray(r.areas)},
    '[]'::jsonb,
    ${dollar(r.entry_date)}::timestamptz
  )`;
  })
  .join(',\n');

const schema = `-- Admin Changelog
-- ===============
-- Centralized internal release-notes / changelog hub. Each row is a single
-- update (feature, fix, patch, etc.) shown on the admin timeline. Written by
-- API routes in app/api/admin/changelog using the service-role key.
--
-- Idempotent: safe to run more than once.
--
-- NOTE: The seed rows at the bottom of this file are GENERATED from the
-- markdown write-ups in aminocan/changelogs/ by scripts/gen-changelog-seed.mjs.
-- Re-run that script after editing the write-ups; do not hand-edit the seed.

CREATE TABLE IF NOT EXISTS changelog_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One of the known category keys (admin, storefront, feature, patch,
  -- bugfix, performance, security, api, database, ui, mobile). Kept as free
  -- text so new categories can be added without a migration.
  category text NOT NULL DEFAULT 'feature',
  title text NOT NULL,
  -- Short 2-3 line teaser shown on the card.
  summary text NOT NULL DEFAULT '',
  -- Full details (markdown) shown in the Read More drawer.
  body text,
  -- Display name of who authored the change.
  author text,
  -- Optional release version (e.g. "2.5.1").
  version text,
  -- Optional impact level: 'critical' | 'major' | 'minor'.
  impact text,
  -- Freeform tags shown as chips on the card.
  tags text[] NOT NULL DEFAULT '{}',
  -- Modules/areas the change touches (e.g. Products, Checkout).
  affected_areas text[] NOT NULL DEFAULT '{}',
  -- Related links / attachments: [{ "label": "PR #214", "url": "https://..." }].
  links jsonb NOT NULL DEFAULT '[]',
  -- The timestamp the entry is dated by (grouped by day on the timeline and
  -- targeted by the calendar). Defaults to now but is editable so admins can
  -- backdate historical entries.
  entry_date timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES customers (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_changelog_entry_date
  ON changelog_entries (entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_changelog_category
  ON changelog_entries (category, entry_date DESC);

-- Keep updated_at fresh on every update.
CREATE OR REPLACE FUNCTION set_changelog_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_changelog_updated_at ON changelog_entries;
CREATE TRIGGER trg_changelog_updated_at
  BEFORE UPDATE ON changelog_entries
  FOR EACH ROW EXECUTE FUNCTION set_changelog_updated_at();

ALTER TABLE changelog_entries ENABLE ROW LEVEL SECURITY;

-- Admins and assistants may read the changelog. Writes go through the
-- service-role key (API routes), so there is no client write policy.
DROP POLICY IF EXISTS changelog_admin_read ON changelog_entries;
CREATE POLICY changelog_admin_read ON changelog_entries
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM customers c
       WHERE c.id = auth.uid()
         AND c.role IN ('admin','assistant')
    )
  );

-- Seed the changelog from the project's markdown write-ups the first time this
-- runs. Only inserts when the table is empty, so it is safe to re-run and never
-- duplicates or clobbers entries created through the UI.
INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT * FROM (VALUES
`;

const footer = `
) AS seed(category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
WHERE NOT EXISTS (SELECT 1 FROM changelog_entries);
`;

writeFileSync(outFile, schema + valuesSql + footer);
console.log(`Wrote ${outFile} with ${rows.length} seeded entries.`);

// --- Re-categorize migration -------------------------------------------------
// For databases that were seeded BEFORE the category values were revised. The
// base migration only seeds an empty table, so it can't fix already-inserted
// rows — this patch does, matching each seeded entry by its exact title. It
// only touches the auto-seeded author ("Engineering") rows, so hand-authored
// entries are never overwritten. Idempotent.
const recatFile = join(here, '..', 'changelog-recategorize-migration.sql');
const updates = rows
  .map(
    (r) =>
      `UPDATE changelog_entries SET category = ${dollar(r.category)}\n  WHERE title = ${dollar(r.title)} AND author = ${dollar(AUTHOR)};`,
  )
  .join('\n');

const recatSql = `-- Admin Changelog — re-categorize seeded entries
-- ==============================================
-- Run this ONLY if you seeded the changelog before the category values were
-- revised (so the Admin/Storefront category filters return the right entries).
-- Matches each auto-seeded entry by its exact title + author ("Engineering"),
-- so entries you created yourself are left untouched. Idempotent — safe to
-- re-run. Fresh installs get the correct categories from changelog-migration.sql
-- and do NOT need this file.

${updates}
`;

writeFileSync(recatFile, recatSql);
console.log(`Wrote ${recatFile} with ${rows.length} category updates.`);

// --- Append (incremental) migration ------------------------------------------
// The base changelog-migration.sql only seeds an EMPTY table (WHERE NOT EXISTS
// with no predicate), so it cannot add new write-ups to a database that is
// already populated (a live install). This file inserts every generated row
// individually, each guarded by a per-title WHERE NOT EXISTS, so running it
// against a live DB inserts only the entries that aren't there yet and never
// duplicates. Safe to re-run. Titles are matched together with the auto-seed
// author ("Engineering") so hand-authored entries are never shadowed.
const appendFile = join(here, '..', 'changelog-append-migration.sql');
const appendRows = rows
  .map((r) => {
    return `INSERT INTO changelog_entries
  (category, title, summary, body, author, version, impact, tags, affected_areas, links, entry_date)
SELECT
  ${dollar(r.category)},
  ${dollar(r.title)},
  ${dollar(r.summary)},
  ${dollar(r.body)},
  ${dollar(r.author)},
  NULL::text,
  ${dollar(r.impact)},
  ${sqlArray(r.tags)},
  ${sqlArray(r.areas)},
  '[]'::jsonb,
  ${dollar(r.entry_date)}::timestamptz
WHERE NOT EXISTS (
  SELECT 1 FROM changelog_entries
   WHERE title = ${dollar(r.title)} AND author = ${dollar(AUTHOR)}
);`;
  })
  .join('\n\n');

const appendSql = `-- Admin Changelog — append new write-ups to a populated database
-- ==============================================================
-- Use this to sync a LIVE (already-seeded) changelog_entries table with the
-- markdown write-ups in aminocan/changelogs/. The base changelog-migration.sql
-- only seeds an empty table, so it can't add newer entries once the table has
-- rows. This file inserts every write-up guarded by a per-title WHERE NOT
-- EXISTS: entries already present are skipped, new ones are inserted, and
-- re-running never duplicates. Matched by title + author ("Engineering"), so
-- entries you created through the UI are never touched.
--
-- GENERATED by scripts/gen-changelog-seed.mjs — do not hand-edit. Fresh installs
-- get everything from changelog-migration.sql and do NOT need this file.
--
-- Tip: to see what's already live before running this, use:
--   SELECT entry_date::date AS day, category, impact, title, author
--     FROM changelog_entries
--    ORDER BY entry_date DESC, title;

${appendRows}
`;

writeFileSync(appendFile, appendSql);
console.log(`Wrote ${appendFile} with ${rows.length} idempotent inserts.`);
