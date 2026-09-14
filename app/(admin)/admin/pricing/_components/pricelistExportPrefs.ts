/**
 * The admin's saved price-list download choices — what the Customize menu edits
 * and what the quick PDF / Excel actions send.
 *
 * Columns are stored per format, because the two files answer different needs:
 * the PDF is what a customer sees, the workbook is what you work in. Everything
 * else (which document details print, whether catalog-fallback rows are kept)
 * is shared. Choices persist in localStorage, mirroring the Products Report.
 */

import {
  defaultExportOptions,
  resolveColumns,
  type PricelistColumnKey,
  type PricelistExportFormat,
  type PricelistExportOptions,
} from '@/lib/admin/pricelist-columns';

/** localStorage key persisting the admin's price-list download choices. */
export const PRICELIST_EXPORT_PREFS_KEY = 'aminocan.pricelistExport.config';

export interface PricelistExportPrefs {
  pdfColumns: PricelistColumnKey[];
  xlsxColumns: PricelistColumnKey[];
  showName: boolean;
  showDescription: boolean;
  showMeta: boolean;
  onlyPriced: boolean;
}

/** The out-of-the-box choices: each format's default columns, all details on. */
export function defaultPrefs(): PricelistExportPrefs {
  const pdf = defaultExportOptions('pdf');
  const xlsx = defaultExportOptions('xlsx');
  return {
    pdfColumns: pdf.columns,
    xlsxColumns: xlsx.columns,
    showName: pdf.showName,
    showDescription: pdf.showDescription,
    showMeta: pdf.showMeta,
    onlyPriced: pdf.onlyPriced,
  };
}

/** Read the saved choices, falling back to the defaults on anything unusable. */
export function loadPrefs(): PricelistExportPrefs {
  const base = defaultPrefs();
  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(PRICELIST_EXPORT_PREFS_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<PricelistExportPrefs>;
    return {
      // resolveColumns drops keys retired since the choice was saved.
      pdfColumns: Array.isArray(saved.pdfColumns)
        ? resolveColumns(saved.pdfColumns, 'pdf')
        : base.pdfColumns,
      xlsxColumns: Array.isArray(saved.xlsxColumns)
        ? resolveColumns(saved.xlsxColumns, 'xlsx')
        : base.xlsxColumns,
      showName: saved.showName ?? base.showName,
      showDescription: saved.showDescription ?? base.showDescription,
      showMeta: saved.showMeta ?? base.showMeta,
      onlyPriced: saved.onlyPriced ?? base.onlyPriced,
    };
  } catch {
    return base;
  }
}

/** Persist the choices; a full localStorage is not worth failing a download. */
export function savePrefs(prefs: PricelistExportPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRICELIST_EXPORT_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/** The saved choices as the options for one format. */
export function optionsFor(
  prefs: PricelistExportPrefs,
  format: PricelistExportFormat,
): PricelistExportOptions {
  return {
    columns: format === 'xlsx' ? prefs.xlsxColumns : prefs.pdfColumns,
    showName: prefs.showName,
    showDescription: prefs.showDescription,
    showMeta: prefs.showMeta,
    onlyPriced: prefs.onlyPriced,
  };
}

/** Query string for the export route — the flags it reads, and nothing else. */
export function exportQuery(
  prefs: PricelistExportPrefs,
  format: PricelistExportFormat,
): string {
  const options = optionsFor(prefs, format);
  return new URLSearchParams({
    format,
    cols: options.columns.join(','),
    name: options.showName ? '1' : '0',
    desc: options.showDescription ? '1' : '0',
    meta: options.showMeta ? '1' : '0',
    only_priced: options.onlyPriced ? '1' : '0',
  }).toString();
}
