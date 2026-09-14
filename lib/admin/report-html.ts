/**
 * Shared building blocks for the admin printable reports (customers, affiliates,
 * products, orders). Each report route composes a stats grid + one or more
 * tables into `reportShell`, which returns a self-contained, print-ready HTML
 * document (auto-printing so the browser's "Save as PDF" produces the file).
 */

export const escapeHtml = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const money = (n: number): string => `$${Number(n ?? 0).toFixed(2)}`;

export const formatDate = (d: string | null | undefined): string => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString();
};

/** A long, human-readable timestamp, e.g. "July 17, 2026 at 3:45 PM". */
export const readableDateTime = (d: Date = new Date()): string =>
  d.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

/** How a stock quantity is expressed in the reports. */
export type StockUnit = 'boxes' | 'vials';

/**
 * Render an on-hand vial count as report cell HTML in the chosen unit, always
 * naming the unit so a printed report is unambiguous:
 *   - vials → "240 vials"
 *   - boxes → "24 boxes"; any leftover vials show in parentheses
 *     ("24 boxes (3 vials)") unless `showRemainder` is false. A count smaller
 *     than one box falls back to a plain vial count so we never print
 *     "0 boxes" for real stock.
 * The output is derived from numbers only, so it is safe to embed as raw HTML.
 */
export function formatStockDisplay(
  vials: number,
  vialsPerBox: number,
  unit: StockUnit = 'boxes',
  showRemainder = true,
): string {
  const v = Math.max(0, Number(vials) || 0);
  if (unit === 'vials') return `${v} vial${v === 1 ? '' : 's'}`;
  const per = vialsPerBox > 0 ? vialsPerBox : 10;
  const boxes = Math.floor(v / per);
  const rem = v % per;
  if (boxes === 0) return `${rem} vial${rem === 1 ? '' : 's'}`;
  const label = `${boxes} box${boxes === 1 ? '' : 'es'}`;
  return showRemainder && rem > 0
    ? `${label} (${rem} vial${rem === 1 ? '' : 's'})`
    : label;
}

export interface Stat {
  label: string;
  value: string;
  meta?: string;
  tone?: 'default' | 'pending' | 'paid' | 'danger';
}

export function statsGrid(stats: Stat[]): string {
  const cols = Math.min(Math.max(stats.length, 1), 4);
  return `
  <div class="stats" style="grid-template-columns: repeat(${cols}, 1fr);">
    ${stats
      .map(
        (s) => `
      <div class="stat ${s.tone ?? 'default'}">
        <div class="label">${escapeHtml(s.label)}</div>
        <div class="value">${escapeHtml(s.value)}</div>
        ${s.meta ? `<div class="meta">${escapeHtml(s.meta)}</div>` : ''}
      </div>`,
      )
      .join('')}
  </div>`;
}

export interface Column {
  header: string;
  /** Right-align numeric columns. */
  num?: boolean;
}

/**
 * Build a table. Cell values are raw HTML (callers escape their own content so
 * they can embed pills / sub-labels), so never pass untrusted strings directly.
 */
export function table(columns: Column[], rows: string[][], emptyText = 'No rows.'): string {
  if (rows.length === 0) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  return `
  <table>
    <thead>
      <tr>${columns.map((c) => `<th class="${c.num ? 'num' : ''}">${escapeHtml(c.header)}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (r) =>
            `<tr>${r
              .map((cell, i) => `<td class="${columns[i]?.num ? 'num' : ''}">${cell}</td>`)
              .join('')}</tr>`,
        )
        .join('')}
    </tbody>
  </table>`;
}

export function pill(text: string, tone: string): string {
  return `<span class="pill ${escapeHtml(tone)}">${escapeHtml(text)}</span>`;
}

export function reportShell(opts: {
  title: string;
  filters?: string[];
  body: string;
  footRight?: string;
  autoPrint?: boolean;
  /**
   * Render the branded VYTA layout used by the admin/products reports:
   * gold wordmark, black report title, gold rule, an at-a-glance info line
   * (`meta`), a black table header, alternating gold/white rows, and a
   * branded footer. Other reports omit this and keep the plain layout.
   */
  branded?: boolean;
  /** At-a-glance facts shown under the gold rule (branded layout only). */
  meta?: string[];
}): string {
  const { title, filters, body, footRight, autoPrint = true, branded = false, meta } = opts;
  const filtersHtml =
    filters && filters.length > 0
      ? `<div class="filters"><strong>Filters</strong>${filters
          .map((f) => `<span>${escapeHtml(f)}</span>`)
          .join('')}</div>`
      : '';

  const header = branded
    ? `
  <div class="brandhead">
    <div class="brandname">VYTA</div>
    <div class="brandsub">BIOSCIENCES</div>
    <h1>${escapeHtml(title)}</h1>
    <div class="brandrule"></div>
    ${
      meta && meta.length > 0
        ? `<div class="reportmeta">${meta.map((m) => `<span>${escapeHtml(m)}</span>`).join('')}</div>`
        : ''
    }
  </div>`
    : `
  <h1>${escapeHtml(title)}</h1>
  <p class="sub">VYTA Biosciences · Generated ${escapeHtml(new Date().toLocaleString())}</p>`;

  const footer = branded
    ? `
  <div class="foot">
    <span><strong>VYTA BIOSCIENCES</strong> · Puramass.com${footRight ? ` · ${escapeHtml(footRight)}` : ''}</span>
    <span>Confidential — internal use only</span>
  </div>`
    : `
  <div class="foot">
    <span>VYTA Biosciences · ${escapeHtml(title)}</span>
    <span>${escapeHtml(footRight ?? '')}</span>
  </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         color: #07203A; margin: 0; padding: 28px; background: #fff; }
  .wrap { max-width: 920px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: 0.02em; }
  .sub { font-size: 12px; color: #4E6E85; margin: 0 0 18px; }
  .filters { background: #F7FAFB; border-radius: 8px; padding: 12px 16px; font-size: 12px; margin-bottom: 18px; }
  .filters strong { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #4E6E85; margin-right: 6px; }
  .filters span { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #fff; border: 1px solid #DCE7EB; margin-right: 6px; }
  .stats { display: grid; gap: 12px; margin-bottom: 22px; }
  .stat { padding: 14px; border: 1px solid #DCE7EB; border-radius: 10px; }
  .stat .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #4E6E85; margin-bottom: 6px; }
  .stat .value { font-size: 18px; font-weight: 700; }
  .stat.pending .value { color: #B45309; }
  .stat.paid .value { color: #047857; }
  .stat.danger .value { color: #B91C1C; }
  .stat .meta { font-size: 11px; color: #4E6E85; margin-top: 2px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: #4E6E85; margin: 24px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #4E6E85; padding: 8px 6px; border-bottom: 1px solid #D5E2E7; }
  td { padding: 7px 6px; border-bottom: 1px solid #EFF5F7; vertical-align: top; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { font-size: 10px; color: #4E6E85; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; background: #EEF2F7; color: #1B3A52; }
  .pill.green, .pill.active, .pill.paid, .pill.delivered { background: #D1FAE5; color: #065F46; }
  .pill.amber, .pill.pending, .pill.processing { background: #FEF3C7; color: #92400E; }
  .pill.red, .pill.inactive, .pill.cancelled, .pill.out { background: #FEE2E2; color: #991B1B; }
  .pill.blue, .pill.shipped, .pill.confirmed { background: #DBEAFE; color: #1E40AF; }
  .pill.purple, .pill.admin { background: #EDE9FE; color: #6D28D9; }
  .empty { padding: 24px; text-align: center; color: #4E6E85; font-size: 12px; }
  .foot { margin-top: 32px; padding-top: 12px; border-top: 1px solid #D5E2E7; font-size: 10px; color: #4E6E85; display: flex; justify-content: space-between; }

  /* ---- Branded VYTA layout (admin/products reports) ---- */
  body.branded .brandhead { margin-bottom: 18px; }
  body.branded .brandname { font-size: 26px; font-weight: 700; letter-spacing: 0.28em; color: #07203A; margin: 0; }
  body.branded .brandsub { font-size: 9px; font-weight: 500; letter-spacing: 0.42em; color: #438B9E; margin: 4px 0 2px; }
  body.branded h1 { font-size: 20px; font-weight: 700; color: #07203A; margin: 0 0 10px; }
  body.branded .brandrule { height: 3px; background: linear-gradient(90deg, #07203A 0%, #0E3F5F 35%, #438B9E 75%, #6EB2B8 100%); border-radius: 2px; margin: 0 0 12px; }
  body.branded .reportmeta { display: flex; flex-wrap: wrap; gap: 5px 16px; font-size: 11.5px; color: #4B4B4B; }
  body.branded .reportmeta span { white-space: nowrap; }
  body.branded .reportmeta span + span { border-left: 1px solid #C9DFE2; padding-left: 16px; }
  body.branded th { background: #07203A; color: #FFFFFF; border-bottom: none; white-space: nowrap; }
  body.branded td { white-space: nowrap; border-bottom: 1px solid #D5E2E7; }
  body.branded tbody tr:nth-child(even) td { background: #F2F8F9; }
  body.branded tbody tr:nth-child(odd) td { background: #FFFFFF; }
  body.branded .foot { border-top: 2px solid #438B9E; color: #4E6E85; }
  body.branded .foot strong { color: #07203A; letter-spacing: 0.14em; }
  @media print { body { padding: 0; } }
</style>
</head>
<body${branded ? ' class="branded"' : ''}>
<div class="wrap">${header}
  ${filtersHtml}
  ${body}${footer}
</div>
${autoPrint ? `<script>window.addEventListener("load", () => { setTimeout(() => window.print(), 350); });</script>` : ''}
</body>
</html>`;
}
