'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Save, Search, ChevronLeft, ChevronRight,
  TrendingUp, TrendingDown, Minus, CircleDot, Circle, Pencil, Check, RotateCcw,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useToast } from '@/contexts/ToastContext';
import PriceListDownloadButton from '../../_components/PriceListDownloadButton';

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

interface Product { id: string; name: string; slug: string; strength: string | null; price: number; }
interface Item { product_id: string; price: number; }
interface PriceList {
  id: string; name: string; description: string | null; is_active: boolean;
  created_at: string; updated_at: string;
}

const PAGE_SIZE = 25;

export default function PriceListDetailPage() {
  const params = useParams();
  const listId = String(params.id);
  const { canEdit } = usePermissions();
  const toast = useToast();

  const [list, setList] = useState<PriceList | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [original, setOriginal] = useState<Record<string, string>>({}); // product_id -> list price (as string)
  const [edits, setEdits] = useState<Record<string, string>>({});       // product_id -> edited string
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  // Inline details editor (name + description).
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailName, setDetailName] = useState('');
  const [detailDesc, setDetailDesc] = useState('');

  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/pricelists/${listId}`, { headers: await authHeaders() });
      if (!res.ok) throw new Error('Failed to load price list');
      const { pricelist } = await res.json();
      setList(pricelist);
      setDetailName(pricelist.name);
      setDetailDesc(pricelist.description || '');

      const items: Item[] = (pricelist.items || []).map((i: any) => ({
        product_id: i.product_id,
        price: Number(i.price),
      }));
      const orig: Record<string, string> = {};
      for (const it of items) orig[it.product_id] = it.price.toFixed(2);
      setOriginal(orig);
      setEdits(orig);

      const { data: productsData } = await supabase
        .from('products')
        .select('id, name, slug, strength, price')
        .eq('active', true)
        .order('name');
      setProducts(productsData || []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load price list');
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.slug ?? '').toLowerCase().includes(q),
    );
  }, [products, search]);

  useEffect(() => { setPage(0); }, [search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Dirty rows: edited value differs from original and is a valid number.
  const dirty = useMemo(() => {
    const changed: Array<{ product_id: string; price: number }> = [];
    for (const p of products) {
      const val = edits[p.id];
      if (val === undefined || val === '') continue;
      const num = parseFloat(val);
      if (isNaN(num) || num < 0) continue;
      if ((original[p.id] ?? '') !== num.toFixed(2)) {
        changed.push({ product_id: p.id, price: num });
      }
    }
    return changed;
  }, [edits, original, products]);

  const dirtyCount = dirty.length;

  const setCell = (productId: string, value: string) => {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return;
    setEdits((prev) => ({ ...prev, [productId]: value }));
  };

  const blurFormat = (productId: string) => {
    setEdits((prev) => {
      const v = prev[productId];
      if (v === undefined || v === '') return prev;
      const num = parseFloat(v);
      if (isNaN(num)) return prev;
      return { ...prev, [productId]: Math.max(0, num).toFixed(2) };
    });
  };

  const onCellKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      inputRefs.current[idx + 1]?.focus();
      inputRefs.current[idx + 1]?.select();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      inputRefs.current[idx - 1]?.focus();
      inputRefs.current[idx - 1]?.select();
    }
  };

  const handleSave = async () => {
    if (dirtyCount === 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/pricelists/${listId}`, {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ items: dirty }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: '' }));
        throw new Error(msg || 'Failed to save changes');
      }
      // Commit the saved values into the baseline.
      const savedCount = dirtyCount;
      setOriginal((prev) => {
        const next = { ...prev };
        for (const d of dirty) next[d.product_id] = d.price.toFixed(2);
        return next;
      });
      toast.success(`Saved ${savedCount} price${savedCount !== 1 ? 's' : ''}`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save changes');
    }
    setSaving(false);
  };

  const handleReset = () => {
    setEdits(original);
  };

  const toggleActive = async () => {
    if (!list) return;
    try {
      const res = await fetch(`/api/admin/pricelists/${listId}`, {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ is_active: !list.is_active }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      const { pricelist } = await res.json();
      setList((prev) => (prev ? { ...prev, is_active: pricelist.is_active } : prev));
      toast.success(pricelist.is_active ? 'Price list is now active' : 'Price list deactivated');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update status');
    }
  };

  const saveDetails = async () => {
    if (!detailName.trim()) { toast.error('Name cannot be empty'); return; }
    try {
      const res = await fetch(`/api/admin/pricelists/${listId}`, {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: detailName.trim(), description: detailDesc.trim() }),
      });
      if (!res.ok) throw new Error('Failed to save details');
      const { pricelist } = await res.json();
      setList((prev) => (prev ? { ...prev, name: pricelist.name, description: pricelist.description } : prev));
      setEditingDetails(false);
      toast.success('Details updated');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save details');
    }
  };

  const pctDiff = (listPrice: number, defaultPrice: number) =>
    defaultPrice > 0 ? ((listPrice - defaultPrice) / defaultPrice) * 100 : 0;

  return (
    <>
      <Link href="/admin/pricing" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Price Lists
      </Link>

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
        <div className="min-w-0 flex-1">
          {editingDetails ? (
            <div className="space-y-2 max-w-xl">
              <input
                type="text"
                value={detailName}
                onChange={(e) => setDetailName(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-lg font-bold text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
              />
              <textarea
                value={detailDesc}
                onChange={(e) => setDetailDesc(e.target.value)}
                rows={2}
                placeholder="Description (optional)"
                className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 resize-none"
              />
              <div className="flex gap-2">
                <button onClick={saveDetails} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink text-white rounded-lg text-xs font-medium hover:bg-ink/90">
                  <Check className="w-3.5 h-3.5" /> Save
                </button>
                <button onClick={() => { setEditingDetails(false); setDetailName(list?.name || ''); setDetailDesc(list?.description || ''); }} className="px-3 py-1.5 bg-surface border border-line rounded-lg text-xs font-medium text-ink-muted hover:text-ink">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold text-ink">{list?.name || 'Price List'}</h1>
                {list && (
                  list.is_active ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600">
                      <CircleDot className="w-3 h-3" /> Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-surface text-ink-muted border border-line">
                      <Circle className="w-3 h-3" /> Inactive
                    </span>
                  )
                )}
                {canEdit && list && (
                  <button onClick={() => setEditingDetails(true)} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink" title="Edit details">
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                )}
              </div>
              <p className="text-ink-muted text-sm mt-1">
                {list?.description || 'No description'}
                {' · '}
                {products.length} product{products.length !== 1 ? 's' : ''}
              </p>
            </>
          )}
        </div>

        {list && !editingDetails && (
          <div className="flex items-center gap-2 self-start">
            <PriceListDownloadButton pricelistId={listId} name={list.name} />
            {canEdit && (
              <button
                onClick={toggleActive}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  list.is_active
                    ? 'bg-surface border-line text-ink-muted hover:text-ink'
                    : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/20'
                }`}
              >
                {list.is_active ? 'Deactivate list' : 'Make active list'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40"
          />
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              disabled={dirtyCount === 0 || saving}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-surface border border-line rounded-lg text-sm font-medium text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-4 h-4" /> Reset
            </button>
            <button
              onClick={handleSave}
              disabled={dirtyCount === 0 || saving}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount !== 1 ? 's' : ''}` : 'Save'}
            </button>
          </div>
        )}
      </div>

      {/* Hint */}
      {canEdit && (
        <div className="mb-3 text-xs text-ink-muted">
          Edit the <span className="font-semibold text-ink">List Price</span> column like a spreadsheet — use{' '}
          <span className="font-semibold">↑ / ↓</span> or <span className="font-semibold">Enter</span> to move between rows. Only the list price is editable.
        </div>
      )}

      {/* Grid (desktop table ≥lg / mobile cards) — ADR 0007. */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead>
              <tr className="border-b border-line bg-surface">
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Product</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Default Price</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider w-52">List Price</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                <tr><td colSpan={4} className="px-5 py-12 text-center text-ink-muted text-sm">Loading…</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-12 text-center text-ink-muted text-sm">No products found</td></tr>
              ) : (
                pageRows.map((p, idx) => {
                  const val = edits[p.id] ?? '';
                  const num = parseFloat(val);
                  const hasVal = val !== '' && !isNaN(num);
                  const effective = hasVal ? num : p.price;
                  const diff = pctDiff(effective, p.price);
                  const isDirty = hasVal && (original[p.id] ?? '') !== num.toFixed(2);
                  return (
                    <tr key={p.id} className={`transition-colors ${isDirty ? 'bg-vital/5' : 'hover:bg-surface'}`}>
                      <td className="px-5 py-2.5">
                        <div className="text-sm font-medium text-ink">{p.name}</div>
                        <div className="text-xs text-ink-muted font-mono">{p.slug}</div>
                      </td>
                      <td className="px-5 py-2.5 text-sm text-ink-muted tabular-nums">${p.price.toFixed(2)}</td>
                      <td className="px-5 py-2.5">
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm pointer-events-none">$</span>
                          <input
                            ref={(el) => { inputRefs.current[idx] = el; }}
                            type="text"
                            inputMode="decimal"
                            value={val}
                            disabled={!canEdit}
                            onChange={(e) => setCell(p.id, e.target.value)}
                            onBlur={() => blurFormat(p.id)}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => onCellKeyDown(e, idx)}
                            placeholder={p.price.toFixed(2)}
                            className={`w-full pl-7 pr-3 py-2 rounded-lg border text-sm text-ink tabular-nums font-semibold text-right focus:outline-none focus:ring-2 focus:ring-vital/40 focus:z-10 disabled:bg-surface disabled:cursor-not-allowed ${
                              isDirty ? 'border-vital bg-vital/5' : 'border-line bg-white'
                            }`}
                          />
                        </div>
                      </td>
                      <td className="px-5 py-2.5">
                        <span className={`inline-flex items-center gap-1 text-sm font-medium tabular-nums ${
                          diff > 0 ? 'text-red-600' : diff < 0 ? 'text-emerald-600' : 'text-ink-muted'
                        }`}>
                          {diff > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : diff < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                          {diff !== 0 ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%` : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards (below lg). Inputs omit the desktop cell-nav ref/keydown
            so the shared ref array isn't clobbered; 16px font avoids iOS zoom. */}
        <div className="lg:hidden">
          {loading ? (
            <div className="px-5 py-12 text-center text-ink-muted text-sm">Loading…</div>
          ) : pageRows.length === 0 ? (
            <div className="px-5 py-12 text-center text-ink-muted text-sm">No products found</div>
          ) : (
            <ul className="divide-y divide-line/50">
              {pageRows.map((p) => {
                const val = edits[p.id] ?? '';
                const num = parseFloat(val);
                const hasVal = val !== '' && !isNaN(num);
                const effective = hasVal ? num : p.price;
                const diff = pctDiff(effective, p.price);
                const isDirty = hasVal && (original[p.id] ?? '') !== num.toFixed(2);
                return (
                  <li key={p.id} className={`px-4 py-3 ${isDirty ? 'bg-vital/5' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink">{p.name}</div>
                        <div className="text-xs text-ink-muted font-mono break-all">{p.slug}</div>
                        <div className="text-xs text-ink-muted mt-0.5">Default <span className="tabular-nums">${p.price.toFixed(2)}</span></div>
                      </div>
                      <div className="w-28 shrink-0">
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-sm pointer-events-none">$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={val}
                            disabled={!canEdit}
                            onChange={(e) => setCell(p.id, e.target.value)}
                            onBlur={() => blurFormat(p.id)}
                            onFocus={(e) => e.target.select()}
                            placeholder={p.price.toFixed(2)}
                            className={`w-full pl-7 pr-3 py-2 rounded-lg border text-base text-ink tabular-nums font-semibold text-right focus:outline-none focus:ring-2 focus:ring-vital/40 disabled:bg-surface disabled:cursor-not-allowed ${
                              isDirty ? 'border-vital bg-vital/5' : 'border-line bg-white'
                            }`}
                          />
                        </div>
                        <div className={`mt-1 text-right text-xs font-medium tabular-nums ${diff > 0 ? 'text-red-600' : diff < 0 ? 'text-emerald-600' : 'text-ink-muted'}`}>
                          {diff !== 0 ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%` : '—'}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Pagination */}
        {!loading && filtered.length > PAGE_SIZE && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 border-t border-line">
            <span className="text-sm text-ink-muted">
              Showing <span className="font-medium text-ink tabular-nums">{safePage * PAGE_SIZE + 1}</span>–
              <span className="font-medium text-ink tabular-nums">{Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)}</span> of{' '}
              <span className="font-medium text-ink tabular-nums">{filtered.length}</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">Page {safePage + 1} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <button
                onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
                disabled={safePage + 1 >= totalPages}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sticky save bar when there are unsaved edits off-screen */}
      {canEdit && dirtyCount > 0 && (
        <div className="sticky bottom-4 mt-4 flex justify-center">
          <div className="inline-flex items-center gap-3 px-4 py-2.5 bg-ink text-white rounded-full shadow-lg">
            <span className="text-sm font-medium">{dirtyCount} unsaved change{dirtyCount !== 1 ? 's' : ''}</span>
            <button onClick={handleReset} className="text-xs text-white/70 hover:text-white">Reset</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-ink rounded-full text-xs font-semibold hover:bg-white/90 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
