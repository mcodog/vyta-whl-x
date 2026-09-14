'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Tag, Plus, Check, Loader2, Trash2, Pencil, X, AlertCircle, Save, Search, Star,
} from 'lucide-react';
import type { Pricelist } from '@/lib/supabase';
import {
  getPricelists, getPricelist, createPricelist, updatePricelist,
  setActivePricelist, deletePricelist,
} from '@/lib/admin/pricelists';

export default function PricelistsTab() {
  const [pricelists, setPricelists] = useState<Pricelist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSource, setNewSource] = useState<string>(''); // '' = product defaults
  const [creating, setCreating] = useState(false);

  // edit prices
  const [editing, setEditing] = useState<Pricelist | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setPricelists(await getPricelists());
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Could not load pricelists');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const activate = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await setActivePricelist(id);
      await load();
    } catch (e: any) {
      setError(e.message ?? 'Could not set active pricelist');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (pl: Pricelist) => {
    if (!window.confirm(`Delete pricelist "${pl.name}"? This cannot be undone.`)) return;
    setBusyId(pl.id);
    setError(null);
    try {
      await deletePricelist(pl.id);
      await load();
    } catch (e: any) {
      setError(e.message ?? 'Could not delete pricelist');
    } finally {
      setBusyId(null);
    }
  };

  const submitCreate = async () => {
    if (!newName.trim()) { setError('Enter a name for the pricelist'); return; }
    setCreating(true);
    setError(null);
    try {
      await createPricelist(newName.trim(), newSource || undefined);
      setNewName('');
      setNewSource('');
      setShowCreate(false);
      await load();
    } catch (e: any) {
      setError(e.message ?? 'Could not create pricelist');
    } finally {
      setCreating(false);
    }
  };

  const openEditor = async (id: string) => {
    setBusyId(id);
    try {
      const full = await getPricelist(id);
      if (full) setEditing(full);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
            <Tag className="w-5 h-5 text-vital" /> Pricelists
          </h2>
          <p className="text-sm text-ink-muted mt-1">
            The active pricelist sets default unit prices when adding invoice line items.
          </p>
        </div>
        <button
          onClick={() => { setShowCreate((v) => !v); setError(null); }}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium whitespace-nowrap self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> New Pricelist
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="bg-white rounded-xl border border-line p-5 space-y-3">
          <h3 className="text-sm font-semibold text-ink">Create a new pricelist</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Wholesale, Retail…"
                className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Seed prices from</label>
              <select
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
              >
                <option value="">Product default prices</option>
                {pricelists.map((pl) => (
                  <option key={pl.id} value={pl.id}>Copy of: {pl.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => { setShowCreate(false); setError(null); }}
              className="px-4 py-2 text-sm text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={submitCreate}
              disabled={creating}
              className="px-4 py-2 bg-vital hover:bg-vital/90 text-white text-sm font-medium rounded-lg inline-flex items-center gap-2 disabled:opacity-60"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-ink-muted">
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…
          </div>
        ) : pricelists.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-ink-muted">
            No pricelists yet. Create one to get started.
          </div>
        ) : (
          <>
          {/* Desktop table (≥lg) / mobile cards — ADR 0007. */}
          <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-line">
                {['Pricelist', 'Products', 'Status', ''].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {pricelists.map((pl) => (
                <tr key={pl.id} className="hover:bg-surface transition-colors">
                  <td className="px-5 py-4">
                    <div className="text-sm font-medium text-ink flex items-center gap-2">
                      {pl.is_active && <Star className="w-4 h-4 text-vital fill-vital" />}
                      {pl.name}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-sm text-ink-muted tabular-nums">{pl.item_count ?? 0}</td>
                  <td className="px-5 py-4">
                    {pl.is_active ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-600">
                        <Check className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-surface text-ink-muted border border-line">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-1">
                      {!pl.is_active && (
                        <button
                          onClick={() => activate(pl.id)}
                          disabled={busyId === pl.id}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-line text-ink hover:border-vital hover:text-vital disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {busyId === pl.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Star className="w-3 h-3" />}
                          Set active
                        </button>
                      )}
                      <button
                        onClick={() => openEditor(pl.id)}
                        disabled={busyId === pl.id}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface disabled:opacity-50"
                        title="Edit prices"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => remove(pl)}
                        disabled={busyId === pl.id}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-red-500 hover:bg-surface disabled:opacity-50"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {/* Mobile cards (below lg) */}
          <ul className="lg:hidden divide-y divide-line/50">
            {pricelists.map((pl) => (
              <li key={pl.id} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink flex items-center gap-2">
                      {pl.is_active && <Star className="w-4 h-4 text-vital fill-vital shrink-0" />}
                      {pl.name}
                    </div>
                    <div className="mt-1 text-xs text-ink-muted tabular-nums">{pl.item_count ?? 0} products</div>
                  </div>
                  {pl.is_active ? (
                    <span className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-600">
                      <Check className="w-3 h-3" /> Active
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 px-2 py-0.5 rounded text-xs font-medium bg-surface text-ink-muted border border-line">Inactive</span>
                  )}
                </div>
                <div className="mt-2.5 flex items-center gap-1.5">
                  {!pl.is_active && (
                    <button
                      onClick={() => activate(pl.id)}
                      disabled={busyId === pl.id}
                      className="px-3 py-2 text-xs font-medium rounded-lg border border-line text-ink hover:border-vital hover:text-vital disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      {busyId === pl.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Star className="w-3 h-3" />}
                      Set active
                    </button>
                  )}
                  <button
                    onClick={() => openEditor(pl.id)}
                    disabled={busyId === pl.id}
                    className="ml-auto w-10 h-10 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface disabled:opacity-50"
                    title="Edit prices"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => remove(pl)}
                    disabled={busyId === pl.id}
                    className="w-10 h-10 flex items-center justify-center rounded-lg text-ink-muted hover:text-red-500 hover:bg-surface disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>

      {editing && (
        <PriceEditor
          pricelist={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Price editor modal — edit per-product prices within a pricelist
// ---------------------------------------------------------------------------
function PriceEditor({
  pricelist, onClose, onSaved,
}: { pricelist: Pricelist; onClose: () => void; onSaved: () => void }) {
  const [prices, setPrices] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const it of pricelist.items ?? []) m[it.product_id] = String(it.price);
    return m;
  });
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = pricelist.items ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((it) =>
      (it.product?.name ?? '').toLowerCase().includes(q) ||
      (it.product?.strength ?? '').toLowerCase().includes(q),
    );
  }, [items, search]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = items.map((it) => ({
        product_id: it.product_id,
        price: Math.max(0, Number(prices[it.product_id]) || 0),
      }));
      await updatePricelist(pricelist.id, { items: payload });
      onSaved();
    } catch (e: any) {
      setError(e.message ?? 'Could not save prices');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-line shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-6 pb-4 border-b border-line">
          <div>
            <h3 className="text-base font-bold text-ink">Edit prices — {pricelist.name}</h3>
            <p className="text-xs text-ink-muted mt-0.5">{items.length} product{items.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              className="w-full pl-10 pr-4 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4 space-y-2">
          {filtered.length === 0 ? (
            <p className="text-sm text-ink-muted py-6 text-center">No products match.</p>
          ) : filtered.map((it) => (
            <div key={it.id} className="flex items-center justify-between gap-3 border border-line rounded-lg px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm text-ink truncate">{it.product?.name ?? 'Unknown product'}</div>
                <div className="text-xs text-ink-muted">
                  {it.product?.strength ?? ''}
                  {it.product?.price != null && (
                    <span className="ml-1">· default ${Number(it.product.price).toFixed(2)}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-ink-muted text-sm">$</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={prices[it.product_id] ?? ''}
                  onChange={(e) => setPrices((p) => ({ ...p, [it.product_id]: e.target.value }))}
                  className="w-28 bg-white border border-line rounded-lg px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-vital/40"
                />
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="mx-6 mb-2 flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 p-6 pt-4 border-t border-line">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-ink hover:bg-ink/90 text-white text-sm font-medium rounded-lg inline-flex items-center gap-2 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save prices
          </button>
        </div>
      </div>
    </div>
  );
}
