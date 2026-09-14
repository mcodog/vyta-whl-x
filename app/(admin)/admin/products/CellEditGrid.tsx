'use client';

/**
 * Products cell-edit grid — a spreadsheet for the two things that get
 * bulk-edited constantly: prices and stock.
 *
 * Seven columns: SKU · Product name · Stock (vials) · Stock (cases) · Notes ·
 * Case price · Vial price. SKU and name are read-only identity columns (still
 * selectable, so a block can be copied into Excel); the four numeric ones are
 * editable and come in two linked pairs, separated by the free-text Notes
 * column — the only text-editable cell in the grid.
 *
 * Three rules drive everything below:
 *
 *  1. `products.stock_quantity` is ONE stored field counted in vials. The
 *     "cases" column is a projection through `vials_per_box` — there is no
 *     cases column in the database.
 *  2. `products.price` IS the case price; `products.vial_price` is an optional
 *     override that is NULL for "derive it" (badged `auto`). A case costs
 *     exactly `vial price × vials_per_box` — there is no pack discount.
 *  3. Edits are staged in a local `drafts` map and only reach the API on Save,
 *     where each dirty row is PATCHed individually so the route handler's
 *     history / low-stock / back-in-stock hooks fire exactly as they do for a
 *     single inline edit. This is deliberately not a bulk upsert.
 *
 * Print (toolbar button / Ctrl+P) re-renders the visible rows as the same
 * ruled cell blocks you see, rather than printing the DOM — the grid lives in
 * a 70vh scroll box with frozen panes, which paper has no answer for.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Check,
  ChevronDown,
  Info,
  Keyboard,
  Printer,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import type { Product } from '@/lib/supabase';
import { apiFetch } from '@/lib/api-fetch';
import { escapeHtml, readableDateTime } from '@/lib/admin/report-html';
import {
  casePriceFromVial,
  fallbackVialPrice,
  formatMoneyNarrow,
  round2,
  vialPriceFor,
  vialsPerBoxOf,
} from '@/lib/pricing';

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export type ColKey = 'sku' | 'name' | 'stock_vials' | 'stock_cases' | 'note' | 'price_case' | 'price_vial';

interface ColumnDef {
  key: ColKey;
  label: string;
  /** Small lowercase line under the label (unit / currency). */
  sub?: string;
  width: number;
  editable: boolean;
  numeric: boolean;
  /** Pinned to the left on desktop. */
  frozen: boolean;
}

export const COLUMNS: ColumnDef[] = [
  { key: 'sku', label: 'SKU', width: 150, editable: false, numeric: false, frozen: true },
  { key: 'name', label: 'Product name', width: 260, editable: false, numeric: false, frozen: true },
  { key: 'stock_vials', label: 'Stock', sub: 'vials', width: 130, editable: true, numeric: true, frozen: false },
  { key: 'stock_cases', label: 'Stock', sub: 'cases', width: 130, editable: true, numeric: true, frozen: false },
  // A free-text scratch column between the stock pair and the price pair: it
  // still separates the two groups visually, and it's somewhere to jot what
  // you're looking at on a row. Saves with everything else (products.grid_note)
  // and is the grid's only text-editable column.
  { key: 'note', label: 'Notes', sub: 'internal', width: 170, editable: true, numeric: false, frozen: false },
  { key: 'price_case', label: 'Case price', sub: 'CAD', width: 150, editable: true, numeric: true, frozen: false },
  { key: 'price_vial', label: 'Vial price', sub: 'CAD', width: 150, editable: true, numeric: true, frozen: false },
];

/** Width of the row-number gutter that sits at column index −1. */
const GUTTER_WIDTH = 44;
const COL_COUNT = COLUMNS.length;
const LAST_COL = COL_COUNT - 1;
/** Selection lands on the first editable column, not on read-only SKU. */
const FIRST_EDITABLE_COL = COLUMNS.findIndex((c) => c.editable);
/** `minWidth` for the table: gutter + every column. The last column is left
 *  `auto` in the colgroup so a wide screen absorbs slack there instead of
 *  stretching (and desynchronising) the pinned columns. */
const TOTAL_WIDTH = GUTTER_WIDTH + COLUMNS.reduce((sum, c) => sum + c.width, 0);

/**
 * Precomputed `left` offset per column for the frozen panes: the gutter, then
 * SKU at 44, then Product name at 194. Non-frozen columns get 0 and never
 * read it.
 */
const FROZEN_LEFT: number[] = (() => {
  const offsets: number[] = [];
  let x = GUTTER_WIDTH;
  for (const col of COLUMNS) {
    if (col.frozen) {
      offsets.push(x);
      x += col.width;
    } else {
      offsets.push(0);
    }
  }
  return offsets;
})();

/** How many PATCHes run at once on save. */
const BATCH = 4;
/** Undo depth. One user action (a paste, a fill-down) costs one entry. */
const UNDO_LIMIT = 60;
/** How long a toolbar notice stays up. */
const NOTICE_MS = 2600;
/** How long the green row check-marks linger after a clean save. */
const ROW_STATUS_MS = 2500;
/** Longest note the API will store — enforced here too so what you see staged
 *  is what gets saved. */
const NOTE_MAX = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CellRef {
  row: number;
  col: number;
}

/**
 * A staged edit. `vial_price` is explicitly nullable (null = "back to auto"),
 * so its presence must be tested with `'vial_price' in draft` — never with
 * `!== undefined`.
 */
export interface Draft {
  stock_quantity?: number;
  price?: number;
  vial_price?: number | null;
  /** Free-text note. null = cleared, so presence must be tested with `in`. */
  grid_note?: string | null;
}

type Drafts = Record<string, Draft>;

interface EditState {
  row: number;
  col: number;
  value: string;
  /** True when the editor was opened by typing a character ("enter mode"). */
  typed: boolean;
}

export interface RowView {
  product: Product;
  per: number;
  stock: number;
  cases: number;
  loose: number;
  price: number;
  vialOverride: number | null;
  vialPrice: number;
  /** The row's free-text note, '' when there isn't one. */
  note: string;
  dirty: Set<ColKey>;
}

interface Rect {
  r1: number;
  r2: number;
  c1: number;
  c2: number;
}

interface RestockPrompt {
  rows: Array<{ id: string; name: string; emails: string[] }>;
}

/** One staged cell write, as produced by typing, pasting or filling down. */
interface CellEdit {
  rowIndex: number;
  col: ColKey;
  raw: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Is the viewport wide enough to justify 454px of pinned columns? */
function useFrozenPanes(): boolean {
  const [frozen, setFrozen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 768px)');
    setFrozen(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setFrozen(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return frozen;
}

/**
 * Read a number out of whatever the operator typed or pasted. Tolerates `$`
 * and thousands commas; returns null for anything that isn't a finite number
 * (including the bare `''`, `'-'` and `'.'` stages of typing).
 */
export function parseNumeric(raw: string): number | null {
  const cleaned = String(raw ?? '').replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Null-safe cents-level comparison for the `vial_price` override. */
export function sameOverride(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return round2(a) === round2(b);
}

/** Everything a row needs to render, saved product + staged draft folded together. */
export function buildRowView(product: Product, draft?: Draft): RowView {
  const per = vialsPerBoxOf(product.vials_per_box);
  const stock = Math.max(0, Math.floor(Number(draft?.stock_quantity ?? product.stock_quantity ?? 0)));
  const price = round2(Number(draft?.price ?? product.price ?? 0));
  const vialOverride =
    draft && 'vial_price' in draft ? draft.vial_price ?? null : product.vial_price ?? null;
  const vialPrice = vialPriceFor({ price, vial_price: vialOverride, vials_per_box: per });
  const note =
    draft && 'grid_note' in draft ? draft.grid_note ?? '' : product.grid_note ?? '';

  const dirty = new Set<ColKey>();
  if (draft?.stock_quantity !== undefined) {
    // One stored field behind two cells — the link has to be visible.
    dirty.add('stock_vials');
    dirty.add('stock_cases');
  }
  if (draft?.price !== undefined) dirty.add('price_case');
  if (draft && 'vial_price' in draft && !sameOverride(vialOverride, product.vial_price ?? null)) {
    dirty.add('price_vial');
  }
  if (draft && 'grid_note' in draft && note !== (product.grid_note ?? '')) {
    dirty.add('note');
  }

  return { product, per, stock, cases: Math.floor(stock / per), loose: stock % per, price, vialOverride, vialPrice, note, dirty };
}

/** Formatted text for a cell that isn't being edited. */
export function displayValue(view: RowView, key: ColKey): string {
  switch (key) {
    case 'sku':
      return view.product.sku ?? '—';
    case 'name':
      return view.product.name;
    case 'stock_vials':
      return view.stock.toLocaleString();
    case 'stock_cases':
      return view.cases.toLocaleString();
    case 'note':
      return view.note;
    case 'price_case':
      return formatMoneyNarrow(view.price, 'CAD');
    case 'price_vial':
      return formatMoneyNarrow(view.vialPrice, 'CAD');
  }
}

/**
 * Unformatted text: what the editor is seeded with and what goes on the
 * clipboard. A vial price on auto copies out **blank**, so a round-trip
 * through Excel doesn't accidentally pin every row to an override.
 */
export function rawValue(view: RowView, key: ColKey): string {
  switch (key) {
    case 'sku':
      return view.product.sku ?? '';
    case 'name':
      return view.product.name;
    case 'stock_vials':
      return String(view.stock);
    case 'stock_cases':
      return String(view.cases);
    case 'note':
      return view.note;
    case 'price_case':
      return view.price.toFixed(2);
    case 'price_vial':
      return view.vialOverride == null ? '' : round2(view.vialOverride).toFixed(2);
  }
}

/** The numeric value behind a cell, for the status bar's column sum. */
function numericValue(view: RowView, key: ColKey): number {
  switch (key) {
    case 'stock_vials':
      return view.stock;
    case 'stock_cases':
      return view.cases;
    case 'price_case':
      return view.price;
    case 'price_vial':
      return view.vialPrice;
    default:
      return 0;
  }
}

/**
 * The whole case ⇄ vial rule set. Returns the next draft for the row, or null
 * when the input is unusable (blank / negative / NaN in a column that has no
 * meaningful empty) — in which case the edit is dropped and the cell keeps its
 * previous value.
 */
export function applyCellEdit(
  view: RowView,
  key: ColKey,
  raw: string,
  current: Draft | undefined,
): Draft | null {
  const next: Draft = { ...(current ?? {}) };
  const text = String(raw ?? '').trim();

  switch (key) {
    case 'stock_vials': {
      const n = parseNumeric(text);
      if (n == null || n < 0) return null;
      next.stock_quantity = Math.floor(n);
      return next;
    }
    case 'stock_cases': {
      const n = parseNumeric(text);
      if (n == null || n < 0) return null;
      next.stock_quantity = Number.isInteger(n)
        ? // "Make it 5 cases" must not silently destroy the 3 odd vials
          // already sitting on the shelf next to them.
          n * view.per + view.loose
        : // A decimal describes the whole quantity, remainder included.
          Math.max(0, Math.round(n * view.per));
      return next;
    }
    case 'price_case': {
      const n = parseNumeric(text);
      if (n == null || n < 0) return null;
      const price = round2(n);
      next.price = price;
      // A row carrying an explicit override has it rescaled so the pair stays
      // consistent; a row on auto needs no write and must stay NULL.
      if (view.vialOverride != null) next.vial_price = fallbackVialPrice(price, view.per);
      return next;
    }
    case 'note': {
      // Free text, not a number. Blank means "no note", stored as null so an
      // emptied note reads the same as one that was never written. Tabs and
      // newlines are stripped because they are the TSV field/row separators —
      // one pasted into the editor would break the next copy out. Capped to
      // match the API so a runaway paste can't be staged and then rejected.
      const clean = text.replace(/[\t\r\n]+/g, ' ').trim().slice(0, NOTE_MAX);
      next.grid_note = clean === '' ? null : clean;
      return next;
    }
    case 'price_vial': {
      // The only price column with a meaningful "empty": clearing it means auto.
      if (text === '') {
        next.vial_price = null;
        return next;
      }
      const n = parseNumeric(text);
      if (n == null || n < 0) return null;
      const vial = round2(n);
      next.vial_price = vial;
      next.price = casePriceFromVial(vial, view.per);
      return next;
    }
    default:
      // Read-only identity columns.
      return null;
  }
}

/**
 * Drop draft keys that match the saved product again, so a value typed back to
 * what it already was stops counting as dirty. Returns null when nothing is
 * left, which removes the row from `drafts` entirely.
 */
export function pruneDraft(product: Product, draft: Draft): Draft | null {
  const out: Draft = { ...draft };
  if (
    out.stock_quantity !== undefined &&
    out.stock_quantity === Math.max(0, Math.floor(Number(product.stock_quantity ?? 0)))
  ) {
    delete out.stock_quantity;
  }
  if (out.price !== undefined && round2(out.price) === round2(Number(product.price ?? 0))) {
    delete out.price;
  }
  if ('vial_price' in out && sameOverride(out.vial_price ?? null, product.vial_price ?? null)) {
    delete out.vial_price;
  }
  if ('grid_note' in out && (out.grid_note ?? '') === (product.grid_note ?? '')) {
    delete out.grid_note;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Status-bar sum. Only meaningful for a single numeric column spanning at
 * least two rows — a mixed-column rectangle has no sum worth showing.
 */
export function selectionSum(rows: RowView[], sel: Rect): string | null {
  if (sel.c1 !== sel.c2) return null;
  const col = COLUMNS[sel.c1];
  if (!col?.numeric) return null;
  if (sel.r2 - sel.r1 < 1) return null;

  let total = 0;
  for (let r = sel.r1; r <= sel.r2; r++) {
    const view = rows[r];
    if (view) total += numericValue(view, col.key);
  }
  return col.key === 'price_case' || col.key === 'price_vial'
    ? formatMoneyNarrow(round2(total), 'CAD')
    : total.toLocaleString();
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

/** The grid's own palette, inlined so the printed document is self-contained. */
const PRINT_CSS = `
  @page { size: A4 landscape; margin: 10mm; }
  :root {
    --ink: #1A1A1A; --ink-muted: #6E6E6E; --line: #C9CCD1;
    --surface: #F7F7F7; --surface-2: #F2F2F2;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: #fff; color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* No \`overflow: hidden\` on the frame: it would be the container a
     multi-page table fragments inside, and the rounded corners it exists to
     clip belong to the bar and footer anyway. */
  .frame { border: 1px solid var(--line); border-radius: 12px; }

  /* The grid's toolbar and status bar, flattened for paper. */
  .bar {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--line);
    border-radius: 11px 11px 0 0;
  }
  .bar .name { font-weight: 600; }
  .bar .sep { color: var(--ink-muted); }
  .bar .right { margin-left: auto; color: var(--ink-muted); font-size: 11px; }
  .bar .unsaved {
    padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;
    background: #FEF3C7; color: #92400E;
  }
  .foot {
    padding: 8px 16px; border-top: 1px solid var(--line); background: var(--surface);
    font-size: 11px; color: var(--ink-muted); border-radius: 0 0 11px 11px;
  }

  /* The grid itself: same fixed layout, same 1px rules on every cell. */
  table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td {
    border-bottom: 1px solid var(--line); border-right: 1px solid var(--line);
    padding: 6px 10px; vertical-align: middle; text-align: left;
    overflow-wrap: anywhere;
  }
  th:last-child, td:last-child { border-right: none; }
  tbody tr:last-child th, tbody tr:last-child td { border-bottom: none; }
  thead th { background: var(--surface-2); vertical-align: bottom; }
  thead th .label {
    font-size: 10px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.06em; line-height: 1.2;
  }
  thead th .sub {
    font-size: 9px; font-weight: 500; color: var(--ink-muted);
    text-transform: lowercase; letter-spacing: 0.04em;
  }
  /* Row-number gutter, exactly as the grid renders column index −1. */
  .gutter {
    background: var(--surface-2); color: var(--ink-muted);
    text-align: center; font-size: 10px; font-variant-numeric: tabular-nums;
  }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  /* An unsaved cell: the grid's amber tint and its corner marker. */
  td.dirty { background: #FFFBEB; position: relative; }
  td.dirty::after {
    content: ""; position: absolute; top: 0; right: 0;
    border-top: 6px solid #F59E0B; border-left: 6px solid transparent;
  }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; }
  .sub { font-size: 9px; color: var(--ink-muted); line-height: 1.3; }
  .loose { font-size: 9px; color: var(--ink-muted); }
  .auto {
    font-size: 8px; font-weight: 500; color: var(--ink-muted);
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .low { color: #D97706; font-weight: 500; }
  .out { color: #DC2626; font-weight: 500; }
  .empty { padding: 40px; text-align: center; color: var(--ink-muted); }
`;

/**
 * Turn the rows exactly as the grid is showing them into a print-ready HTML
 * document — the same seven columns in the same order, the same row order the
 * parent handed down (so the print follows whatever search and sort are on
 * screen), and the same look: ruled cell blocks, the row-number gutter, the
 * uppercase header with its unit sub-line, the `auto` badge, and the amber
 * tint + corner marker on a cell with an unsaved edit.
 *
 * It is a re-render rather than a print of the DOM because the grid lives in a
 * 70vh scroll box behind frozen panes, which paper has no answer for. Column
 * widths carry over as percentages of `TOTAL_WIDTH`, so the proportions are the
 * grid's but the table fits the page. A note wraps instead of truncating —
 * paper has no hover to recover the rest with.
 *
 * Built client-side from the rows already in hand, so staged edits print too.
 */
export function buildPrintHtml(rows: RowView[], opts: { dirtyCount: number } = { dirtyCount: 0 }): string {
  const pct = (w: number) => `${((w / TOTAL_WIDTH) * 100).toFixed(3)}%`;

  const cols = `<colgroup><col style="width:${pct(GUTTER_WIDTH)}" />${COLUMNS.map(
    (c) => `<col style="width:${pct(c.width)}" />`,
  ).join('')}</colgroup>`;

  const head = `<thead><tr><th class="gutter"></th>${COLUMNS.map(
    (c) =>
      `<th><div class="label">${escapeHtml(c.label)}</div>${
        c.sub ? `<div class="sub">${escapeHtml(c.sub)}</div>` : ''
      }</th>`,
  ).join('')}</tr></thead>`;

  // One cell's read-mode contents, mirroring `CellDisplay`.
  const cellHtml = (view: RowView, key: ColKey): string => {
    switch (key) {
      case 'sku':
        return `<span class="mono">${escapeHtml(view.product.sku ?? '—')}</span>`;
      case 'name':
        return `<div>${escapeHtml(view.product.name)}</div><div class="sub">${view.per} ${
          view.per === 1 ? 'vial' : 'vials'
        } / case</div>`;
      case 'stock_vials': {
        const low = Number(view.product.low_stock_threshold ?? 0);
        const tone = view.stock <= 0 ? 'out' : view.stock <= low ? 'low' : '';
        const text = escapeHtml(view.stock.toLocaleString());
        return tone ? `<span class="${tone}">${text}</span>` : text;
      }
      case 'stock_cases':
        return `${escapeHtml(view.cases.toLocaleString())}${
          view.loose > 0 ? ` <span class="loose">+${view.loose}v</span>` : ''
        }`;
      case 'note':
        return escapeHtml(view.note);
      case 'price_case':
        return escapeHtml(displayValue(view, 'price_case'));
      case 'price_vial':
        return `${escapeHtml(displayValue(view, 'price_vial'))}${
          view.vialOverride == null ? ' <span class="auto">auto</span>' : ''
        }`;
    }
  };

  const body = rows
    .map((view, i) => {
      const cells = COLUMNS.map((col) => {
        // Same classes on the same cells the grid right-aligns and tints amber.
        const classes = [col.numeric ? 'num' : '', view.dirty.has(col.key) ? 'dirty' : '']
          .filter(Boolean)
          .join(' ');
        return `<td${classes ? ` class="${classes}"` : ''}>${cellHtml(view, col.key)}</td>`;
      }).join('');
      return `<tr><th class="gutter">${i + 1}</th>${cells}</tr>`;
    })
    .join('');

  const grid =
    rows.length === 0
      ? '<div class="empty">No products in view.</div>'
      : `<table>${cols}${head}<tbody>${body}</tbody></table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Products — cell edit</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<div class="frame">
  <div class="bar">
    <span class="name">Cell edit</span>
    <span class="sep">·</span>
    <span>${rows.length} row${rows.length === 1 ? '' : 's'}</span>
    ${
      opts.dirtyCount > 0
        ? `<span class="unsaved">${opts.dirtyCount} unsaved</span>`
        : ''
    }
    <span class="right">${escapeHtml(readableDateTime())}</span>
  </div>
  ${grid}
  <div class="foot">Internal — prices in CAD${
    opts.dirtyCount > 0 ? ' · amber cells are staged edits that have not been saved' : ''
  }</div>
</div>
<script>window.addEventListener("load", () => { setTimeout(() => window.print(), 350); });</script>
</body>
</html>`;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

// ---------------------------------------------------------------------------
// CellEditGrid
// ---------------------------------------------------------------------------

export interface CellEditGridProps {
  /** Rows to show — already searched / sorted by the parent. The grid never
   *  fetches, sorts or paginates; it renders `products` as given. */
  products: Product[];
  /** Admin-only. `false` renders a read-only but still selectable grid. */
  canEdit: boolean;
  /** Fresh product rows returned by the API after a successful save. */
  onSaved: (updated: Product[]) => void;
  /** Fires on every change to the staged-draft count. */
  onDirtyCountChange?: (count: number) => void;
}

export default function CellEditGrid({
  products,
  canEdit,
  onSaved,
  onDirtyCountChange,
}: CellEditGridProps) {
  const [drafts, setDrafts] = useState<Drafts>({});
  const [anchor, setAnchor] = useState<CellRef>({ row: 0, col: FIRST_EDITABLE_COL });
  const [extent, setExtent] = useState<CellRef>({ row: 0, col: FIRST_EDITABLE_COL });
  const [editing, setEditing] = useState<EditState | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [notice, setNotice] = useState('');
  const [restockPrompt, setRestockPrompt] = useState<RestockPrompt | null>(null);
  const frozen = useFrozenPanes();

  const gridRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());
  const editInputRef = useRef<HTMLInputElement | null>(null);
  /** Previous draft maps, newest last. One user action = one entry. */
  const undoStack = useRef<Drafts[]>([]);
  /** Mirrors `editing` so a commit can run synchronously (mousedown + blur
   *  both fire for the same click) without applying the edit twice. */
  const editingRef = useRef<EditState | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didMount = useRef(false);

  const rows = useMemo(
    () => products.map((p) => buildRowView(p, drafts[p.id])),
    [products, drafts],
  );
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const dirtyIds = useMemo(
    () => products.map((p) => p.id).filter((id) => drafts[id]),
    [products, drafts],
  );
  const dirtyCount = Object.keys(drafts).length;

  const sel: Rect = useMemo(
    () => ({
      r1: Math.min(anchor.row, extent.row),
      r2: Math.max(anchor.row, extent.row),
      c1: Math.min(anchor.col, extent.col),
      c2: Math.max(anchor.col, extent.col),
    }),
    [anchor, extent],
  );

  const rowCount = products.length;
  const sumLabel = selectionSum(rows, sel);

  // -- notices -------------------------------------------------------------

  const notify = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), NOTICE_MS);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (statusTimer.current) clearTimeout(statusTimer.current);
    },
    [],
  );

  // -- dirty count / unload guard -----------------------------------------

  useEffect(() => {
    onDirtyCountChange?.(dirtyCount);
  }, [dirtyCount, onDirtyCountChange]);

  useEffect(() => {
    if (dirtyCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirtyCount]);

  // Keep the selection inside the grid when the filtered set shrinks.
  useEffect(() => {
    const last = Math.max(0, rowCount - 1);
    setAnchor((a) => (a.row > last ? { ...a, row: last } : a));
    setExtent((e) => (e.row > last ? { ...e, row: last } : e));
  }, [rowCount]);

  // -- selection / navigation ---------------------------------------------

  const focusGrid = useCallback(() => gridRef.current?.focus(), []);

  const registerRef = useCallback((row: number, col: number, el: HTMLTableCellElement | null) => {
    const key = `${row}:${col}`;
    if (el) cellRefs.current.set(key, el);
    else cellRefs.current.delete(key);
  }, []);

  useEffect(() => {
    // Skip the first run so mounting the grid never yanks the page.
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    cellRefs.current
      .get(`${anchor.row}:${anchor.col}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [anchor.row, anchor.col]);

  const moveTo = useCallback(
    (row: number, col: number, extend = false) => {
      const r = clamp(row, 0, Math.max(0, rowCount - 1));
      const c = clamp(col, 0, LAST_COL);
      if (extend) setExtent({ row: r, col: c });
      else {
        setAnchor({ row: r, col: c });
        setExtent({ row: r, col: c });
      }
    },
    [rowCount],
  );

  /** Next / previous cell in reading order, wrapping across row ends. */
  const step = useCallback(
    (dir: 1 | -1) => {
      const total = rowCount * COL_COUNT;
      if (total === 0) return;
      const raw = anchor.row * COL_COUNT + anchor.col + dir;
      const idx = ((raw % total) + total) % total;
      moveTo(Math.floor(idx / COL_COUNT), idx % COL_COUNT);
    },
    [anchor, rowCount, moveTo],
  );

  // -- staging -------------------------------------------------------------

  /**
   * The only path that mutates `drafts`. Builds the next map eagerly (not
   * inside a setState updater) so the undo stack — a ref — is only touched
   * from an effectful path, and rebuilds each row view against the
   * in-progress draft so two edits landing on the same row (a pasted
   * case + vial pair) compose instead of clobbering each other.
   *
   * Returns how many edits actually landed.
   */
  const commitEdits = useCallback(
    (edits: CellEdit[]): number => {
      if (!canEdit || edits.length === 0) return 0;

      const previous = drafts;
      const next: Drafts = { ...drafts };
      const touched = new Set<string>();
      let applied = 0;

      for (const edit of edits) {
        const product = products[edit.rowIndex];
        if (!product) continue;
        const view = buildRowView(product, next[product.id]);
        const draft = applyCellEdit(view, edit.col, edit.raw, next[product.id]);
        if (!draft) continue;
        const pruned = pruneDraft(product, draft);
        if (pruned) next[product.id] = pruned;
        else delete next[product.id];
        touched.add(product.id);
        applied++;
      }

      if (applied === 0) return 0;

      // One user action costs exactly one Ctrl/⌘+Z.
      undoStack.current.push(previous);
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      setDrafts(next);

      // Editing a failed row clears its stale error, but never a live save.
      setRowStatus((prev) => {
        let changed = false;
        const out = { ...prev };
        for (const id of touched) {
          if (out[id] && out[id] !== 'saving') {
            delete out[id];
            changed = true;
          }
        }
        return changed ? out : prev;
      });
      setRowErrors((prev) => {
        let changed = false;
        const out = { ...prev };
        for (const id of touched) {
          if (out[id]) {
            delete out[id];
            changed = true;
          }
        }
        return changed ? out : prev;
      });

      return applied;
    },
    [canEdit, drafts, products],
  );

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) {
      notify('Nothing to undo');
      return;
    }
    setDrafts(previous);
    notify('Undid last change');
  }, [notify]);

  const discard = useCallback(() => {
    if (!canEdit || dirtyCount === 0) return;
    // Discard is itself undoable.
    undoStack.current.push(drafts);
    if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
    setDrafts({});
    setRowStatus({});
    setRowErrors({});
    notify('Discarded staged edits');
  }, [canEdit, dirtyCount, drafts, notify]);

  // -- the editor ----------------------------------------------------------

  const openEditor = useCallback(
    (state: EditState | null) => {
      editingRef.current = state;
      setEditing(state);
    },
    [],
  );

  const beginEdit = useCallback(
    (row: number, col: number, typedChar?: string) => {
      if (!canEdit) return;
      const column = COLUMNS[col];
      if (!column?.editable) return;
      const product = products[row];
      if (!product) return;
      const view = buildRowView(product, drafts[product.id]);
      openEditor({
        row,
        col,
        value: typedChar ?? rawValue(view, column.key),
        typed: typedChar !== undefined,
      });
    },
    [canEdit, products, drafts, openEditor],
  );

  const commitEditor = useCallback(() => {
    const current = editingRef.current;
    if (!current) return;
    openEditor(null);
    const column = COLUMNS[current.col];
    const product = products[current.row];
    if (!product || !column?.editable) return;
    commitEdits([{ rowIndex: current.row, col: column.key, raw: current.value }]);
  }, [commitEdits, products, openEditor]);

  const cancelEditor = useCallback(() => openEditor(null), [openEditor]);

  // -- clipboard / fill / clear -------------------------------------------

  const handleCopy = useCallback(
    (e: React.ClipboardEvent) => {
      if (editingRef.current) return; // let the input's own copy run
      const lines: string[] = [];
      let cells = 0;
      for (let r = sel.r1; r <= sel.r2; r++) {
        const view = rows[r];
        if (!view) continue;
        const line: string[] = [];
        for (let c = sel.c1; c <= sel.c2; c++) {
          line.push(rawValue(view, COLUMNS[c].key));
          cells++;
        }
        lines.push(line.join('\t'));
      }
      if (lines.length === 0) return;
      e.clipboardData.setData('text/plain', lines.join('\n'));
      e.preventDefault();
      notify(`Copied ${cells} cells`);
    },
    [rows, sel, notify],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (editingRef.current) return; // let the input's own paste run
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      if (!canEdit) {
        notify("Read-only — your role can't change prices or stock");
        return;
      }

      const block = text
        .replace(/\r\n?/g, '\n')
        .replace(/\n$/, '')
        .split('\n')
        .map((line) => line.split('\t'));

      const edits: CellEdit[] = [];
      let skipped = 0;
      let lastRow = sel.r1;
      let lastCol = sel.c1;

      for (let i = 0; i < block.length; i++) {
        const r = sel.r1 + i;
        if (r >= rowCount) break;
        const line = block[i];
        for (let j = 0; j < line.length; j++) {
          const c = sel.c1 + j;
          if (c > LAST_COL) break;
          lastRow = Math.max(lastRow, r);
          lastCol = Math.max(lastCol, c);
          const column = COLUMNS[c];
          if (!column.editable) {
            skipped++;
            continue;
          }
          // Row-major order means the vial price lands after the case price on
          // the same row, so an inconsistent pasted pair resolves to
          // `vial × per` — the number the storefront would have charged.
          edits.push({ rowIndex: r, col: column.key, raw: line[j] });
        }
      }

      const applied = commitEdits(edits);
      setAnchor({ row: sel.r1, col: sel.c1 });
      setExtent({ row: lastRow, col: lastCol });
      notify(
        `Pasted ${applied} cells${skipped > 0 ? ` (${skipped} read-only cells skipped)` : ''}`,
      );
    },
    [canEdit, commitEdits, notify, rowCount, sel],
  );

  const fillDown = useCallback(() => {
    if (!canEdit || sel.r1 === sel.r2) return;
    const source = products[sel.r1];
    if (!source) return;
    const sourceView = buildRowView(source, drafts[source.id]);

    const edits: CellEdit[] = [];
    for (let r = sel.r1 + 1; r <= sel.r2; r++) {
      for (let c = sel.c1; c <= sel.c2; c++) {
        const column = COLUMNS[c];
        if (!column.editable) continue;
        edits.push({ rowIndex: r, col: column.key, raw: rawValue(sourceView, column.key) });
      }
    }
    const applied = commitEdits(edits);
    if (applied > 0) notify(`Filled ${applied} cells down`);
  }, [canEdit, commitEdits, drafts, notify, products, sel]);

  const clearSelection = useCallback(() => {
    if (!canEdit) return;
    const edits: CellEdit[] = [];
    let clearedNotes = 0;
    let clearedPrices = 0;
    for (let r = sel.r1; r <= sel.r2; r++) {
      for (let c = sel.c1; c <= sel.c2; c++) {
        // The two columns with a meaningful "empty": a vial price back to auto,
        // and a note back to nothing. Stock and the case price have neither.
        const key = COLUMNS[c].key;
        if (key === 'price_vial') {
          edits.push({ rowIndex: r, col: 'price_vial', raw: '' });
          clearedPrices++;
        } else if (key === 'note') {
          edits.push({ rowIndex: r, col: 'note', raw: '' });
          clearedNotes++;
        }
      }
    }
    if (edits.length === 0) {
      notify("Stock and case price can't be blank — type a number instead");
      return;
    }
    const applied = commitEdits(edits);
    if (applied === 0) return;
    notify(
      clearedNotes > 0 && clearedPrices > 0
        ? 'Notes cleared, vial price reset to auto'
        : clearedNotes > 0
          ? `Cleared ${clearedNotes} note${clearedNotes === 1 ? '' : 's'}`
          : 'Vial price reset to auto',
    );
  }, [canEdit, commitEdits, notify, sel]);

  // -- save ----------------------------------------------------------------

  /**
   * Write the staged rows. Each dirty row is PATCHed individually with a
   * minimal payload — only the columns that actually differ from the saved
   * product — so the route handler's history, low-stock and back-in-stock
   * hooks fire exactly as they do for a single inline edit.
   */
  const persist = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      if (statusTimer.current) clearTimeout(statusTimer.current);
      setSaving(true);
      setRowErrors({});
      setRowStatus(Object.fromEntries(ids.map((id) => [id, 'saving' as const])));

      const updated: Product[] = [];
      const savedIds: string[] = [];
      const failures: Record<string, string> = {};

      for (let i = 0; i < ids.length; i += BATCH) {
        const slice = ids.slice(i, i + BATCH);
        await Promise.all(
          slice.map(async (id) => {
            const product = productById.get(id);
            const draft = drafts[id];
            if (!product || !draft) return;

            const payload: Record<string, unknown> = { change_source: 'cell-grid' };
            if (
              draft.stock_quantity !== undefined &&
              draft.stock_quantity !== Number(product.stock_quantity ?? 0)
            ) {
              payload.stock_quantity = draft.stock_quantity;
            }
            if (draft.price !== undefined && round2(draft.price) !== round2(Number(product.price ?? 0))) {
              payload.price = round2(draft.price);
            }
            if (
              'vial_price' in draft &&
              !sameOverride(draft.vial_price ?? null, product.vial_price ?? null)
            ) {
              // Sent explicitly as null to clear an override back to auto.
              payload.vial_price = draft.vial_price ?? null;
            }
            if (
              'grid_note' in draft &&
              (draft.grid_note ?? '') !== (product.grid_note ?? '')
            ) {
              // Sent explicitly as null to clear the note.
              payload.grid_note = draft.grid_note ?? null;
            }

            try {
              const res = await apiFetch<{ product: Product }>(`/api/admin/products/${id}`, {
                method: 'PATCH',
                body: JSON.stringify(payload),
              });
              if (res?.product) updated.push(res.product);
              savedIds.push(id);
            } catch (err) {
              failures[id] = err instanceof Error ? err.message : 'Save failed';
            }
          }),
        );
      }

      // Only the drafts that landed are cleared — a failed row keeps its
      // staged value so the operator can retry without retyping.
      setDrafts((prev) => {
        const next = { ...prev };
        for (const id of savedIds) delete next[id];
        return next;
      });
      setRowErrors(failures);
      setRowStatus(
        Object.fromEntries(ids.map((id) => [id, failures[id] ? ('error' as const) : ('saved' as const)])),
      );
      setSaving(false);

      if (updated.length > 0) onSaved(updated);

      const failed = Object.keys(failures).length;
      notify(failed > 0 ? `Saved ${savedIds.length}, ${failed} failed` : `Saved ${savedIds.length} products`);
      if (failed === 0) {
        statusTimer.current = setTimeout(() => setRowStatus({}), ROW_STATUS_MS);
      }
    },
    [drafts, notify, onSaved, productById],
  );

  const saveAll = useCallback(async () => {
    if (!canEdit || saving || dirtyIds.length === 0) return;

    // Restock guard: rows crossing 0 → positive get their waitlist checked
    // before anything is written. A failed lookup degrades to "no waiters"
    // rather than blocking an inventory update.
    const crossing = dirtyIds.filter((id) => {
      const product = productById.get(id);
      const draft = drafts[id];
      if (!product || draft?.stock_quantity === undefined) return false;
      return Number(product.stock_quantity ?? 0) <= 0 && draft.stock_quantity > 0;
    });

    if (crossing.length > 0) {
      setSaving(true);
      const looked = await Promise.all(
        crossing.map(async (id) => {
          try {
            const data = await apiFetch<{ emails: string[] }>(
              `/api/admin/stock-notifications?product_id=${encodeURIComponent(id)}`,
            );
            return { id, emails: Array.isArray(data?.emails) ? data.emails : [] };
          } catch {
            return { id, emails: [] as string[] };
          }
        }),
      );
      setSaving(false);
      const waiting = looked
        .filter((r) => r.emails.length > 0)
        .map((r) => ({ id: r.id, name: productById.get(r.id)?.name ?? 'Product', emails: r.emails }));
      if (waiting.length > 0) {
        setRestockPrompt({ rows: waiting });
        return; // nothing is written until the operator confirms
      }
    }

    await persist(dirtyIds);
  }, [canEdit, saving, dirtyIds, drafts, productById, persist]);

  const confirmRestock = useCallback(async () => {
    // The dialog stays up while the write runs so its button can spin, then
    // closes once every row has landed.
    await persist(dirtyIds);
    setRestockPrompt(null);
  }, [dirtyIds, persist]);

  // -- printing ------------------------------------------------------------

  /**
   * Open the grid as it stands in a new tab, which auto-prints. Same route as
   * every other admin report: a blob URL rather than a fetch, since the rows
   * (and any staged edits) already live here — printing never hits the API.
   */
  const printGrid = useCallback(() => {
    if (rows.length === 0) {
      notify('Nothing to print');
      return;
    }
    const url = URL.createObjectURL(
      new Blob([buildPrintHtml(rows, { dirtyCount })], { type: 'text/html' }),
    );
    const win = window.open(url, '_blank');
    if (!win) {
      URL.revokeObjectURL(url);
      notify('Allow pop-ups to print');
      return;
    }
    // The new tab needs the blob alive while it loads; free it well after.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [rows, dirtyCount, notify]);

  // -- keyboard ------------------------------------------------------------

  const onGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (editingRef.current) return; // the editor input owns these keys
      if (rowCount === 0) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;

      if (mod) {
        const lower = key.toLowerCase();
        if (lower === 'c' || lower === 'v') return; // handled by onCopy / onPaste
        if (lower === 'd') {
          e.preventDefault();
          fillDown();
          return;
        }
        if (lower === 'z') {
          e.preventDefault();
          undo();
          return;
        }
        if (lower === 'a') {
          e.preventDefault();
          setAnchor({ row: 0, col: 0 });
          setExtent({ row: rowCount - 1, col: LAST_COL });
          return;
        }
        if (lower === 's') {
          e.preventDefault();
          void saveAll();
          return;
        }
        if (lower === 'p') {
          // Take Ctrl/⌘+P off the browser, which would otherwise print the
          // whole admin page and clip the grid at its scroll box.
          e.preventDefault();
          printGrid();
          return;
        }
        if (key === 'Home' || key === 'End') {
          e.preventDefault();
          moveTo(key === 'Home' ? 0 : rowCount - 1, anchor.col, e.shiftKey);
          return;
        }
        return;
      }

      switch (key) {
        case 'ArrowUp':
          e.preventDefault();
          if (e.shiftKey) setExtent((x) => ({ row: clamp(x.row - 1, 0, rowCount - 1), col: x.col }));
          else moveTo(anchor.row - 1, anchor.col);
          return;
        case 'ArrowDown':
          e.preventDefault();
          if (e.shiftKey) setExtent((x) => ({ row: clamp(x.row + 1, 0, rowCount - 1), col: x.col }));
          else moveTo(anchor.row + 1, anchor.col);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) setExtent((x) => ({ row: x.row, col: clamp(x.col - 1, 0, LAST_COL) }));
          else moveTo(anchor.row, anchor.col - 1);
          return;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) setExtent((x) => ({ row: x.row, col: clamp(x.col + 1, 0, LAST_COL) }));
          else moveTo(anchor.row, anchor.col + 1);
          return;
        case 'Tab':
          e.preventDefault();
          step(e.shiftKey ? -1 : 1);
          return;
        case 'PageUp':
          e.preventDefault();
          moveTo(anchor.row - 10, anchor.col);
          return;
        case 'PageDown':
          e.preventDefault();
          moveTo(anchor.row + 10, anchor.col);
          return;
        case 'Home':
          e.preventDefault();
          moveTo(anchor.row, 0);
          return;
        case 'End':
          e.preventDefault();
          moveTo(anchor.row, LAST_COL);
          return;
        case 'Enter':
        case 'F2':
          e.preventDefault();
          beginEdit(anchor.row, anchor.col);
          return;
        case 'Escape':
          e.preventDefault();
          setExtent(anchor);
          return;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          clearSelection();
          return;
        default:
          break;
      }

      // Type-to-replace. A numeric column takes a digit, dot or minus; the text
      // column (Notes) takes any printable character, so you can just start
      // typing a note the way you would in a spreadsheet.
      const column = COLUMNS[anchor.col];
      const opensEditor = column?.numeric === false && column.editable
        ? key.length === 1 && key !== ' ' && !e.ctrlKey && !e.metaKey
        : key.length === 1 && /[0-9.-]/.test(key);
      if (opensEditor && !e.altKey) {
        e.preventDefault();
        beginEdit(anchor.row, anchor.col, key);
      }
    },
    [anchor, rowCount, moveTo, step, beginEdit, clearSelection, fillDown, undo, saveAll, printGrid],
  );

  const onEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const current = editingRef.current;
      if (!current) return;
      const key = e.key;

      if (key === 'Escape') {
        e.preventDefault();
        cancelEditor();
        focusGrid();
        return;
      }
      if (key === 'Enter') {
        e.preventDefault();
        commitEditor();
        moveTo(current.row + (e.shiftKey ? -1 : 1), current.col);
        focusGrid();
        return;
      }
      if (key === 'Tab') {
        e.preventDefault();
        commitEditor();
        step(e.shiftKey ? -1 : 1);
        focusGrid();
        return;
      }
      // An editor opened with Enter/F2/double-click keeps the arrows for moving
      // the text caret — the Excel behaviour operators expect. Only "enter
      // mode" (opened by typing) commits and moves.
      if (current.typed && (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight')) {
        e.preventDefault();
        commitEditor();
        const dr = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
        const dc = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
        moveTo(current.row + dr, current.col + dc);
        focusGrid();
      }
    },
    [cancelEditor, commitEditor, focusGrid, moveTo, step],
  );

  const onEditBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const next = e.relatedTarget as Node | null;
      const insideGrid = !next || !!gridRef.current?.contains(next);
      commitEditor();
      // A click that landed outside the grid (Save, Discard) keeps its focus —
      // otherwise the button loses the click that just committed the cell.
      if (insideGrid) focusGrid();
    },
    [commitEditor, focusGrid],
  );

  const onCellMouseDown = useCallback(
    (row: number, col: number, shift: boolean) => {
      if (editingRef.current) commitEditor();
      if (shift) setExtent({ row, col });
      else {
        setAnchor({ row, col });
        setExtent({ row, col });
      }
      focusGrid();
    },
    [commitEditor, focusGrid],
  );

  // -- render --------------------------------------------------------------

  const errorList = products
    .filter((p) => rowErrors[p.id])
    .map((p) => ({ id: p.id, name: p.name, message: rowErrors[p.id] }));

  const selectionLabel = (() => {
    const width = sel.c2 - sel.c1 + 1;
    const height = sel.r2 - sel.r1 + 1;
    if (width === 1 && height === 1) {
      const col = COLUMNS[sel.c1];
      return `${col.label}${col.sub ? ` (${col.sub})` : ''} · row ${sel.r1 + 1}`;
    }
    return `${height} × ${width} cells selected`;
  })();

  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line bg-surface">
        <div className="flex items-center gap-2 text-sm text-ink">
          <span className="font-semibold">Cell edit</span>
          <span className="text-ink-muted">·</span>
          <span>{rowCount} rows</span>
          {dirtyCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-medium">
              {dirtyCount} unsaved
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {notice && <span className="text-xs text-ink-muted">{notice}</span>}

          <button
            type="button"
            onClick={printGrid}
            title="Print the table as shown (Ctrl/⌘+P)"
            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-line bg-white text-ink-muted hover:text-ink hover:bg-surface text-sm"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>

          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            aria-expanded={showHelp}
            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-line bg-white text-ink-muted hover:text-ink hover:bg-surface text-sm"
          >
            <Keyboard className="w-4 h-4" />
            Shortcuts
            <ChevronDown className={`w-4 h-4 transition-transform ${showHelp ? 'rotate-180' : ''}`} />
          </button>

          {canEdit && (
            <>
              <button
                type="button"
                onClick={discard}
                disabled={dirtyCount === 0 || saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line bg-white text-ink text-sm hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4" />
                Discard
              </button>
              <button
                type="button"
                onClick={() => void saveAll()}
                disabled={dirtyCount === 0 || saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-b-2 border-white animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    {dirtyCount > 0 ? `Save (${dirtyCount})` : 'Save'}
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {!canEdit && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-surface/60 border-b border-line text-xs text-ink-muted">
          <Info className="w-4 h-4 flex-shrink-0 mt-px" />
          <span>
            Read-only — your role can&apos;t change prices or stock. You can still select and copy
            cells.
          </span>
        </div>
      )}

      {showHelp && <HelpPanel />}

      {/*
        Grid. `isolate` keeps the sticky headers' z-20…z-50 ladder INSIDE this
        scroller — without it those layers compete at the root stacking context
        and paint over page-level dropdowns (the Reports menu), which is what
        put that menu behind the column headers.
      */}
      <div
        ref={gridRef}
        tabIndex={0}
        role="grid"
        aria-label="Product price and stock grid"
        aria-rowcount={rowCount + 1}
        aria-colcount={COL_COUNT}
        onKeyDown={onGridKeyDown}
        onCopy={handleCopy}
        onPaste={handlePaste}
        className="isolate overflow-auto max-h-[70vh] outline-none focus:ring-2 focus:ring-inset focus:ring-bronze/30"
      >
        <table
          className="table-fixed w-full border-separate border-spacing-0 text-sm"
          style={{ minWidth: TOTAL_WIDTH }}
        >
          <colgroup>
            <col style={{ width: GUTTER_WIDTH }} />
            {COLUMNS.map((col, i) => (
              // The last column is deliberately left `auto` so a wide screen
              // absorbs the slack there instead of stretching the pinned ones.
              <col key={col.key} style={i === LAST_COL ? undefined : { width: col.width }} />
            ))}
          </colgroup>

          <thead>
            <tr>
              <th
                className="sticky top-0 z-50 bg-surface-2 border-b border-r border-line"
                style={frozen ? { left: 0 } : undefined}
              >
                <span className="sr-only">Row</span>
              </th>
              {COLUMNS.map((col, i) => {
                const inSelection = i >= sel.c1 && i <= sel.c2;
                const pinned = frozen && col.frozen;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={`sticky top-0 border-b border-r border-line px-3 py-2 text-left align-bottom ${
                      pinned ? 'z-40' : 'z-30'
                    } ${inSelection ? 'bg-bronze/15' : 'bg-surface-2'}`}
                    style={pinned ? { left: FROZEN_LEFT[i] } : undefined}
                  >
                    <div className="text-[11px] font-semibold text-ink uppercase tracking-wider leading-tight">
                      {col.label}
                    </div>
                    {col.sub && (
                      <div className="text-[10px] font-medium text-ink-muted lowercase tracking-wide">
                        {col.sub}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT + 1} className="px-5 py-12 text-center text-ink-muted text-sm">
                  No products found
                </td>
              </tr>
            ) : (
              rows.map((view, rowIndex) => {
                const id = view.product.id;
                const status = rowStatus[id];
                const rowSelected = rowIndex >= sel.r1 && rowIndex <= sel.r2;
                return (
                  <tr key={id}>
                    <th
                      scope="row"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onCellMouseDown(rowIndex, 0, e.shiftKey);
                      }}
                      title={rowErrors[id] ?? `Row ${rowIndex + 1}`}
                      className={`border-b border-r border-line text-center align-middle cursor-pointer select-none text-[11px] tabular-nums ${
                        frozen ? 'sticky left-0 z-20' : ''
                      } ${
                        rowSelected
                          ? 'bg-bronze/15 text-ink font-semibold'
                          : 'bg-surface-2 text-ink-muted font-normal'
                      }`}
                    >
                      {status === 'saving' ? (
                        <span className="inline-block h-3 w-3 rounded-full border-b-2 border-bronze animate-spin align-middle" />
                      ) : status === 'saved' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600 inline-block align-middle" />
                      ) : status === 'error' ? (
                        <AlertCircle className="w-3.5 h-3.5 text-red-600 inline-block align-middle" />
                      ) : (
                        rowIndex + 1
                      )}
                    </th>

                    {COLUMNS.map((col, colIndex) => (
                      <GridCell
                        key={col.key}
                        col={col}
                        colIndex={colIndex}
                        rowIndex={rowIndex}
                        view={view}
                        isActive={anchor.row === rowIndex && anchor.col === colIndex}
                        isSelected={
                          rowSelected && colIndex >= sel.c1 && colIndex <= sel.c2
                        }
                        isMultiSelection={sel.r1 !== sel.r2 || sel.c1 !== sel.c2}
                        isDirty={view.dirty.has(col.key)}
                        isSaving={status === 'saving'}
                        hasError={status === 'error'}
                        pinned={frozen && col.frozen}
                        editing={
                          editing && editing.row === rowIndex && editing.col === colIndex
                            ? editing
                            : null
                        }
                        editInputRef={editInputRef}
                        canEdit={canEdit}
                        onMouseDown={onCellMouseDown}
                        onDoubleClick={beginEdit}
                        onEditChange={(value) =>
                          openEditor(editingRef.current ? { ...editingRef.current, value } : null)
                        }
                        onEditKeyDown={onEditKeyDown}
                        onEditBlur={onEditBlur}
                        registerRef={registerRef}
                      />
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 border-t border-line bg-surface text-[11px] text-ink-muted">
        <span>{selectionLabel}</span>
        {sumLabel && (
          <span className="tabular-nums">
            Sum <span className="text-ink font-medium">{sumLabel}</span>
          </span>
        )}
        <span className="ml-auto hidden sm:inline">
          Arrows move · Enter edits · Tab next · Ctrl/⌘+V paste · Ctrl/⌘+D fill down · Ctrl/⌘+S save · Ctrl/⌘+P print
        </span>
      </div>

      {/* Per-row save failures */}
      {errorList.length > 0 && (
        <div className="px-4 py-3 border-t border-red-200 bg-red-50">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-px" />
            <ul className="space-y-0.5">
              {errorList.map((row) => (
                <li key={row.id} className="text-xs text-red-800">
                  <span className="font-semibold">{row.name}</span> — {row.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {restockPrompt && (
        <RestockDialog
          prompt={restockPrompt}
          saving={saving}
          onCancel={() => setRestockPrompt(null)}
          onConfirm={() => void confirmRestock()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GridCell
// ---------------------------------------------------------------------------

interface GridCellProps {
  col: ColumnDef;
  colIndex: number;
  rowIndex: number;
  view: RowView;
  isActive: boolean;
  isSelected: boolean;
  /** True when the selection covers more than a single cell. */
  isMultiSelection: boolean;
  isDirty: boolean;
  isSaving: boolean;
  hasError: boolean;
  pinned: boolean;
  editing: EditState | null;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  canEdit: boolean;
  onMouseDown: (row: number, col: number, shift: boolean) => void;
  onDoubleClick: (row: number, col: number) => void;
  onEditChange: (value: string) => void;
  onEditKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onEditBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
  registerRef: (row: number, col: number, el: HTMLTableCellElement | null) => void;
}

function GridCell({
  col,
  colIndex,
  rowIndex,
  view,
  isActive,
  isSelected,
  isMultiSelection,
  isDirty,
  isSaving,
  hasError,
  pinned,
  editing,
  editInputRef,
  canEdit,
  onMouseDown,
  onDoubleClick,
  onEditChange,
  onEditKeyDown,
  onEditBlur,
  registerRef,
}: GridCellProps) {
  const editable = col.editable && canEdit;

  // Exactly one solid background in every state — a frozen cell must stay
  // opaque as the grid scrolls under it, so nothing may fall through to
  // transparent.
  const background =
    isDirty && isSelected && !isActive && isMultiSelection
      ? 'bg-amber-100'
      : isDirty
        ? 'bg-amber-50'
        : isSelected && !isActive
          ? 'bg-bronze/10'
          : 'bg-white';

  // z-index ladder, bottom to top: plain cell → active cell → pinned cell →
  // header → pinned header → corner. Pinned body cells sit ABOVE the active
  // ring so the frozen columns stay opaque when a highlighted cell scrolls
  // underneath them.
  const layer = pinned ? 'z-20' : isActive ? 'z-10' : '';

  return (
    <td
      ref={(el) => {
        registerRef(rowIndex, colIndex, el);
      }}
      role="gridcell"
      aria-selected={isSelected}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        // Stop the browser starting a text-selection drag across cells.
        e.preventDefault();
        onMouseDown(rowIndex, colIndex, e.shiftKey);
      }}
      onDoubleClick={() => editable && onDoubleClick(rowIndex, colIndex)}
      className={`relative border-b border-r border-line px-3 py-2 h-9 align-middle ${background} ${layer} ${
        col.numeric ? 'text-right tabular-nums' : 'text-left'
      } ${editable ? 'cursor-cell' : 'cursor-default'} ${
        isActive ? 'ring-2 ring-inset ring-bronze' : ''
      } ${isSaving ? 'opacity-60' : ''} ${
        hasError && isDirty ? 'ring-1 ring-inset ring-red-400' : ''
      }`}
      style={pinned ? { position: 'sticky', left: FROZEN_LEFT[colIndex] } : undefined}
    >
      {isDirty && (
        // Excel-style dirty corner marker.
        <span className="absolute top-0 right-0 w-0 h-0 border-t-[6px] border-l-[6px] border-t-amber-500 border-l-transparent pointer-events-none" />
      )}

      {editing ? (
        <input
          ref={editInputRef}
          type="text"
          // The Notes column is free text: a decimal keypad and right-aligned
          // tabular figures would both be wrong for it.
          inputMode={col.numeric ? 'decimal' : 'text'}
          maxLength={col.numeric ? undefined : NOTE_MAX}
          autoFocus
          value={editing.value}
          onChange={(e) => onEditChange(e.target.value)}
          onKeyDown={onEditKeyDown}
          onBlur={onEditBlur}
          onMouseDown={(e) => e.stopPropagation()}
          onFocus={(e) => {
            if (editing.typed) {
              // The typed character has already replaced the content — put the
              // caret after it rather than selecting it away.
              const end = e.target.value.length;
              e.target.setSelectionRange(end, end);
            } else {
              e.target.select();
            }
          }}
          className={`absolute inset-0 w-full h-full px-3 bg-white text-sm text-ink outline-none ring-2 ring-inset ring-bronze ${
            col.numeric ? 'text-right tabular-nums' : 'text-left'
          }`}
        />
      ) : (
        <CellDisplay col={col} view={view} />
      )}
    </td>
  );
}

/** The read-mode contents of a cell. */
function CellDisplay({ col, view }: { col: ColumnDef; view: RowView }) {
  switch (col.key) {
    case 'sku':
      return (
        <span
          className={`block truncate font-mono text-xs ${
            view.product.sku ? 'text-ink' : 'text-ink-muted'
          }`}
        >
          {view.product.sku ?? '—'}
        </span>
      );
    case 'name':
      return (
        <div className="min-w-0" title={view.product.name}>
          <div className="truncate text-ink">{view.product.name}</div>
          <div className="text-[10px] text-ink-muted leading-tight">
            {view.per} {view.per === 1 ? 'vial' : 'vials'} / case
          </div>
        </div>
      );
    case 'stock_vials':
      return (
        <span
          className={
            view.stock <= 0
              ? 'text-red-600 font-medium'
              : view.stock <= Number(view.product.low_stock_threshold ?? 0)
                ? 'text-amber-600 font-medium'
                : 'text-ink'
          }
        >
          {view.stock.toLocaleString()}
        </span>
      );
    case 'stock_cases':
      return (
        <span className="text-ink">
          {view.cases.toLocaleString()}
          {view.loose > 0 && <span className="ml-1 text-[10px] text-ink-muted">+{view.loose}v</span>}
        </span>
      );
    case 'note':
      return view.note ? (
        <span className="block truncate text-ink" title={view.note}>
          {view.note}
        </span>
      ) : (
        // An empty note leaves the cell blank rather than showing a dash: it
        // still reads as the gutter between the stock and price groups.
        <span className="sr-only">No note</span>
      );
    case 'price_case':
      return <span className="text-ink">{displayValue(view, 'price_case')}</span>;
    case 'price_vial':
      return (
        <span className="text-ink">
          {displayValue(view, 'price_vial')}
          {view.vialOverride == null && (
            <span
              className="ml-1 text-[9px] font-medium text-ink-muted uppercase tracking-wide align-middle"
              title="Derived from the case price — no override stored"
            >
              auto
            </span>
          )}
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// HelpPanel
// ---------------------------------------------------------------------------

const SHORTCUTS: Array<[string, string]> = [
  ['Arrows', 'Move the active cell'],
  ['Shift + arrows', 'Extend the selection'],
  ['Tab / Shift+Tab', 'Next / previous cell (wraps)'],
  ['PageUp / PageDown', 'Jump 10 rows'],
  ['Home / End', 'First / last column (⌘/Ctrl: first / last row)'],
  ['Enter / F2', 'Edit the active cell'],
  ['0-9 . -', 'Replace a number cell and start typing'],
  ['Any key', 'Start typing in the Notes column'],
  ['Esc', 'Collapse the selection (or cancel an edit)'],
  ['Delete', 'Clear a note / reset vial price to auto'],
  ['Ctrl/⌘ + C / V', 'Copy / paste a TSV block'],
  ['Ctrl/⌘ + D', 'Fill the top row down'],
  ['Ctrl/⌘ + Z', 'Undo one staged edit'],
  ['Ctrl/⌘ + A', 'Select every cell'],
  ['Ctrl/⌘ + S', 'Save staged changes'],
  ['Ctrl/⌘ + P', 'Print the table as shown'],
];

function HelpPanel() {
  return (
    <div className="grid gap-6 md:grid-cols-2 px-4 py-4 border-b border-line bg-bronze-50/60 text-xs text-ink-muted">
      <div>
        <h3 className="text-[11px] font-semibold text-ink uppercase tracking-wider mb-2">
          How cases &amp; vials interact
        </h3>
        <ul className="space-y-1.5 list-disc pl-4">
          <li>Stock is stored in vials. The cases column is that number divided by the product&apos;s vials-per-case.</li>
          <li>Typing whole cases keeps any loose vials already on the shelf; a decimal (2.5) sets the whole quantity.</li>
          <li>A case costs exactly the vial price × vials-per-case — there is no pack discount.</li>
          <li>Editing the case price rescales an existing vial override; a row on <em>auto</em> stays auto.</li>
          <li>Editing the vial price rewrites the case price in the same keystroke.</li>
          <li>Clearing a vial price puts the row back on <em>auto</em>, derived from the case price.</li>
          <li>Notes is free text, saved on the product and internal only — never on an invoice or price sheet.</li>
        </ul>
      </div>
      <div>
        <h3 className="text-[11px] font-semibold text-ink uppercase tracking-wider mb-2">Keyboard</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {SHORTCUTS.map(([keys, what]) => (
            <React.Fragment key={keys}>
              <dt className="font-medium text-ink whitespace-nowrap">{keys}</dt>
              <dd>{what}</dd>
            </React.Fragment>
          ))}
        </dl>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RestockDialog
// ---------------------------------------------------------------------------

function RestockDialog({
  prompt,
  saving,
  onCancel,
  onConfirm,
}: {
  prompt: RestockPrompt;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const total = prompt.rows.reduce((sum, r) => sum + r.emails.length, 0);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl max-w-md w-full p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-bronze/10 flex items-center justify-center flex-shrink-0">
            <Bell className="w-4 h-4 text-bronze" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink">Notify waitlists?</h2>
            <p className="text-xs text-ink-muted">
              {prompt.rows.length} product{prompt.rows.length === 1 ? '' : 's'} going back in stock
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="ml-auto text-ink-muted hover:text-ink transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-ink mb-3">
          Saving will email <span className="font-semibold">{total}</span> waitlisted customer
          {total === 1 ? '' : 's'}:
        </p>
        <ul className="max-h-48 overflow-y-auto border border-line rounded-lg divide-y divide-line/50 mb-5">
          {prompt.rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="truncate text-ink">{row.name}</span>
              <span className="text-xs text-ink-muted whitespace-nowrap tabular-nums">
                {row.emails.length} waiting
              </span>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 bg-surface text-ink rounded-lg hover:bg-line/50 px-4 py-2.5 font-medium text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-ink text-white rounded-lg hover:bg-ink/90 px-4 py-2.5 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <span className="h-4 w-4 rounded-full border-b-2 border-white animate-spin" />
            ) : (
              <Bell className="w-4 h-4" />
            )}
            Save &amp; notify
          </button>
        </div>
      </div>
    </div>
  );
}
