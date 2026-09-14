'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Building2, Search, Save, Loader2, AlertCircle, CheckCircle2,
  Download, Upload, Tags, Info,
} from 'lucide-react';
import { getAllSuppliers } from '@/lib/admin/purchase-orders';
import { getSupplierPrices, saveSupplierPrices } from '@/lib/admin/supplier-prices';
import type { Supplier, SupplierPriceRow } from '@/lib/supabase';
import Tooltip, { InfoHint } from '@/components/Tooltip';

const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

// ---- minimal CSV helpers --------------------------------------------------
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); if (row.some((v) => v.trim() !== '')) rows.push(row); }
  return rows;
}

const csvCell = (v: string | number) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function SupplierPricelistsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  // Seed the selected supplier + product search from the URL so the view
  // survives refresh/Back and can be bookmarked; written back on change.
  const [supplierId, setSupplierId] = useState<string>(() => searchParams.get('supplier') ?? '');
  const [rows, setRows] = useState<SupplierPriceRow[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');

  useEffect(() => {
    const params = new URLSearchParams();
    if (supplierId) params.set('supplier', supplierId);
    if (search) params.set('q', search);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [supplierId, search, pathname, router]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // load suppliers once
  useEffect(() => {
    getAllSuppliers().then((s) => {
      setSuppliers(s);
      setSupplierId((prev) => prev || s[0]?.id || '');
      setLoading(false);
    });
  }, []);

  // load the selected supplier's prices
  const loadPrices = useCallback(async (id: string) => {
    if (!id) return;
    setLoadingPrices(true);
    setError(null);
    setNotice(null);
    try {
      const data = await getSupplierPrices(id);
      const initial: Record<string, string> = {};
      for (const r of data) {
        initial[r.product_id] = String(r.supplier_price ?? r.original_price ?? 0);
      }
      setRows(data);
      setValues(initial);
      setBaseline(initial);
    } catch (e: any) {
      setError(e.message ?? 'Could not load prices');
      setRows([]);
    } finally {
      setLoadingPrices(false);
    }
  }, []);

  useEffect(() => { if (supplierId) loadPrices(supplierId); }, [supplierId, loadPrices]);

  const supplier = suppliers.find((s) => s.id === supplierId) ?? null;

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.sku ?? '').toLowerCase().includes(q) ||
        (r.strength ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const dirtyIds = useMemo(
    () => Object.keys(values).filter((id) => values[id] !== baseline[id]),
    [values, baseline],
  );

  const setValue = (productId: string, v: string) =>
    setValues((prev) => ({ ...prev, [productId]: v }));

  // arrow-key / enter navigation between the editable price cells
  const onCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      inputRefs.current[index + 1]?.focus();
      inputRefs.current[index + 1]?.select();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      inputRefs.current[index - 1]?.focus();
      inputRefs.current[index - 1]?.select();
    }
  };

  const save = async () => {
    if (dirtyIds.length === 0) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const items = dirtyIds.map((id) => ({ product_id: id, price: Number(values[id]) || 0 }));
      await saveSupplierPrices(supplierId, items);
      setBaseline({ ...values });
      // keep rows' supplier_price in sync so re-renders reflect saved state
      setRows((prev) =>
        prev.map((r) =>
          dirtyIds.includes(r.product_id)
            ? { ...r, supplier_price: Number(values[r.product_id]) || 0 }
            : r,
        ),
      );
      setNotice(`Saved ${items.length} price${items.length === 1 ? '' : 's'}.`);
    } catch (e: any) {
      setError(e.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ---- CSV ----------------------------------------------------------------
  const downloadTemplate = () => {
    const header = ['sku', 'product_name', 'original_price', 'supplier_price'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          csvCell(r.sku ?? ''),
          csvCell(r.name),
          csvCell(r.original_price.toFixed(2)),
          csvCell(values[r.product_id] ?? (r.supplier_price ?? r.original_price)),
        ].join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(supplier?.name ?? 'supplier').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-pricelist.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onUploadFile = async (file: File) => {
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      const grid = parseCSV(text);
      if (grid.length < 2) { setError('CSV looks empty.'); return; }
      const header = grid[0].map((h) => h.trim().toLowerCase());
      const skuIdx = header.indexOf('sku');
      const priceIdx = header.indexOf('supplier_price');
      if (skuIdx === -1 || priceIdx === -1) {
        setError('CSV must include "sku" and "supplier_price" columns. Download the template for the exact format.');
        return;
      }
      // map sku -> product_id from the loaded rows
      const bySku = new Map<string, string>();
      for (const r of rows) if (r.sku) bySku.set(r.sku.trim().toLowerCase(), r.product_id);

      const next = { ...values };
      let matched = 0;
      const unknown: string[] = [];
      let invalid = 0;
      for (let i = 1; i < grid.length; i++) {
        const sku = (grid[i][skuIdx] ?? '').trim();
        const rawPrice = (grid[i][priceIdx] ?? '').trim();
        if (!sku) continue;
        const pid = bySku.get(sku.toLowerCase());
        if (!pid) { unknown.push(sku); continue; }
        const price = Number(rawPrice.replace(/[$,]/g, ''));
        if (!Number.isFinite(price) || price < 0) { invalid++; continue; }
        next[pid] = String(price);
        matched++;
      }
      setValues(next);

      // persist matched rows immediately
      if (matched > 0) {
        setSaving(true);
        const items = Object.keys(next)
          .filter((id) => next[id] !== baseline[id])
          .map((id) => ({ product_id: id, price: Number(next[id]) || 0 }));
        await saveSupplierPrices(supplierId, items);
        setBaseline({ ...next });
        setRows((prev) =>
          prev.map((r) => ({ ...r, supplier_price: Number(next[r.product_id]) || 0 })),
        );
        setSaving(false);
      }

      const parts = [`${matched} price${matched === 1 ? '' : 's'} updated`];
      if (unknown.length) parts.push(`${unknown.length} unknown SKU${unknown.length === 1 ? '' : 's'} skipped`);
      if (invalid) parts.push(`${invalid} invalid value${invalid === 1 ? '' : 's'} skipped`);
      setNotice(parts.join(' · '));
      if (unknown.length) setError(`Unknown SKUs (skipped): ${unknown.slice(0, 8).join(', ')}${unknown.length > 8 ? '…' : ''}`);
    } catch (e: any) {
      setError(e.message ?? 'Could not read CSV');
      setSaving(false);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/purchase-orders"
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-line text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2">
              <Tags className="w-6 h-6 text-bronze" /> Supplier Pricelists
              <InfoHint
                side="bottom"
                content="Set what each supplier charges you per product. These prices auto-fill purchase order line items and power the cheaper-supplier alert on the PO page. Blank/untouched products use the product's default price."
              />
            </h1>
            <p className="text-sm text-ink-muted">Per-supplier product prices</p>
          </div>
        </div>
        <Link
          href="/admin/purchase-orders/suppliers"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-line text-ink-muted hover:text-ink hover:border-ink/20 rounded-lg text-sm transition-colors"
        >
          <Building2 className="w-4 h-4" /> Manage Suppliers
        </Link>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-line p-12 text-center text-sm text-ink-muted">Loading…</div>
      ) : suppliers.length === 0 ? (
        <div className="bg-white rounded-xl border border-line p-12 text-center">
          <p className="text-sm text-ink-muted mb-3">No suppliers yet — add one first.</p>
          <Link href="/admin/purchase-orders/suppliers" className="text-bronze text-sm">Go to Suppliers</Link>
        </div>
      ) : (
        <>
          {/* Controls */}
          <div className="bg-white rounded-xl border border-line p-4 mb-4">
            <div className="flex flex-col lg:flex-row lg:items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">
                  Supplier
                </label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="w-full pl-10 pr-8 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 appearance-none"
                  >
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex-1">
                <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">
                  Search products
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Name, SKU or strength…"
                    className="w-full pl-10 pr-4 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Tooltip content="Download a CSV with every product's SKU and current supplier price. Edit the supplier_price column, then upload it back.">
                  <button
                    onClick={downloadTemplate}
                    className="inline-flex items-center gap-2 px-3 py-2.5 bg-white border border-line text-ink-muted hover:text-ink hover:border-ink/20 rounded-lg text-sm transition-colors"
                  >
                    <Download className="w-4 h-4" /> Template
                  </button>
                </Tooltip>
                <Tooltip content="Upload a filled CSV. Rows are matched to products by SKU; matched prices save automatically. Unknown SKUs are skipped and reported.">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-2 px-3 py-2.5 bg-white border border-line text-ink-muted hover:text-ink hover:border-ink/20 rounded-lg text-sm transition-colors"
                  >
                    <Upload className="w-4 h-4" /> Upload CSV
                  </button>
                </Tooltip>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadFile(f);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
              <Info className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Tip: click a Supplier price cell and use <kbd className="px-1 rounded bg-surface border border-line">↑</kbd> <kbd className="px-1 rounded bg-surface border border-line">↓</kbd> (or <kbd className="px-1 rounded bg-surface border border-line">Enter</kbd>) to move between products.</span>
            </div>
          </div>

          {(error || notice) && (
            <div className="mb-4 space-y-2">
              {notice && (
                <div className="flex items-start gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> {notice}
                </div>
              )}
              {error && (
                <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
                </div>
              )}
            </div>
          )}

          {/* Table (desktop ≥lg) / cards (mobile) — ADR 0007. */}
          <div className="bg-white rounded-xl border border-line overflow-hidden">
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-ink-muted uppercase tracking-wider bg-surface/50">
                    <th className="text-left px-5 py-3">Product</th>
                    <th className="text-left px-5 py-3">SKU</th>
                    <th className="text-right px-5 py-3">
                      <span className="inline-flex items-center gap-1">
                        Original price
                        <InfoHint content="The product's default price (products table). Shown for reference — it does not change here." />
                      </span>
                    </th>
                    <th className="text-right px-5 py-3">
                      <span className="inline-flex items-center justify-end gap-1">
                        Supplier price
                        <InfoHint content="What this supplier charges you. Edits highlight until saved." />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/50">
                  {loadingPrices ? (
                    <tr><td colSpan={4} className="px-5 py-12 text-center text-ink-muted">
                      <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading prices…
                    </td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={4} className="px-5 py-12 text-center text-ink-muted">
                      {rows.length === 0 ? 'No active products.' : 'No products match your search.'}
                    </td></tr>
                  ) : (
                    filtered.map((r, index) => {
                      const val = values[r.product_id] ?? '';
                      const dirty = val !== baseline[r.product_id];
                      const num = Number(val) || 0;
                      const cheaper = num < r.original_price;
                      return (
                        <tr key={r.product_id} className="hover:bg-surface/40 transition-colors">
                          <td className="px-5 py-2.5 text-ink">
                            <div className="font-medium">{r.name}</div>
                            {r.strength && <div className="text-xs text-ink-muted">{r.strength}</div>}
                          </td>
                          <td className="px-5 py-2.5 text-ink-muted font-mono text-xs">{r.sku ?? '—'}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums text-ink-muted">{money(r.original_price)}</td>
                          <td className="px-5 py-2.5 text-right">
                            <div className="inline-flex items-center gap-2 justify-end">
                              {dirty && (
                                <Tooltip content="Unsaved change">
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                                </Tooltip>
                              )}
                              <div className="relative">
                                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted text-xs">$</span>
                                <input
                                  ref={(el) => { inputRefs.current[index] = el; }}
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={val}
                                  onChange={(e) => setValue(r.product_id, e.target.value)}
                                  onKeyDown={(e) => onCellKeyDown(e, index)}
                                  className={`w-28 text-right pl-5 pr-2 py-1.5 rounded-lg border text-sm tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-bronze/40 ${
                                    dirty ? 'border-amber-400 bg-amber-50/40' : 'border-line'
                                  } ${cheaper ? 'text-emerald-600' : 'text-ink'}`}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile cards (below lg). Inputs omit the desktop cell-nav ref so
                the shared ref array isn't clobbered; 16px avoids iOS zoom. */}
            <ul className="lg:hidden divide-y divide-line/50">
              {loadingPrices ? (
                <li className="px-5 py-12 text-center text-ink-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading prices…</li>
              ) : filtered.length === 0 ? (
                <li className="px-5 py-12 text-center text-ink-muted">{rows.length === 0 ? 'No active products.' : 'No products match your search.'}</li>
              ) : filtered.map((r) => {
                const val = values[r.product_id] ?? '';
                const dirty = val !== baseline[r.product_id];
                const num = Number(val) || 0;
                const cheaper = num < r.original_price;
                return (
                  <li key={r.product_id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink">{r.name}</div>
                        {r.strength && <div className="text-xs text-ink-muted">{r.strength}</div>}
                        <div className="text-[11px] text-ink-muted font-mono mt-0.5">{r.sku ?? '—'} · orig {money(r.original_price)}</div>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5 justify-end">
                        {dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" title="Unsaved change" />}
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted text-xs">$</span>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={val}
                            onChange={(e) => setValue(r.product_id, e.target.value)}
                            className={`w-28 text-right pl-5 pr-2 py-2 rounded-lg border text-base tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-bronze/40 ${
                              dirty ? 'border-amber-400 bg-amber-50/40' : 'border-line'
                            } ${cheaper ? 'text-emerald-600' : 'text-ink'}`}
                          />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Sticky save bar */}
          <div className="sticky bottom-4 mt-4 flex justify-end">
            <div className="inline-flex items-center gap-3 bg-white border border-line rounded-xl shadow-lg px-4 py-3">
              <span className="text-sm text-ink-muted">
                {dirtyIds.length > 0
                  ? `${dirtyIds.length} unsaved change${dirtyIds.length === 1 ? '' : 's'}`
                  : 'All changes saved'}
              </span>
              <button
                onClick={save}
                disabled={saving || dirtyIds.length === 0}
                className="inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Save className="w-4 h-4" /> Save changes</>}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function SupplierPricelistsPageWrapper() {
  // SupplierPricelistsPage reads the URL via useSearchParams, which Next
  // requires to sit inside a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <SupplierPricelistsPage />
    </Suspense>
  );
}
