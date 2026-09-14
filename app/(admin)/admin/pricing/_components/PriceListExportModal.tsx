'use client';

import React, { useEffect, useState } from 'react';
import { X, FileText, FileSpreadsheet, Loader2, RotateCcw, Columns3, Settings2 } from 'lucide-react';
import {
  ALL_PRICELIST_COLUMNS,
  PRICELIST_COLUMNS,
  orderColumns,
  type PricelistColumnKey,
  type PricelistExportFormat,
} from '@/lib/admin/pricelist-columns';
import {
  defaultPrefs,
  loadPrefs,
  savePrefs,
  type PricelistExportPrefs,
} from './pricelistExportPrefs';

/** The document toggles, i.e. every boolean choice in the saved preferences. */
type BooleanPrefKey = {
  [K in keyof PricelistExportPrefs]: PricelistExportPrefs[K] extends boolean ? K : never;
}[keyof PricelistExportPrefs];

/**
 * Customize menu for a price-list download: which columns the file carries,
 * which document details print, and whether catalog-fallback rows are kept.
 *
 * Columns are chosen per format — the PDF is what a customer sees, the workbook
 * is what you work in — so the grid switches with the format tabs. Choices are
 * saved when a download starts, and the quick PDF / Excel actions on the
 * Download menu reuse them.
 */
export default function PriceListExportModal({
  name,
  busy,
  onDownload,
  onClose,
}: {
  /** Price list being downloaded, named in the modal header. */
  name: string;
  /** Which format is currently downloading, if any. */
  busy: PricelistExportFormat | null;
  onDownload: (format: PricelistExportFormat, prefs: PricelistExportPrefs) => void;
  onClose: () => void;
}) {
  const [prefs, setPrefs] = useState<PricelistExportPrefs>(defaultPrefs);
  const [format, setFormat] = useState<PricelistExportFormat>('pdf');

  // Seed from the saved choices once mounted (localStorage is client-only).
  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  const columns = format === 'xlsx' ? prefs.xlsxColumns : prefs.pdfColumns;
  const selected = new Set<PricelistColumnKey>(columns);

  const setColumns = (next: PricelistColumnKey[]) =>
    setPrefs((p) => (format === 'xlsx' ? { ...p, xlsxColumns: next } : { ...p, pdfColumns: next }));

  const toggleColumn = (key: PricelistColumnKey) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setColumns(orderColumns(next));
  };

  const download = (fmt: PricelistExportFormat) => {
    savePrefs(prefs);
    onDownload(fmt, prefs);
  };

  const DOCUMENT_TOGGLES: { key: BooleanPrefKey; label: string; desc: string }[] = [
    { key: 'showName', label: 'Price list name', desc: 'Print the list name in the header and footer' },
    { key: 'showDescription', label: 'Description', desc: "The list's description, when it has one" },
    { key: 'showMeta', label: 'Details', desc: 'Generated date, product count, currency and status' },
    { key: 'onlyPriced', label: 'Only priced products', desc: 'Leave out rows falling back to the catalog price' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full p-6 sm:p-8 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-ink inline-flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-vital" /> Customize download
            </h2>
            <p className="text-sm text-ink-muted mt-1 truncate">{name}</p>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Format — the column choice below belongs to whichever is selected. */}
        <div className="inline-flex rounded-lg border border-line bg-surface p-1">
          {([
            { value: 'pdf', label: 'PDF', icon: FileText },
            { value: 'xlsx', label: 'Excel', icon: FileSpreadsheet },
          ] as const).map(({ value, label, icon: Icon }) => {
            const active = format === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setFormat(value)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-sm font-medium transition-colors ${
                  active ? 'bg-white text-ink shadow-sm border border-line' : 'text-ink-muted hover:text-ink'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          {format === 'pdf'
            ? 'The branded, ready-to-share document.'
            : 'The working sheet — edited and fed back through the price-list import.'}
        </p>

        {/* Column selection — what the file's table carries. */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted inline-flex items-center gap-1.5">
              <Columns3 className="w-3.5 h-3.5" /> Columns
            </span>
            <div className="flex items-center gap-3 text-xs">
              <button type="button" onClick={() => setColumns([...ALL_PRICELIST_COLUMNS])} className="text-vital hover:underline">
                All
              </button>
              <button type="button" onClick={() => setColumns([])} className="text-ink-muted hover:text-ink hover:underline">
                None
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PRICELIST_COLUMNS.map((col) => (
              <label
                key={col.key}
                className="flex items-start gap-2 p-2.5 rounded-lg border border-line hover:bg-surface cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selected.has(col.key)}
                  onChange={() => toggleColumn(col.key)}
                  className="mt-0.5 w-4 h-4 rounded border-line text-vital focus:ring-vital/40"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">{col.name}</span>
                  <span className="block text-xs text-ink-muted">{col.desc}</span>
                </span>
              </label>
            ))}
          </div>
          {columns.length === 0 && (
            <p className="mt-2 text-xs text-amber-600">
              No columns selected — the download will use the default columns.
            </p>
          )}
          {format === 'pdf' && columns.length >= 7 && (
            <p className="mt-2 text-xs text-ink-muted">
              A selection this wide prints landscape, so the prices stay on one line.
            </p>
          )}
        </div>

        {/* Document details + row filter. */}
        <div className="mt-5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Include</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            {DOCUMENT_TOGGLES.map((t) => (
              <label
                key={t.key}
                className="flex items-start gap-2 p-2.5 rounded-lg border border-line hover:bg-surface cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={prefs[t.key]}
                  onChange={(e) => setPrefs((p) => ({ ...p, [t.key]: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 rounded border-line text-vital focus:ring-vital/40"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">{t.label}</span>
                  <span className="block text-xs text-ink-muted">{t.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-6 mt-6 border-t border-line">
          <button
            type="button"
            onClick={() => setPrefs(defaultPrefs())}
            className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink self-start"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset to defaults
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => download(format)}
              disabled={busy !== null}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-semibold text-sm disabled:opacity-50"
            >
              {busy === format ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : format === 'pdf' ? (
                <FileText className="w-4 h-4" />
              ) : (
                <FileSpreadsheet className="w-4 h-4" />
              )}
              {busy === format ? 'Generating…' : `Download ${format === 'pdf' ? 'PDF' : 'Excel'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
