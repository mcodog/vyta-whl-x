'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Plus, X, Search, Trash2, LayoutGrid, Table as TableIcon,
  ArrowRight, CircleDot, Circle, Package, Calendar, User, Save, Copy,
  Lock, ExternalLink,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useToast } from '@/contexts/ToastContext';
import PriceListDownloadButton from './PriceListDownloadButton';

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

interface Creator {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface PriceList {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  item_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  creator: Creator | null;
}

const creatorName = (c: Creator | null): string => {
  if (!c) return 'System';
  const n = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return n || c.email;
};

const formatDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return '—';
  }
};

export default function PriceListsView() {
  const { canCreate, canDelete } = usePermissions();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [lists, setLists] = useState<PriceList[]>([]);
  // Count of active products, used by the pinned read-only "Default Prices"
  // record (the catalog's own prices from the products table).
  const [productCount, setProductCount] = useState(0);
  const [loading, setLoading] = useState(true);
  // Seed the search from the URL so opening a price list and hitting Back keeps
  // it. Merge-write only our own key so the parent's `view` param is preserved.
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (search) params.set('q', search);
    else params.delete('q');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, pathname, router]);
  const [layout, setLayout] = useState<'table' | 'card'>('card');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [copyFromId, setCopyFromId] = useState('');
  const [creating, setCreating] = useState(false);

  // Per-row busy state (activate / delete)
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchLists = async () => {
    setLoading(true);
    try {
      const [res, countRes] = await Promise.all([
        fetch('/api/admin/pricelists', { headers: await authHeaders() }),
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('active', true),
      ]);
      if (!res.ok) throw new Error('Failed to load price lists');
      const { pricelists } = await res.json();
      setLists(pricelists || []);
      setProductCount(countRes.count || 0);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load price lists');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLists();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return lists;
    return lists.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.description ?? '').toLowerCase().includes(q) ||
        creatorName(l.creator).toLowerCase().includes(q),
    );
  }, [lists, search]);

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error('Enter a name for the price list');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/admin/pricelists', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim(),
          source_pricelist_id: copyFromId || undefined,
        }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json().catch(() => ({ error: '' }));
        throw new Error(msg || 'Failed to create price list');
      }
      toast.success('Price list created');
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      setCopyFromId('');
      fetchLists();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create price list');
    }
    setCreating(false);
  };

  const handleActivate = async (list: PriceList) => {
    setBusyId(list.id);
    try {
      const res = await fetch(`/api/admin/pricelists/${list.id}`, {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ is_active: !list.is_active }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      toast.success(list.is_active ? 'Price list deactivated' : `"${list.name}" is now the active price list`);
      fetchLists();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update status');
    }
    setBusyId(null);
  };

  const handleDelete = async (list: PriceList) => {
    if (!confirm(`Delete price list "${list.name}"? This removes its ${list.item_count} product prices. Customer prices already applied are kept.`)) return;
    setBusyId(list.id);
    try {
      const res = await fetch(`/api/admin/pricelists/${list.id}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to delete price list');
      toast.success('Price list deleted');
      fetchLists();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete price list');
    }
    setBusyId(null);
  };

  // The "Default Prices" record is effective whenever no custom list is active
  // (callers fall back to products.price). Making it active just means clearing
  // the currently-active custom list.
  const activeList = lists.find((l) => l.is_active) || null;
  const defaultEffective = !activeList;

  // Show the pinned Default record unless the user is searching for something
  // that clearly isn't it.
  const showDefault = useMemo(() => {
    const q = search.toLowerCase().trim();
    return !q || 'default prices catalog'.includes(q) || q.length < 2;
  }, [search]);

  const handleUseDefault = async () => {
    if (!activeList) return;
    setBusyId('default');
    try {
      const res = await fetch(`/api/admin/pricelists/${activeList.id}`, {
        method: 'PATCH',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ is_active: false }),
      });
      if (!res.ok) throw new Error('Failed to switch to default prices');
      toast.success('Default catalog prices are now in effect');
      fetchLists();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to switch to default prices');
    }
    setBusyId(null);
  };

  const StatusBadge = ({ active }: { active: boolean }) =>
    active ? (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600">
        <CircleDot className="w-3 h-3" /> Active
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-surface text-ink-muted border border-line">
        <Circle className="w-3 h-3" /> Inactive
      </span>
    );

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search price lists..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40"
          />
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface p-1 self-start">
          {([
            { value: 'table', label: 'Table', icon: TableIcon },
            { value: 'card', label: 'Cards', icon: LayoutGrid },
          ] as const).map(({ value, label, icon: Icon }) => {
            const active = layout === value;
            return (
              <button
                key={value}
                onClick={() => setLayout(value)}
                title={label}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  active ? 'bg-white text-ink shadow-sm border border-line' : 'text-ink-muted hover:text-ink'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            );
          })}
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> New Price List
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-white rounded-xl border border-line px-5 py-16 text-center text-ink-muted text-sm">
          <span className="inline-flex items-center gap-2">
            <span className="w-4 h-4 border-2 border-ink-muted/30 border-t-ink-muted rounded-full animate-spin" />
            Loading price lists…
          </span>
        </div>
      ) : (!showDefault && filtered.length === 0) ? (
        <div className="bg-white rounded-xl border border-line px-5 py-16 text-center">
          <Package className="w-8 h-8 text-ink-muted/40 mx-auto mb-3" />
          <p className="text-ink-muted text-sm">
            {search ? 'No price lists match your search' : 'No price lists yet'}
          </p>
          {!search && canCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/90 transition-colors"
            >
              <Plus className="w-4 h-4" /> Create your first price list
            </button>
          )}
        </div>
      ) : (
        <>
        {/* Table view is desktop-only; on mobile the card grid below shows
            instead (even when Table is selected) — ADR 0007. */}
        {layout === 'table' && (
        <div className="hidden lg:block bg-white rounded-xl border border-line overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="border-b border-line bg-surface">
                  {['Price List', 'Products', 'Created', 'Created By', 'Status', 'Actions'].map((h) => (
                    <th key={h} className={`px-5 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wider ${h === 'Actions' ? 'text-right' : 'text-left'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {showDefault && (
                  <tr className="bg-vital/5">
                    <td className="px-5 py-4">
                      <div className="flex items-start gap-2">
                        <Lock className="w-3.5 h-3.5 text-ink-muted mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <span className="font-semibold text-ink text-sm">Default Prices</span>
                          <span className="block text-xs text-ink-muted line-clamp-1 max-w-md">
                            Base catalog prices from Products — edit them under Products
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-ink tabular-nums">{productCount}</td>
                    <td className="px-5 py-4 text-sm text-ink-muted whitespace-nowrap">—</td>
                    <td className="px-5 py-4 text-sm text-ink-muted whitespace-nowrap">Catalog</td>
                    <td className="px-5 py-4"><StatusBadge active={defaultEffective} /></td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1.5">
                        {canCreate && !defaultEffective && (
                          <button
                            onClick={handleUseDefault}
                            disabled={busyId === 'default'}
                            title="Switch to default catalog prices (clears the active list)"
                            className="inline-flex items-center justify-center h-8 px-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            Use default
                          </button>
                        )}
                        <PriceListDownloadButton
                          pricelistId="default"
                          name="Default Prices"
                          variant="icon"
                        />
                        <Link
                          href="/admin/products"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-line bg-surface text-ink-muted hover:text-ink hover:bg-line/20 transition-colors"
                          title="Edit prices in Products"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Link>
                        {/* Locked: the catalog default can't be deleted here. */}
                        <span
                          title="Built-in — edit in Products, cannot be deleted"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-line bg-surface text-ink-muted/50"
                        >
                          <Lock className="w-4 h-4" />
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                {filtered.map((list) => (
                  <tr key={list.id} className="hover:bg-surface transition-colors">
                    <td className="px-5 py-4">
                      <Link href={`/admin/pricing/list/${list.id}`} className="group inline-flex flex-col">
                        <span className="font-semibold text-ink text-sm group-hover:text-vital transition-colors">{list.name}</span>
                        {list.description && (
                          <span className="text-xs text-ink-muted line-clamp-1 max-w-md">{list.description}</span>
                        )}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-sm text-ink tabular-nums">{list.item_count}</td>
                    <td className="px-5 py-4 text-sm text-ink-muted whitespace-nowrap">{formatDate(list.created_at)}</td>
                    <td className="px-5 py-4 text-sm text-ink-muted whitespace-nowrap">{creatorName(list.creator)}</td>
                    <td className="px-5 py-4"><StatusBadge active={list.is_active} /></td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleActivate(list)}
                          disabled={busyId === list.id}
                          title={list.is_active ? 'Deactivate' : 'Make active'}
                          className={`inline-flex items-center justify-center h-8 px-2.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${
                            list.is_active
                              ? 'bg-surface border-line text-ink-muted hover:text-ink'
                              : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/20'
                          }`}
                        >
                          {list.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <PriceListDownloadButton
                          pricelistId={list.id}
                          name={list.name}
                          variant="icon"
                        />
                        <Link
                          href={`/admin/pricing/list/${list.id}`}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-line bg-surface text-ink-muted hover:text-ink hover:bg-line/20 transition-colors"
                          title="Open price list"
                        >
                          <ArrowRight className="w-4 h-4" />
                        </Link>
                        {canDelete && (
                          <button
                            onClick={() => handleDelete(list)}
                            disabled={busyId === list.id}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                            title="Delete price list"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}
        <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4${layout === 'table' ? ' lg:hidden' : ''}`}>
          {showDefault && (
            <div className="bg-vital/5 rounded-xl border border-vital/20 p-5 flex flex-col">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-ink-muted flex-shrink-0" />
                  <div className="text-sm font-semibold text-ink truncate">Default Prices</div>
                </div>
                <StatusBadge active={defaultEffective} />
              </div>
              <p className="text-xs text-ink-muted line-clamp-2 min-h-[2rem] mb-4">
                Base catalog prices from Products — edit them under Products.
              </p>
              <div className="grid grid-cols-3 gap-2 text-xs mb-4">
                <div>
                  <div className="flex items-center gap-1 text-ink-muted mb-0.5"><Package className="w-3 h-3" /> Products</div>
                  <div className="font-semibold text-ink tabular-nums">{productCount}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-ink-muted mb-0.5"><Calendar className="w-3 h-3" /> Created</div>
                  <div className="font-medium text-ink">—</div>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-ink-muted mb-0.5"><User className="w-3 h-3" /> By</div>
                  <div className="font-medium text-ink truncate">Catalog</div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-auto pt-3 border-t border-vital/20">
                {canCreate && !defaultEffective && (
                  <button
                    onClick={handleUseDefault}
                    disabled={busyId === 'default'}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    Use default
                  </button>
                )}
                <Link
                  href="/admin/products"
                  className="inline-flex items-center gap-1 text-xs font-medium text-vital hover:text-vital/80 ml-auto"
                >
                  Edit in Products <ExternalLink className="w-3.5 h-3.5" />
                </Link>
                <PriceListDownloadButton
                  pricelistId="default"
                  name="Default Prices"
                  variant="icon"
                />
              </div>
            </div>
          )}
          {filtered.map((list) => (
            <div key={list.id} className="bg-white rounded-xl border border-line p-5 flex flex-col">
              <div className="flex items-start justify-between gap-3 mb-2">
                <Link href={`/admin/pricing/list/${list.id}`} className="min-w-0 group">
                  <div className="text-sm font-semibold text-ink truncate group-hover:text-vital transition-colors">{list.name}</div>
                </Link>
                <StatusBadge active={list.is_active} />
              </div>
              <p className="text-xs text-ink-muted line-clamp-2 min-h-[2rem] mb-4">
                {list.description || 'No description'}
              </p>
              <div className="grid grid-cols-3 gap-2 text-xs mb-4">
                <div>
                  <div className="flex items-center gap-1 text-ink-muted mb-0.5"><Package className="w-3 h-3" /> Products</div>
                  <div className="font-semibold text-ink tabular-nums">{list.item_count}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-ink-muted mb-0.5"><Calendar className="w-3 h-3" /> Created</div>
                  <div className="font-medium text-ink">{formatDate(list.created_at)}</div>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-ink-muted mb-0.5"><User className="w-3 h-3" /> By</div>
                  <div className="font-medium text-ink truncate">{creatorName(list.creator)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-auto pt-3 border-t border-line/70">
                <button
                  onClick={() => handleActivate(list)}
                  disabled={busyId === list.id}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${
                    list.is_active
                      ? 'bg-surface border-line text-ink-muted hover:text-ink'
                      : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 hover:bg-emerald-500/20'
                  }`}
                >
                  {list.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <Link
                  href={`/admin/pricing/list/${list.id}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-vital hover:text-vital/80 ml-auto"
                >
                  Open <ArrowRight className="w-3.5 h-3.5" />
                </Link>
                <PriceListDownloadButton pricelistId={list.id} name={list.name} variant="icon" />
                {canDelete && (
                  <button
                    onClick={() => handleDelete(list)}
                    disabled={busyId === list.id}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 sm:p-8 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-ink">New Price List</h2>
              <button onClick={() => setShowCreate(false)} className="text-ink-muted hover:text-ink transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Wholesale 2026"
                  autoFocus
                  className="w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Description <span className="text-ink-muted font-normal">(optional)</span></label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  rows={2}
                  placeholder="What is this price list for?"
                  className="w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5 inline-flex items-center gap-1.5">
                  <Copy className="w-3.5 h-3.5" /> Start from
                </label>
                <select
                  value={copyFromId}
                  onChange={(e) => setCopyFromId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
                >
                  <option value="">Default product prices</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>Copy from: {l.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-muted">
                  New lists are seeded so every active product has a starting price you can then edit.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="flex-1 px-4 py-2.5 bg-surface text-ink rounded-lg hover:bg-line/50 transition-all font-medium text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating || !newName.trim()}
                  className="flex-1 px-4 py-2.5 bg-ink text-white rounded-lg hover:bg-ink/90 transition-all font-medium text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {creating ? 'Creating…' : (<><Save className="w-4 h-4" /> Create List</>)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
