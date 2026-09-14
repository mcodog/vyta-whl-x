'use client';

import React, { useState } from 'react';
import { X, Upload, Download, FileText, Loader2, Check, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import MultiSelectCustomer from '@/components/admin/MultiSelectCustomer';

interface CustomerLite {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface PreviewRow {
  row: number;
  name: string;
  sku: string;
  product_id: string | null;
  price: number | null;
  error: string | null;
}

interface PreviewResp {
  preview: PreviewRow[];
  summary: { total: number; valid: number; errors: number };
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

export default function PriceListImportModal({
  customers,
  isAffiliate = false,
  onClose,
  onApplied,
}: {
  customers: CustomerLite[];
  // Clients (affiliates) always apply their price list to ALL their customers,
  // so the per-customer picker is hidden for them.
  isAffiliate?: boolean;
  onClose: () => void;
  onApplied: (msg: string) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [busy, setBusy] = useState<null | 'template' | 'validate' | 'apply'>(null);
  const [error, setError] = useState('');

  const downloadTemplate = async () => {
    setBusy('template');
    setError('');
    try {
      const res = await fetch('/api/admin/price-overrides/import', { headers: await authHeaders() });
      if (!res.ok) throw new Error('Could not load products for the template');
      const { products } = await res.json();
      const header = ['product_id', 'sku', 'name', 'current_price', 'your_price'];
      const lines = [header.join(',')].concat(
        (products ?? []).map((p: any) =>
          [p.product_id, p.sku, p.name, p.current_price, ''].map(csvCell).join(','),
        ),
      );
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'aminocan-price-list-template.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || 'Template download failed');
    } finally {
      setBusy(null);
    }
  };

  const send = async (mode: 'preview' | 'apply') => {
    if (!file) {
      setError('Choose a CSV file first');
      return;
    }
    setBusy(mode === 'preview' ? 'validate' : 'apply');
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', mode);
      fd.append('customer_ids', JSON.stringify(selectedIds));
      const res = await fetch('/api/admin/price-overrides/import', {
        method: 'POST',
        headers: await authHeaders(),
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      if (mode === 'preview') {
        setPreview(data);
      } else if (isAffiliate) {
        onApplied(
          `Applied ${data.products} price${data.products === 1 ? '' : 's'} to all your customers` +
            ` (${data.customers} now, and any you add later).`,
        );
      } else {
        onApplied(`Applied ${data.products} price${data.products === 1 ? '' : 's'} to ${data.customers} customer${data.customers === 1 ? '' : 's'}.`);
      }
    } catch (e: any) {
      setError(e.message || 'Upload failed');
    } finally {
      setBusy(null);
    }
  };

  const canApply =
    !!preview &&
    preview.summary.valid > 0 &&
    (isAffiliate || selectedIds.length > 0) &&
    busy === null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-line">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-bronze" />
            <h2 className="text-lg font-bold text-ink">Import price list (CSV)</h2>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Step 1: customers (clients always apply to all of theirs) */}
          {isAffiliate ? (
            <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
              <Check className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                These prices will apply to <span className="font-semibold">all your customers</span> —
                the {customers.length} you have now and any you add later.
              </span>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                1. Apply prices to which customers?
              </label>
              <MultiSelectCustomer
                customers={customers as any}
                selectedIds={selectedIds}
                onChange={setSelectedIds}
                placeholder="Search your customers..."
              />
            </div>
          )}

          {/* Step 2: template + file */}
          <div>
            <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
              {isAffiliate ? 'Upload your prices' : '2. Upload your prices'}
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={downloadTemplate}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink hover:border-ink/30 disabled:opacity-60"
              >
                {busy === 'template' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Download template
              </button>
              <label className="inline-flex items-center gap-2 px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink hover:border-ink/30 cursor-pointer">
                <FileText className="w-4 h-4" />
                {file ? file.name : 'Choose CSV…'}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setPreview(null);
                  }}
                />
              </label>
              <button
                onClick={() => send('preview')}
                disabled={!file || busy !== null}
                className="inline-flex items-center gap-2 px-3 py-2 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 disabled:opacity-60"
              >
                {busy === 'validate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Validate
              </button>
            </div>
            <p className="text-xs text-ink-muted mt-2">
              The template is built from the current catalogue (product_id, sku, name). Fill the
              <span className="font-medium text-ink"> your_price </span> column and upload it back.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div>
              <div className="flex items-center gap-3 mb-2 text-sm">
                <span className="font-semibold text-ink">{preview.summary.valid} valid</span>
                {preview.summary.errors > 0 && (
                  <span className="text-red-600 font-medium">{preview.summary.errors} with issues</span>
                )}
                <span className="text-ink-muted">of {preview.summary.total} rows</span>
              </div>
              <div className="border border-line rounded-lg max-h-64 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-line">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-ink-muted">Row</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-ink-muted">Product</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-ink-muted">Price</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-ink-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/50">
                    {preview.preview.map((r) => (
                      <tr key={r.row} className={r.error ? 'bg-red-50/50' : ''}>
                        <td className="px-3 py-2 text-ink-muted tabular-nums">{r.row}</td>
                        <td className="px-3 py-2 text-ink">
                          {r.name}
                          {r.sku && <span className="text-ink-muted"> · {r.sku}</span>}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-ink">{r.price != null ? `$${r.price.toFixed(2)}` : '—'}</td>
                        <td className="px-3 py-2">
                          {r.error ? (
                            <span className="text-red-600 text-xs">{r.error}</span>
                          ) : (
                            <span className="text-emerald-600 text-xs inline-flex items-center gap-1">
                              <Check className="w-3 h-3" /> OK
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-5 border-t border-line">
          <span className="text-xs text-ink-muted">
            {isAffiliate
              ? `Applies to all ${customers.length} of your customers`
              : `${selectedIds.length} customer${selectedIds.length === 1 ? '' : 's'} selected`}
          </span>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 text-sm font-medium">
              Cancel
            </button>
            <button
              onClick={() => send('apply')}
              disabled={!canApply}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-bronze text-white rounded-lg hover:bg-bronze/90 text-sm font-medium disabled:opacity-50"
            >
              {busy === 'apply' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Apply prices
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
