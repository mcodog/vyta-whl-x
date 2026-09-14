'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, Filter, Plus, Building2, FileText, ClipboardList, Pencil, Tags, Trash2, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getPurchaseOrders, deletePurchaseOrder, type PurchaseOrderListItem } from '@/lib/admin/purchase-orders';
import { PO_STATUS_META, PO_STATUSES, isPoLocked } from '@/lib/admin/po-status';
import type { PurchaseOrderStatus } from '@/lib/supabase';
import { rankBySearch, byNewest } from '@/lib/search';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { useToast } from '@/contexts/ToastContext';

function PurchaseOrdersIndex() {
  const { canDelete } = usePermissions();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<PurchaseOrderListItem[]>([]);
  // Filters are seeded from the URL so opening a PO and hitting Back keeps the
  // search/status (and the view can be bookmarked/shared); written back on change.
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | 'all'>(
    () => (searchParams.get('status') as PurchaseOrderStatus | null) ?? 'all',
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [search, statusFilter, pathname, router]);

  // Bulk-select + delete state.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // The pending delete: a single PO, or the whole current selection.
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    getPurchaseOrders().then((data) => {
      setRows(data);
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    let r = rows;
    if (statusFilter !== 'all') r = r.filter((po) => po.status === statusFilter);
    if (search.trim()) {
      r = rankBySearch(
        r,
        search,
        [
          { value: (po) => po.po_number, weight: 2 },
          { value: (po) => po.supplier?.name, weight: 2 },
        ],
        byNewest,
      );
    }
    return r;
  }, [rows, search, statusFilter]);

  // Drop any selected ids that are no longer visible under the current filters.
  const visibleSelectedIds = useMemo(
    () => filtered.filter((po) => selectedIds.has(po.id)).map((po) => po.id),
    [filtered, selectedIds],
  );
  const allVisibleSelected = filtered.length > 0 && visibleSelectedIds.length === filtered.length;

  const totals = useMemo(() => {
    const total = rows.reduce((s, po) => s + Number(po.total), 0);
    const openValue = rows
      .filter((po) => po.status !== 'paid' && po.status !== 'cancelled')
      .reduce((s, po) => s + Number(po.total), 0);
    const paid = rows.filter((po) => po.status === 'paid').length;
    return { count: rows.length, total, openValue, paid };
  }, [rows]);

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filtered.forEach((po) => next.delete(po.id));
      } else {
        filtered.forEach((po) => next.add(po.id));
      }
      return next;
    });
  };

  const runDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    const ids = confirmDelete.ids;
    const results = await Promise.allSettled(ids.map((id) => deletePurchaseOrder(id)));
    const deletedIds = new Set<string>();
    let failures = 0;
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') deletedIds.add(ids[i]);
      else failures += 1;
    });
    if (deletedIds.size > 0) {
      setRows((prev) => prev.filter((po) => !deletedIds.has(po.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });
    }
    if (failures === 0) {
      toast.success(
        deletedIds.size === 1 ? 'Purchase order deleted' : `Deleted ${deletedIds.size} purchase orders`,
      );
    } else if (deletedIds.size === 0) {
      toast.error('Failed to delete purchase order' + (ids.length > 1 ? 's' : ''));
    } else {
      toast.error(`Deleted ${deletedIds.size}, ${failures} failed`);
    }
    setDeleting(false);
    setConfirmDelete(null);
  };

  const openPdf = async (id: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/purchase-orders/${id}/pdf`, {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
    if (!res.ok) {
      alert('Could not open PDF');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  // Number of leading columns before the data columns (checkbox when deletable).
  const colCount = canDelete ? 10 : 9;

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-vital" /> Purchase Orders
          </h1>
          <p className="text-sm text-ink-muted mt-1">{totals.count} order{totals.count !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/purchase-orders/supplier-pricelists"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-line text-ink-muted hover:text-ink hover:border-ink/20 rounded-lg text-sm transition-colors"
          >
            <Tags className="w-4 h-4" /> Pricelists
          </Link>
          <Link
            href="/admin/purchase-orders/suppliers"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-line text-ink-muted hover:text-ink hover:border-ink/20 rounded-lg text-sm transition-colors"
          >
            <Building2 className="w-4 h-4" /> Suppliers
          </Link>
          <Link
            href="/admin/purchase-orders/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Create
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Orders" value={totals.count} />
        <StatCard label="Total Value" value={`$${totals.total.toFixed(2)}`} />
        <StatCard label="Open Value" value={`$${totals.openValue.toFixed(2)}`} highlight />
        <StatCard label="Paid Orders" value={totals.paid} />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search by PO # or supplier..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="pl-10 pr-8 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 appearance-none"
          >
            <option value="all">All Statuses</option>
            {PO_STATUSES.map((s) => (
              <option key={s} value={s}>{PO_STATUS_META[s].label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Bulk action bar */}
      {canDelete && visibleSelectedIds.length > 0 && (
        <div className="flex items-center justify-between gap-3 mb-4 px-4 py-3 bg-vital/5 border border-vital/30 rounded-lg">
          <span className="text-sm font-medium text-ink">
            {visibleSelectedIds.length} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 text-sm text-ink-muted hover:text-ink transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() =>
                setConfirmDelete({
                  ids: visibleSelectedIds,
                  label: `${visibleSelectedIds.length} purchase order${visibleSelectedIds.length === 1 ? '' : 's'}`,
                })
              }
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Delete selected
            </button>
          </div>
        </div>
      )}

      {/* Table (desktop ≥lg) / cards (mobile) — ADR 0007. */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="border-b border-line">
                {canDelete && (
                  <th className="px-5 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      aria-label="Select all purchase orders"
                      className="w-4 h-4 rounded border-line text-vital focus:ring-vital/40 cursor-pointer"
                    />
                  </th>
                )}
                {['PO #', 'Supplier', 'Items', 'Total', 'Order Date', 'Expected', 'Status', 'Created', ''].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                <tr><td colSpan={colCount} className="px-5 py-12 text-center text-sm text-ink-muted">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={colCount} className="px-5 py-12 text-center text-sm text-ink-muted">
                  {rows.length === 0 ? 'No purchase orders yet' : 'No orders match your filters'}
                </td></tr>
              ) : filtered.map((po) => {
                const meta = PO_STATUS_META[po.status];
                const selected = selectedIds.has(po.id);
                return (
                  <tr key={po.id} className={`transition-colors ${selected ? 'bg-vital/5' : 'hover:bg-surface'}`}>
                    {canDelete && (
                      <td className="px-5 py-4">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleOne(po.id)}
                          aria-label={`Select ${po.po_number}`}
                          className="w-4 h-4 rounded border-line text-vital focus:ring-vital/40 cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-5 py-4">
                      <Link href={`/admin/purchase-orders/${po.id}`} className="font-mono text-sm text-ink hover:text-vital">
                        {po.po_number}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-sm text-ink">{po.supplier?.name ?? '—'}</td>
                    <td className="px-5 py-4 text-sm text-ink-muted tabular-nums">{po.item_count}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-ink tabular-nums">${Number(po.total).toFixed(2)}</td>
                    <td className="px-5 py-4 text-sm text-ink-muted">
                      {po.order_date ? new Date(po.order_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-5 py-4 text-sm text-ink-muted">
                      {po.expected_date ? new Date(po.expected_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${meta.badge}`}>{meta.label}</span>
                    </td>
                    <td className="px-5 py-4 text-sm text-ink-muted">{new Date(po.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/admin/purchase-orders/${po.id}`}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                          title={isPoLocked(po.status) ? 'View purchase order' : 'Edit purchase order'}
                        >
                          <Pencil className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => openPdf(po.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                          title="View PDF"
                        >
                          <FileText className="w-4 h-4" />
                        </button>
                        {canDelete && (
                          <button
                            onClick={() => setConfirmDelete({ ids: [po.id], label: `purchase order ${po.po_number}` })}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Delete purchase order"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards (below lg) — same rows, actions and handlers. ADR 0007. */}
        <div className="lg:hidden">
          {loading ? (
            <div className="px-5 py-12 text-center text-sm text-ink-muted">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-ink-muted">
              {rows.length === 0 ? 'No purchase orders yet' : 'No orders match your filters'}
            </div>
          ) : (
            <ul className="divide-y divide-line/50">
              {filtered.map((po) => {
                const meta = PO_STATUS_META[po.status];
                const selected = selectedIds.has(po.id);
                return (
                  <li key={po.id} className={`px-4 py-3.5 ${selected ? 'bg-vital/5' : ''}`}>
                    <div className="flex items-start gap-3">
                      {canDelete && (
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleOne(po.id)}
                          aria-label={`Select ${po.po_number}`}
                          className="mt-1 w-4 h-4 rounded border-line text-vital focus:ring-vital/40 cursor-pointer shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <Link href={`/admin/purchase-orders/${po.id}`} className="font-mono text-sm text-ink hover:text-vital">
                            {po.po_number}
                          </Link>
                          <span className={`inline-flex shrink-0 px-2 py-0.5 rounded text-xs font-medium ${meta.badge}`}>{meta.label}</span>
                        </div>
                        <div className="mt-1 text-sm text-ink">{po.supplier?.name ?? '—'}</div>
                        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                          <span>Items <span className="text-ink tabular-nums">{po.item_count}</span></span>
                          <span>Total <span className="text-ink font-semibold tabular-nums">${Number(po.total).toFixed(2)}</span></span>
                          <span>Ordered <span className="text-ink">{po.order_date ? new Date(po.order_date).toLocaleDateString() : '—'}</span></span>
                          <span>Expected <span className="text-ink">{po.expected_date ? new Date(po.expected_date).toLocaleDateString() : '—'}</span></span>
                        </div>
                        <div className="mt-2.5 flex items-center gap-1">
                          <Link
                            href={`/admin/purchase-orders/${po.id}`}
                            className="w-10 h-10 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                            title={isPoLocked(po.status) ? 'View purchase order' : 'Edit purchase order'}
                          >
                            <Pencil className="w-4 h-4" />
                          </Link>
                          <button
                            onClick={() => openPdf(po.id)}
                            className="w-10 h-10 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                            title="View PDF"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                          {canDelete && (
                            <button
                              onClick={() => setConfirmDelete({ ids: [po.id], label: `purchase order ${po.po_number}` })}
                              className="w-10 h-10 flex items-center justify-center rounded-lg text-ink-muted hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Delete purchase order"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <div className="flex items-start justify-between mb-3">
              <h2 className="text-lg font-bold text-ink">Delete purchase order{confirmDelete.ids.length === 1 ? '' : 's'}?</h2>
              <button
                onClick={() => !deleting && setConfirmDelete(null)}
                className="text-ink-muted hover:text-ink transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-ink-muted mb-6">
              You&apos;re about to permanently delete {confirmDelete.label}, including all line items and
              receipt records. This can&apos;t be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="px-4 py-2 rounded-lg border border-line text-sm text-ink hover:bg-surface transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={runDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function PurchaseOrdersPage() {
  // PurchaseOrdersIndex reads the URL via useSearchParams, which Next requires
  // to sit inside a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <PurchaseOrdersIndex />
    </Suspense>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border ${highlight ? 'border-vital/40' : 'border-line'} p-4`}>
      <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${highlight ? 'text-vital' : 'text-ink'}`}>{value}</div>
    </div>
  );
}
