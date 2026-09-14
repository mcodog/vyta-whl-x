'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  Filter,
  Eye,
  FileText,
  Truck,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Package,
  Printer,
  Loader2,
  CheckCircle2,
  X,
  CalendarDays,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  getAllOrders,
  updateOrderStatus,
  deleteOrders,
  createOrderShipment,
  buyOrderLabel,
  getBulkShipmentReadiness,
  type BulkShipmentReadinessRow,
} from '@/lib/admin/api';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { canEdit, canDelete } from '@/lib/permissions';
import ConfirmDeleteDialog from '@/components/admin/ConfirmDeleteDialog';
import ConfirmActionDialog from '@/components/admin/ConfirmActionDialog';
import DayDividerRow from '@/components/admin/DayDivider';
import { groupByDay } from '@/lib/dayGroups';
import { supabase } from '@/lib/supabase';
import { sourceLabel, sourceBadgeClasses } from '@/lib/orderSource';
import { paymentMethodShortLabel } from '@/lib/paymentMethod';
import { rankBySearch, byNewest } from '@/lib/search';
import {
  shippingState,
  shippingStateLabel,
  shippingBadgeClasses,
} from '@/lib/shippingStatus';
import { runPool } from '@/lib/concurrency';

const statusColors: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-400',
  paid: 'bg-blue-500/10 text-blue-400',
  processing: 'bg-purple-500/10 text-purple-400',
  shipped: 'bg-indigo-500/10 text-indigo-400',
  delivered: 'bg-emerald-500/10 text-emerald-400',
  cancelled: 'bg-red-500/10 text-red-400',
};

/** A "new" order is one created within the last 24 hours. */
const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;
function isNewOrder(order: { created_at?: string }): boolean {
  if (!order.created_at) return false;
  return Date.now() - new Date(order.created_at).getTime() < NEW_WINDOW_MS;
}

/** Primary fulfillment-workflow views shown as tabs above the table. */
type TabKey = 'all' | 'new' | 'needs' | 'created' | 'pickup';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'needs', label: 'Needs shipment' },
  { key: 'created', label: 'Shipment created' },
  { key: 'pickup', label: 'Pickup' },
];

/** Orders shown per page in the table. */
const PAGE_SIZE = 20;

/** Whether an order belongs to a given tab. `all` matches everything. */
function matchesTab(order: any, tab: TabKey): boolean {
  switch (tab) {
    case 'new':
      return isNewOrder(order);
    case 'needs':
      return shippingState(order) === 'none';
    case 'created':
      return shippingState(order) === 'created';
    case 'pickup':
      return shippingState(order) === 'pickup';
    case 'all':
    default:
      return true;
  }
}

function OrdersView() {
  const userRole = useUserRole();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [orders, setOrders] = useState<any[]>([]);
  const [updating, setUpdating] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  // Only admins can delete; assistants/affiliates never see the controls.
  const canManageDelete = canDelete(userRole);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Per-row shipping-column status while a bulk shipment/label action runs.
  // Keyed by order id → the label shown next to the spinner (e.g. "Creating
  // shipment…").
  const [rowBusy, setRowBusy] = useState<Record<string, string>>({});
  const markRowBusy = (id: string, label: string) =>
    setRowBusy((prev) => ({ ...prev, [id]: label }));
  const clearRowBusy = (id: string) =>
    setRowBusy((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  // Bulk "create shipment record" pre-flight + run state.
  const [shipmentPreview, setShipmentPreview] = useState<BulkShipmentReadinessRow[] | null>(null);
  const [shipmentPreviewLoading, setShipmentPreviewLoading] = useState(false);
  const [runningShipments, setRunningShipments] = useState(false);
  const [shipmentError, setShipmentError] = useState('');

  // Bulk "buy labels" confirm + run state.
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [runningLabels, setRunningLabels] = useState(false);
  const [labelError, setLabelError] = useState('');

  // Outcome banner shown after a bulk shipping action finishes.
  const [bulkNotice, setBulkNotice] = useState('');

  // Filter state is seeded from the URL so a view survives refresh and can be
  // bookmarked/shared; it's written back to the URL whenever it changes.
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') ?? 'all');
  const [sourceFilter, setSourceFilter] = useState(() => searchParams.get('source') ?? 'all');
  const [tab, setTab] = useState<TabKey>(() => {
    const t = searchParams.get('tab') as TabKey | null;
    return t && TABS.some((x) => x.key === t) ? t : 'all';
  });
  const [page, setPage] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== 'all') params.set('tab', tab);
    if (search) params.set('q', search);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (sourceFilter !== 'all') params.set('source', sourceFilter);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [tab, search, statusFilter, sourceFilter, pathname, router]);

  // Affiliates get a server-scoped list (only their bound customers' orders);
  // admins/assistants use the standard fetch.
  const loadOrders = useCallback(async (): Promise<any[]> => {
    if (userRole === 'affiliate') {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch('/api/admin/orders', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const { orders: data } = res.ok ? await res.json() : { orders: [] };
      return data || [];
    }
    return await getAllOrders();
  }, [userRole]);

  const reloadOrders = useCallback(() => {
    setLoading(true);
    setSelected(new Set());
    loadOrders()
      .then(setOrders)
      .finally(() => setLoading(false));
  }, [loadOrders]);

  useEffect(() => {
    reloadOrders();
  }, [reloadOrders]);

  const downloadReport = async () => {
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      const qs = params.toString();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch(`/api/admin/orders/report${qs ? `?${qs}` : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        alert('Could not generate report');
        return;
      }
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } finally {
      setDownloading(false);
    }
  };

  // Distinct sources present in the current order set, for the source filter.
  const sources = useMemo(
    () => Array.from(new Set(orders.map((o) => o.source).filter(Boolean))) as string[],
    [orders],
  );

  // Apply search + status + source first; the tab is the final, primary cut.
  // Tab counts are computed off this base so each count reflects what you'd see
  // if you clicked it given the other active filters.
  const baseFiltered = useMemo(() => {
    let result = orders;
    if (search) {
      result = rankBySearch(
        result,
        search,
        [
          { value: (o) => o.order_number, weight: 2 },
          { value: (o) => o.customer_name, weight: 3 },
          { value: (o) => o.customer_email, weight: 1 },
        ],
        byNewest,
      );
    }
    if (statusFilter !== 'all') result = result.filter((o) => o.status === statusFilter);
    if (sourceFilter !== 'all') result = result.filter((o) => o.source === sourceFilter);
    return result;
  }, [orders, search, statusFilter, sourceFilter]);

  const tabCounts = useMemo(() => {
    const counts = { all: 0, new: 0, needs: 0, created: 0, pickup: 0 } as Record<TabKey, number>;
    for (const o of baseFiltered) {
      counts.all++;
      if (isNewOrder(o)) counts.new++;
      const st = shippingState(o);
      if (st === 'none') counts.needs++;
      else if (st === 'created') counts.created++;
      else if (st === 'pickup') counts.pickup++;
    }
    return counts;
  }, [baseFiltered]);

  const filteredOrders = useMemo(
    () => baseFiltered.filter((o) => matchesTab(o, tab)),
    [baseFiltered, tab],
  );

  // Reset to the first page whenever the filtered set changes underneath us,
  // so the current page never points past the end of the list. Also drop any
  // selection since the visible rows change.
  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [search, statusFilter, sourceFilter, tab]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  // Clamp in case the list shrank (e.g. an order's status changed) below the
  // current page after a reload.
  const safePage = Math.min(page, totalPages - 1);
  const pagedOrders = useMemo(
    () => filteredOrders.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filteredOrders, safePage],
  );
  const rangeStart = filteredOrders.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filteredOrders.length, (safePage + 1) * PAGE_SIZE);
  // Split the visible page into per-day groups so the table shows a readable
  // date divider between days.
  const orderGroups = useMemo(() => groupByDay(pagedOrders, (o) => o.created_at), [pagedOrders]);

  const handleStatusChange = async (orderId: string, status: string) => {
    setUpdating(orderId);
    await updateOrderStatus(orderId, status as any);
    setOrders(await loadOrders());
    setUpdating(null);
  };

  // Selection is keyed by order id. "Select all" toggles the current page only.
  const pageIds = useMemo(() => pagedOrders.map((o) => o.id), [pagedOrders]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleSelectAllPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  // Add/remove a whole day's visible rows in one click (day-divider checkbox).
  const toggleSelectDay = (ids: string[], allSelected: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });

  // The full order objects behind the current selection (selection can span
  // pages, so resolve against the whole loaded list, not just the page).
  const selectedOrders = useMemo(
    () => orders.filter((o) => selected.has(o.id)),
    [orders, selected],
  );
  // Orders in the selection that can have a label bought now: a shipment exists,
  // it isn't a pickup, and no label has been generated yet.
  const labelEligible = useMemo(
    () =>
      selectedOrders.filter(
        (o) =>
          shippingState(o) !== 'pickup' &&
          o.easyship_shipment_id &&
          o.label_state !== 'generated',
      ),
    [selectedOrders],
  );
  const anyBulkRunning = runningShipments || runningLabels;

  // --- Bulk: create shipment records -------------------------------------
  const openShipmentDialog = async () => {
    setShipmentError('');
    setShipmentPreview([]);
    setShipmentPreviewLoading(true);
    const res = await getBulkShipmentReadiness(Array.from(selected));
    if (!res.success) {
      setShipmentError(res.error || 'Failed to check shipment readiness');
      setShipmentPreviewLoading(false);
      return;
    }
    setShipmentPreview(res.results);
    setShipmentPreviewLoading(false);
  };

  const runBulkShipments = async () => {
    const eligible = (shipmentPreview ?? []).filter((r) => r.eligible);
    if (eligible.length === 0) return;
    setRunningShipments(true);
    setShipmentError('');
    let ok = 0;
    let failed = 0;
    await runPool(eligible, 4, async (row) => {
      markRowBusy(row.id, 'Creating shipment…');
      const res = await createOrderShipment(row.id);
      if (res.success) ok++;
      else failed++;
      clearRowBusy(row.id);
    });
    setRunningShipments(false);
    setShipmentPreview(null);
    setBulkNotice(
      `Created ${ok} shipment${ok !== 1 ? 's' : ''}` +
        (failed ? ` · ${failed} failed` : '') +
        '.',
    );
    reloadOrders();
  };

  // --- Bulk: buy shipping labels -----------------------------------------
  const runBulkLabels = async () => {
    if (labelEligible.length === 0) return;
    setRunningLabels(true);
    setLabelError('');
    let generated = 0;
    let pending = 0;
    let failed = 0;
    await runPool(labelEligible, 4, async (order) => {
      markRowBusy(order.id, 'Buying label…');
      const res = await buyOrderLabel(order.id);
      if (!res.success) failed++;
      else if (res.labelState === 'generated') generated++;
      else pending++;
      clearRowBusy(order.id);
    });
    setRunningLabels(false);
    setLabelDialogOpen(false);
    setBulkNotice(
      `Bought ${generated + pending} label${generated + pending !== 1 ? 's' : ''}` +
        (pending ? ` · ${pending} still generating` : '') +
        (failed ? ` · ${failed} failed` : '') +
        '.',
    );
    reloadOrders();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    const res = await deleteOrders(deleteTarget);
    if (!res.success) {
      setDeleteError(res.error || 'Failed to delete orders');
      setDeleting(false);
      return;
    }
    setDeleting(false);
    setDeleteTarget(null);
    reloadOrders();
  };

  const shipmentEligible = (shipmentPreview ?? []).filter((r) => r.eligible);
  const shipmentSkipped = (shipmentPreview ?? []).filter((r) => !r.eligible);

  const filtersActive = search || statusFilter !== 'all' || sourceFilter !== 'all' || tab !== 'all';
  const colCount = (canManageDelete ? 1 : 0) + 8;

  return (
    <>
      {/* Workflow tabs */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {TABS.map(({ key, label }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-ink text-white'
                  : 'bg-white border border-line text-ink-muted hover:text-ink hover:bg-surface'
              }`}
            >
              {key === 'new' && <Sparkles className="w-3.5 h-3.5" />}
              {key === 'needs' && <Truck className="w-3.5 h-3.5" />}
              {label}
              <span
                className={`inline-flex items-center justify-center min-w-[1.25rem] px-1 rounded-full text-[11px] font-semibold ${
                  active ? 'bg-white/20 text-white' : 'bg-surface text-ink-muted'
                }`}
              >
                {tabCounts[key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search orders, customers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full sm:w-auto pl-10 pr-8 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 appearance-none"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="processing">Processing</option>
            <option value="shipped">Shipped</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="w-full sm:w-auto pl-10 pr-8 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 appearance-none"
          >
            <option value="all">All Sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{sourceLabel(s)}</option>
            ))}
          </select>
        </div>
        <button
          onClick={downloadReport}
          disabled={downloading}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-line text-ink rounded-lg text-sm font-semibold hover:bg-surface transition-colors whitespace-nowrap disabled:opacity-50"
        >
          <FileText className="w-4 h-4" />
          {downloading ? 'Generating…' : 'Download Report'}
        </button>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap items-center gap-4 mb-6 text-sm">
        <span className="text-ink-muted">{filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''}</span>
        <span className="text-vital">{filteredOrders.filter(o => o.status === 'pending').length} pending</span>
        <span className="text-blue-400">{filteredOrders.filter(o => o.status === 'paid').length} paid</span>
      </div>

      {/* Bulk action outcome banner */}
      {bulkNotice && (
        <div className="flex items-center justify-between gap-3 mb-3 px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <span className="inline-flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> {bulkNotice}
          </span>
          <button
            onClick={() => setBulkNotice('')}
            className="text-emerald-700/70 hover:text-emerald-700 transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Bulk actions */}
      {canManageDelete && selected.size > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 px-4 py-2.5 bg-white border border-line rounded-lg">
          <span className="text-sm text-ink">
            <span className="font-semibold tabular-nums">{selected.size}</span> selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={openShipmentDialog}
              disabled={anyBulkRunning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {runningShipments ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Package className="w-4 h-4" />
              )}
              Create shipments
            </button>
            <button
              onClick={() => {
                setLabelError('');
                setLabelDialogOpen(true);
              }}
              disabled={anyBulkRunning || labelEligible.length === 0}
              title={
                labelEligible.length === 0
                  ? 'None of the selected orders have a shipment awaiting a label'
                  : undefined
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-line text-ink text-sm font-medium hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {runningLabels ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Printer className="w-4 h-4" />
              )}
              Buy labels
              {labelEligible.length > 0 && (
                <span className="tabular-nums text-ink-muted">({labelEligible.length})</span>
              )}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              disabled={anyBulkRunning}
              className="px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 transition-colors disabled:opacity-50"
            >
              Clear
            </button>
            <button
              onClick={() => {
                setDeleteError('');
                setDeleteTarget(Array.from(selected));
              }}
              disabled={anyBulkRunning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" /> Delete selected
            </button>
          </div>
        </div>
      )}

      {/* Orders Table (desktop ≥lg) / cards (mobile). Per ADR 0007 the table is
          untouched at ≥lg and hidden below lg, where the card list renders. */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead>
              <tr className="border-b border-line">
                {canManageDelete && (
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      checked={allPageSelected}
                      onChange={toggleSelectAllPage}
                      className="w-4 h-4 rounded border-line text-vital focus:ring-vital/40 cursor-pointer"
                    />
                  </th>
                )}
                <th className="px-3 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Order</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Customer</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Total</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Payment</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Source</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Shipping</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Date</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {orderGroups.map((group) => {
                const groupIds = group.items.map((o) => o.id);
                const groupAllSelected =
                  groupIds.length > 0 && groupIds.every((id) => selected.has(id));
                const groupSomeSelected = groupIds.some((id) => selected.has(id));
                return (
                <React.Fragment key={group.key}>
                  <DayDividerRow
                    colSpan={colCount}
                    label={group.label}
                    count={group.items.length}
                    selectable={canManageDelete}
                    allSelected={groupAllSelected}
                    someSelected={groupSomeSelected}
                    onToggleSelect={() => toggleSelectDay(groupIds, groupAllSelected)}
                  />
                  {group.items.map((order) => {
                const state = shippingState(order);
                const canManage = canEdit(userRole);
                return (
                  <tr key={order.id} className="hover:bg-surface transition-colors">
                    {canManageDelete && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select order ${order.order_number}`}
                          checked={selected.has(order.id)}
                          onChange={() => toggleSelect(order.id)}
                          className="w-4 h-4 rounded border-line text-vital focus:ring-vital/40 cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <Link href={`/admin/orders/${order.id}`} className="font-mono text-sm text-ink hover:text-ink transition-colors">
                          {order.order_number}
                        </Link>
                        {isNewOrder(order) && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-vital/15 text-vital">
                            <Sparkles className="w-2.5 h-2.5" /> New
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-sm font-medium text-ink">{order.customer_name || 'Guest'}</div>
                      <div className="text-xs text-ink-muted">{order.customer_email}</div>
                    </td>
                    <td className="px-3 py-3 font-semibold text-ink tabular-nums whitespace-nowrap">${order.total?.toFixed(2)}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-surface text-ink-muted whitespace-nowrap">
                        {paymentMethodShortLabel(order.crypto)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {order.source ? (
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${sourceBadgeClasses(order.source)}`}>
                          {sourceLabel(order.source)}
                        </span>
                      ) : (
                        <span className="text-xs text-ink-muted">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {rowBusy[order.id] ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-vital font-medium">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          {rowBusy[order.id]}
                        </span>
                      ) : (
                        <span className="inline-flex flex-col gap-0.5">
                          <span
                            className={`inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${shippingBadgeClasses(state)}`}
                          >
                            {state === 'created' && <Truck className="w-3 h-3" />}
                            {shippingStateLabel(state)}
                          </span>
                          {order.tracking_number && (
                            <span className="font-mono text-[10px] text-ink-muted">
                              {order.tracking_number}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-sm text-ink-muted whitespace-nowrap">{new Date(order.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        {canManage ? (
                          <select
                            value={order.status}
                            onChange={(e) => handleStatusChange(order.id, e.target.value)}
                            disabled={updating === order.id}
                            className="text-sm bg-surface border border-line text-ink rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-vital/40"
                          >
                            <option value="pending">Pending</option>
                            <option value="paid">Paid</option>
                            <option value="processing">Processing</option>
                            <option value="shipped">Shipped</option>
                            <option value="delivered">Delivered</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        ) : (
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusColors[order.status]}`}>
                            {order.status}
                          </span>
                        )}
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        {canManageDelete && (
                          <button
                            onClick={() => {
                              setDeleteError('');
                              setDeleteTarget([order.id]);
                            }}
                            title="Delete order"
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
                  })}
                </React.Fragment>
                );
              })}
              {loading && (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center text-ink-muted text-sm">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-ink-muted/30 border-t-ink-muted rounded-full animate-spin" />
                      Loading orders…
                    </span>
                  </td>
                </tr>
              )}
              {!loading && filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-4 py-12 text-center text-ink-muted text-sm">
                    {filtersActive ? 'No orders match your filters' : 'No orders yet'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards (below lg). Same day groups, rows and handlers as the
            table above; the whole card opens the order. See ADR 0007. */}
        <div className="lg:hidden">
          {loading ? (
            <div className="px-4 py-12 text-center text-ink-muted text-sm">
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-ink-muted/30 border-t-ink-muted rounded-full animate-spin" />
                Loading orders…
              </span>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="px-4 py-12 text-center text-ink-muted text-sm">
              {filtersActive ? 'No orders match your filters' : 'No orders yet'}
            </div>
          ) : (
            <div>
              {orderGroups.map((group) => {
                const groupIds = group.items.map((o) => o.id);
                const groupAllSelected = groupIds.length > 0 && groupIds.every((id) => selected.has(id));
                return (
                  <div key={group.key}>
                    <div className="flex items-center gap-2 bg-surface/60 px-4 py-2 border-y border-line/70">
                      {canManageDelete && (
                        <input
                          type="checkbox"
                          aria-label={`Select all orders on ${group.label}`}
                          checked={groupAllSelected}
                          onChange={() => toggleSelectDay(groupIds, groupAllSelected)}
                          className="w-4 h-4 rounded border-line text-vital focus:ring-vital/40 cursor-pointer"
                        />
                      )}
                      <CalendarDays className="w-3.5 h-3.5 text-ink-muted" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{group.label}</span>
                      <span className="inline-flex items-center justify-center min-w-[1.25rem] px-1 rounded-full text-[10px] font-semibold bg-white text-ink-muted border border-line">
                        {group.items.length}
                      </span>
                    </div>
                    <div className="divide-y divide-line/50">
                      {group.items.map((order) => {
                        const state = shippingState(order);
                        const canManage = canEdit(userRole);
                        return (
                          <div
                            key={order.id}
                            onClick={() => router.push(`/admin/orders/${order.id}`)}
                            className="px-4 py-3.5 cursor-pointer transition-colors active:bg-surface"
                          >
                            <div className="flex items-start gap-3">
                              {canManageDelete && (
                                <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    aria-label={`Select order ${order.order_number}`}
                                    checked={selected.has(order.id)}
                                    onChange={() => toggleSelect(order.id)}
                                    className="w-4 h-4 rounded border-line text-vital focus:ring-vital/40 cursor-pointer"
                                  />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                                    <span className="font-mono text-sm text-ink">{order.order_number}</span>
                                    {isNewOrder(order) && (
                                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-vital/15 text-vital">
                                        <Sparkles className="w-2.5 h-2.5" /> New
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-sm font-semibold text-ink tabular-nums whitespace-nowrap">${order.total?.toFixed(2)}</span>
                                </div>

                                <div className="mt-1">
                                  <div className="text-sm text-ink">{order.customer_name || 'Guest'}</div>
                                  <div className="text-xs text-ink-muted break-all">{order.customer_email}</div>
                                </div>

                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-surface text-ink-muted whitespace-nowrap">
                                    {paymentMethodShortLabel(order.crypto)}
                                  </span>
                                  {order.source && (
                                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${sourceBadgeClasses(order.source)}`}>
                                      {sourceLabel(order.source)}
                                    </span>
                                  )}
                                  {rowBusy[order.id] ? (
                                    <span className="inline-flex items-center gap-1.5 text-xs text-vital font-medium">
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> {rowBusy[order.id]}
                                    </span>
                                  ) : (
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${shippingBadgeClasses(state)}`}>
                                      {state === 'created' && <Truck className="w-3 h-3" />}
                                      {shippingStateLabel(state)}
                                    </span>
                                  )}
                                  {order.tracking_number && !rowBusy[order.id] && (
                                    <span className="font-mono text-[10px] text-ink-muted">{order.tracking_number}</span>
                                  )}
                                </div>

                                <div className="mt-1.5 text-xs text-ink-muted">{new Date(order.created_at).toLocaleDateString()}</div>

                                <div className="mt-2.5 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                  {canManage ? (
                                    <select
                                      value={order.status}
                                      onChange={(e) => handleStatusChange(order.id, e.target.value)}
                                      disabled={updating === order.id}
                                      className="text-sm bg-surface border border-line text-ink rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-vital/40"
                                    >
                                      <option value="pending">Pending</option>
                                      <option value="paid">Paid</option>
                                      <option value="processing">Processing</option>
                                      <option value="shipped">Shipped</option>
                                      <option value="delivered">Delivered</option>
                                      <option value="cancelled">Cancelled</option>
                                    </select>
                                  ) : (
                                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusColors[order.status]}`}>
                                      {order.status}
                                    </span>
                                  )}
                                  {canManageDelete && (
                                    <button
                                      onClick={() => { setDeleteError(''); setDeleteTarget([order.id]); }}
                                      title="Delete order"
                                      aria-label="Delete order"
                                      className="ml-auto w-10 h-10 flex items-center justify-center rounded-lg text-ink-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {!loading && filteredOrders.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-3 py-3 border-t border-line">
            <span className="text-sm text-ink-muted">
              Showing <span className="font-medium text-ink tabular-nums">{rangeStart}</span>–
              <span className="font-medium text-ink tabular-nums">{rangeEnd}</span> of{' '}
              <span className="font-medium text-ink tabular-nums">{filteredOrders.length}</span>
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

      {deleteTarget && (
        <ConfirmDeleteDialog
          title={deleteTarget.length > 1 ? 'Delete Orders' : 'Delete Order'}
          message={
            <>
              <p className="mb-2">
                You are about to permanently delete{' '}
                <span className="font-semibold text-ink">
                  {deleteTarget.length} order{deleteTarget.length !== 1 ? 's' : ''}
                </span>
                .
              </p>
              <p>
                Any linked invoice is deleted too (orders and invoices are paired).{' '}
                <span className="font-semibold text-red-500">This cannot be undone.</span>
              </p>
            </>
          }
          confirmLabel={deleteTarget.length > 1 ? `Delete ${deleteTarget.length} orders` : 'Delete order'}
          loading={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onClose={() => {
            if (deleting) return;
            setDeleteTarget(null);
            setDeleteError('');
          }}
        />
      )}

      {/* Bulk create shipment records — with skip warnings */}
      {shipmentPreview !== null && (
        <ConfirmActionDialog
          title="Create shipment records"
          icon={Package}
          confirmLabel={
            shipmentPreviewLoading
              ? 'Checking…'
              : shipmentEligible.length > 0
                ? `Create ${shipmentEligible.length} shipment${shipmentEligible.length !== 1 ? 's' : ''}`
                : 'Nothing to create'
          }
          confirmDisabled={shipmentPreviewLoading || shipmentEligible.length === 0}
          loading={runningShipments}
          error={shipmentError}
          message={
            shipmentPreviewLoading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Checking shipment requirements…
              </span>
            ) : (
              <div className="space-y-3">
                <p>
                  <span className="font-semibold text-ink">{shipmentEligible.length}</span> shipment
                  {shipmentEligible.length !== 1 ? 's' : ''} will be created in Easyship.
                </p>
                {shipmentSkipped.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="font-medium text-amber-700 mb-1.5">
                      {shipmentSkipped.length} order{shipmentSkipped.length !== 1 ? 's' : ''} will be
                      skipped:
                    </p>
                    <ul className="space-y-1 max-h-48 overflow-y-auto">
                      {shipmentSkipped.map((r) => (
                        <li key={r.id} className="text-xs text-ink-muted">
                          <span className="font-mono text-ink">{r.orderNumber ?? r.id.slice(0, 8)}</span>
                          {' — '}
                          {r.reason ?? 'Not eligible'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {shipmentEligible.length > 0 && (
                  <p className="text-xs">
                    Only the eligible orders above will be created. You can continue or cancel.
                  </p>
                )}
              </div>
            )
          }
          onConfirm={runBulkShipments}
          onClose={() => {
            if (runningShipments) return;
            setShipmentPreview(null);
            setShipmentError('');
          }}
        />
      )}

      {/* Bulk buy labels — wallet funds warning */}
      {labelDialogOpen && (
        <ConfirmActionDialog
          title="Buy shipping labels"
          icon={Printer}
          tone="warning"
          confirmLabel={`Buy ${labelEligible.length} label${labelEligible.length !== 1 ? 's' : ''}`}
          confirmDisabled={labelEligible.length === 0}
          loading={runningLabels}
          error={labelError}
          message={
            <div className="space-y-3">
              <p>
                This will buy labels for{' '}
                <span className="font-semibold text-ink">{labelEligible.length}</span> selected
                shipment{labelEligible.length !== 1 ? 's' : ''}.
              </p>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-amber-700">
                <p className="font-medium mb-1">Confirm your Easyship wallet is funded</p>
                <p className="text-xs">
                  Buying a label charges your Easyship wallet. If the balance is too low, some labels
                  will fail to generate. Top up the wallet first if you&apos;re unsure — this cannot
                  be undone once purchased.
                </p>
              </div>
            </div>
          }
          onConfirm={runBulkLabels}
          onClose={() => {
            if (runningLabels) return;
            setLabelDialogOpen(false);
            setLabelError('');
          }}
        />
      )}
    </>
  );
}

export default function AdminOrders() {
  // OrdersView reads the URL via useSearchParams, which Next requires to sit
  // inside a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <OrdersView />
    </Suspense>
  );
}
