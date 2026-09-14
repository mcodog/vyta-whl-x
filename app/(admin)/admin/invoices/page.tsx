'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  FileText, Plus, Search, BarChart2, ExternalLink, Download, Tag,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Trash2, Package,
  Printer, Loader2, CheckCircle2, X, RefreshCw, Camera, Users, UserRound, DollarSign, Undo2,
  CalendarDays,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  getInvoices, getAgingReport, deleteInvoices, setInvoiceFulfillmentStatus,
  type InvoiceListItem, type InvoiceStats,
} from '@/lib/admin/invoices';
import { rankNameMatches } from '@/lib/admin/searchRank';
import {
  getBulkShipmentReadiness, createOrderShipment, buyOrderLabel,
  type BulkShipmentReadinessRow,
} from '@/lib/admin/api';
import {
  INVOICE_STATUS_META,
  INVOICE_SOURCE_FILTER_OPTIONS,
  INVOICE_CURRENCY_FILTER_OPTIONS,
  invoiceSourceMeta,
  invoiceCurrencyMeta,
  type InvoiceSource,
} from '@/lib/admin/invoice-status';
import type { InvoiceStatus, AgingBucket, FulfillmentStatus, InvoiceCurrency } from '@/lib/supabase';
import { shippingState, type ShippingStatusOrder } from '@/lib/shippingStatus';
import { runPool } from '@/lib/concurrency';
import PricelistsTab from '@/components/admin/PricelistsTab';
import ConfirmDeleteDialog from '@/components/admin/ConfirmDeleteDialog';
import ConfirmActionDialog from '@/components/admin/ConfirmActionDialog';
import DayDividerRow from '@/components/admin/DayDivider';
import EasyshipSyncDialog from '@/components/admin/EasyshipSyncDialog';
import ExportInvoiceDialog from '@/components/admin/ExportInvoiceDialog';
import FulfillmentSelect from '@/components/admin/FulfillmentSelect';
import RecordPaymentDialog from '@/components/admin/RecordPaymentDialog';
import ReversePaymentDialog from '@/components/admin/ReversePaymentDialog';
import ActionTooltip from '@/components/admin/ActionTooltip';
import Checkbox from '@/components/admin/Checkbox';
import PaymentMethodBadge from '@/components/admin/PaymentMethodBadge';
import { groupByDay, toLocalDate } from '@/lib/dayGroups';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { canDelete } from '@/lib/permissions';

/**
 * Derive an invoice row's shipping state from its bound order. The invoice's own
 * fulfillment_type is authoritative for pickup (it mirrors the order), and the
 * order carries the Easyship shipment + tracking fields.
 */
function invoiceShippingOrder(inv: InvoiceListItem): ShippingStatusOrder {
  const os = inv.order_shipment;
  return {
    fulfillment_type: inv.fulfillment_type ?? os?.fulfillment_type ?? null,
    notes: os?.notes ?? null,
    easyship_shipment_id: os?.easyship_shipment_id ?? null,
    tracking_number: os?.tracking_number ?? null,
  };
}

/**
 * Guest customers (who checked out without creating an account) are given a
 * synthetic `@aminocan.local` email. We surface those as a "Guest Customer"
 * badge rather than showing the internal placeholder address.
 */
function isGuestEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith('@aminocan.local');
}

/** Whether a label can be bought for this invoice's order right now. */
function isLabelEligible(inv: InvoiceListItem): boolean {
  const os = inv.order_shipment;
  if (!os?.order_id || !os.easyship_shipment_id) return false;
  if (shippingState(invoiceShippingOrder(inv)) === 'pickup') return false;
  return os.label_state !== 'generated';
}

type Tab = 'invoices' | 'prepaid' | 'pricelists';

// A single customer-name suggestion for the search box autocomplete.
type CustomerSuggestion = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

// Selectable page sizes. Default is 20 rows per page (a larger page can be
// chosen from the "Rows" picker, which is persisted per-browser).
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_STORAGE_KEY = 'admin.invoices.pageSize';
const EMPTY_STATS: InvoiceStats = { count: 0, outstanding: 0, overdueCount: 0, paid: 0 };

// The status filter is a segmented toggle group (like the admin/customers page).
// Besides the real invoice statuses it offers "outstanding" — a virtual filter
// for every unpaid invoice (the server maps it to sent/partial/overdue).
type StatusFilter = InvoiceStatus | 'all' | 'outstanding';
const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'partial', label: 'Partial' },
  { value: 'cancelled', label: 'Cancelled' },
];
const STATUS_FILTER_VALUES = STATUS_FILTER_OPTIONS.map((o) => o.value);
// Coerce an arbitrary (URL/storage) string to a known filter, defaulting to All.
function toStatusFilter(v: string | null | undefined): StatusFilter {
  return v && (STATUS_FILTER_VALUES as string[]).includes(v) ? (v as StatusFilter) : 'all';
}

// "Source" filter — who entered the invoice (admin / client / online), plus All.
type SourceFilter = 'all' | InvoiceSource;
const SOURCE_FILTER_VALUES = INVOICE_SOURCE_FILTER_OPTIONS.map((o) => o.value);
function toSourceFilter(v: string | null | undefined): SourceFilter {
  return v && (SOURCE_FILTER_VALUES as string[]).includes(v) ? (v as SourceFilter) : 'all';
}

// "Currency" filter — the money the invoice is billed in (CAD / USD), plus All.
type CurrencyFilter = 'all' | InvoiceCurrency;
const CURRENCY_FILTER_VALUES = INVOICE_CURRENCY_FILTER_OPTIONS.map((o) => o.value);
function toCurrencyFilter(v: string | null | undefined): CurrencyFilter {
  return v && (CURRENCY_FILTER_VALUES as string[]).includes(v) ? (v as CurrencyFilter) : 'all';
}

// The list view's transient state (filters, page, scroll) is mirrored into
// sessionStorage so opening an invoice and coming back — via the browser Back
// button OR the detail page's in-app back arrow (which links to a bare
// /admin/invoices, dropping the query string) — restores exactly what you were
// looking at, including the scroll position.
const VIEW_STATE_STORAGE_KEY = 'admin.invoices.viewState';

interface InvoicesViewState {
  tab?: Tab;
  q?: string;
  status?: string;
  source?: string;
  currency?: string;
  page?: number;
  scrollY?: number;
  /** Id of the last invoice opened from the list, so its row can be briefly
   *  highlighted when you return. Consumed (cleared) once shown. */
  lastOpened?: string;
}

function readViewState(): InvoicesViewState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(VIEW_STATE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as InvoicesViewState) : null;
  } catch {
    return null;
  }
}

// Merge a partial update into the stored view state (read-modify-write) so the
// scroll listener and the filter effect can each persist their own slice
// without clobbering the other's.
function patchViewState(patch: InvoicesViewState) {
  if (typeof window === 'undefined') return;
  try {
    const cur = readViewState() ?? {};
    sessionStorage.setItem(VIEW_STATE_STORAGE_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {
    /* ignore */
  }
}

// Remember which invoice was just opened from the list so its row can be
// briefly marked when the user returns.
function markInvoiceOpened(id: string) {
  patchViewState({ lastOpened: id });
}

function InvoicesIndex() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const userRole = useUserRole();
  // Admin/assistant see all aging; affiliates see aging scoped to their own
  // customers (the /api/admin/invoices/aging route enforces that scoping).
  const canSeeAging = userRole === 'admin' || userRole === 'assistant' || userRole === 'affiliate';

  // Resolve the starting view once: the URL wins (so a shared/bookmarked link
  // opens exactly that view), otherwise fall back to the sessionStorage snapshot
  // so returning from an invoice restores the last filters, page and scroll. The
  // active view is also written back to the URL whenever it changes (below).
  const [initialView] = useState(() => {
    const saved = readViewState();
    const urlTab = searchParams.get('tab');
    const requestedTab: Tab =
      urlTab === 'prepaid' || urlTab === 'pricelists' || urlTab === 'invoices'
        ? (urlTab as Tab)
        : saved?.tab === 'prepaid' || saved?.tab === 'pricelists' || saved?.tab === 'invoices'
          ? saved.tab
          : 'invoices';
    // Affiliates must never land on the Pricelists (pricing) tab, even via a
    // bookmarked ?tab=pricelists link or a persisted view snapshot.
    const tab: Tab =
      userRole === 'affiliate' && requestedTab === 'pricelists' ? 'invoices' : requestedTab;
    const q = searchParams.get('q') ?? saved?.q ?? '';
    const status = toStatusFilter(searchParams.get('status') ?? saved?.status);
    const source = toSourceFilter(searchParams.get('source') ?? saved?.source);
    const currency = toCurrencyFilter(searchParams.get('currency') ?? saved?.currency);
    const page = typeof saved?.page === 'number' && saved.page > 0 ? saved.page : 0;
    const scrollY = typeof saved?.scrollY === 'number' && saved.scrollY > 0 ? saved.scrollY : 0;
    return { tab, q, status, source, currency, page, scrollY };
  });

  const [tab, setTab] = useState<Tab>(initialView.tab);
  // The Invoices and Prepaid tabs share the same list UI, filtered by type.
  const isPrepaidTab = tab === 'prepaid';
  const [rows, setRows] = useState<InvoiceListItem[]>([]);
  const [stats, setStats] = useState<InvoiceStats>(EMPTY_STATS);
  const [total, setTotal] = useState(0);
  const [aging, setAging] = useState<AgingBucket[]>([]);
  const [showAging, setShowAging] = useState(false);
  const [search, setSearch] = useState(initialView.q);
  const [debouncedSearch, setDebouncedSearch] = useState(initialView.q.trim());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialView.status);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(initialView.source);
  const [currencyFilter, setCurrencyFilter] = useState<CurrencyFilter>(initialView.currency);
  const [page, setPage] = useState(initialView.page);
  // Editable page size (persisted per-browser). Read once on mount so SSR and
  // the first client render agree on DEFAULT_PAGE_SIZE.
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  useEffect(() => {
    const saved = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    if (PAGE_SIZE_OPTIONS.includes(saved as any)) setPageSize(saved);
  }, []);
  const changePageSize = (size: number) => {
    setPageSize(size);
    setPage(0);
    try { localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size)); } catch { /* ignore */ }
  };
  const [loading, setLoading] = useState(true);

  // --- Customer-name autocomplete for the search box ------------------------
  // Only admins/assistants can query the full customer table client-side (same
  // as the invoice form); affiliates keep a plain search box since their list is
  // server-scoped to their own customers.
  const canAutocomplete = userRole === 'admin' || userRole === 'assistant';
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  // Set right after picking a suggestion so the fetch effect (which reacts to
  // the search value we just set) doesn't immediately reopen the dropdown.
  const suppressSuggestRef = useRef(false);

  // Only admins can delete; assistants/affiliates never see the controls.
  const canManageDelete = canDelete(userRole);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  // Bumped after a delete (or a bulk shipping action) to force a refetch.
  const [refreshKey, setRefreshKey] = useState(0);

  // Per-row shipping-column status while a bulk shipment/label action runs,
  // keyed by invoice id → the label shown next to the spinner.
  const [rowBusy, setRowBusy] = useState<Record<string, string>>({});
  const markRowBusy = (id: string, label: string) =>
    setRowBusy((prev) => ({ ...prev, [id]: label }));
  const clearRowBusy = (id: string) =>
    setRowBusy((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  // Inline fulfillment-status change from the Shipping column. Optimistic —
  // reverts the row if the PATCH fails.
  const [savingFulfillment, setSavingFulfillment] = useState<Record<string, boolean>>({});
  const handleFulfillmentChange = async (inv: InvoiceListItem, status: FulfillmentStatus) => {
    const prev = inv.fulfillment_status;
    if (prev === status) return;
    setRows((rs) => rs.map((r) => (r.id === inv.id ? { ...r, fulfillment_status: status } : r)));
    setSavingFulfillment((s) => ({ ...s, [inv.id]: true }));
    try {
      await setInvoiceFulfillmentStatus(inv.id, status);
    } catch {
      setRows((rs) => rs.map((r) => (r.id === inv.id ? { ...r, fulfillment_status: prev } : r)));
    } finally {
      setSavingFulfillment((s) => ({ ...s, [inv.id]: false }));
    }
  };

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

  // Easyship sync dialog (admin only) — pull shipments by date, match by name.
  const [syncOpen, setSyncOpen] = useState(false);
  const isAdmin = userRole === 'admin';

  // Bulk "export to another site" dialog (admin only).
  const [exportOpen, setExportOpen] = useState(false);

  // Per-row quick "record payment" — the invoice whose payment dialog is open.
  const [payTarget, setPayTarget] = useState<InvoiceListItem | null>(null);
  // Per-row quick "reverse payment" — the invoice whose reversal dialog is open.
  const [reverseTarget, setReverseTarget] = useState<InvoiceListItem | null>(null);

  // Mirror the active filters into the URL query string (replace, so it doesn't
  // stack history entries). Defaults are omitted to keep the URL clean.
  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== 'invoices') params.set('tab', tab);
    if (search) params.set('q', search);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (sourceFilter !== 'all') params.set('source', sourceFilter);
    if (currencyFilter !== 'all') params.set('currency', currencyFilter);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [tab, search, statusFilter, sourceFilter, currencyFilter, pathname, router]);

  // Persist the active filters + page into sessionStorage so returning to the
  // list (even via the detail page's bare-URL back link) restores them.
  useEffect(() => {
    patchViewState({ tab, q: search, status: statusFilter, source: sourceFilter, currency: currencyFilter, page });
  }, [tab, search, statusFilter, sourceFilter, currencyFilter, page]);

  // Debounce the search box and reset to the first page when the query changes.
  // Skip the first run so a restored page/scroll isn't reset back to page 0 on
  // mount (the debounced value is already seeded from the restored query).
  const skipSearchReset = useRef(true);
  useEffect(() => {
    if (skipSearchReset.current) {
      skipSearchReset.current = false;
      return;
    }
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to the first page whenever the status filter or tab changes — but not
  // on the initial mount, so a restored page survives.
  const skipFilterReset = useRef(true);
  useEffect(() => {
    if (skipFilterReset.current) {
      skipFilterReset.current = false;
      return;
    }
    setPage(0);
  }, [statusFilter, sourceFilter, currencyFilter, isPrepaidTab]);

  // Save the scroll position as the user scrolls (throttled to one write per
  // frame) so it can be restored when returning to the list.
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        patchViewState({ scrollY: window.scrollY });
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Restore the saved scroll position once the first page of rows has loaded
  // (the document isn't tall enough to scroll before then). Only once, on mount.
  const pendingScrollRef = useRef(initialView.scrollY);
  const didRestoreScrollRef = useRef(false);
  useEffect(() => {
    if (didRestoreScrollRef.current || loading) return;
    didRestoreScrollRef.current = true;
    const y = pendingScrollRef.current;
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [loading]);

  // Temporarily mark the row of the invoice you last opened from the list, so
  // it's easy to spot on return (pairs with the restored scroll position).
  const [markedId, setMarkedId] = useState<string | null>(null);
  useEffect(() => {
    // Consume the marker once on mount so a manual refresh doesn't re-highlight.
    const saved = readViewState();
    if (saved?.lastOpened) {
      setMarkedId(saved.lastOpened);
      patchViewState({ lastOpened: undefined });
    }
  }, []);
  useEffect(() => {
    // Fade the highlight a few seconds after the rows are actually on screen.
    if (!markedId || loading) return;
    const t = setTimeout(() => setMarkedId(null), 4000);
    return () => clearTimeout(t);
  }, [markedId, loading]);

  // Fetch customer-name suggestions as the user types (debounced). Mirrors the
  // invoice form's customer search: per-word AND-of-OR ilike, then rank locally
  // so the best name matches win the few visible slots.
  useEffect(() => {
    if (!canAutocomplete) return;
    if (suppressSuggestRef.current) {
      suppressSuggestRef.current = false;
      return;
    }
    const q = search.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const tokens = q.split(/\s+/).map((w) => w.replace(/[(),]/g, '')).filter(Boolean);
      if (tokens.length === 0) return;
      let query = supabase
        .from('customers')
        .select('id, first_name, last_name, email')
        .eq('active', true);
      for (const tok of tokens) {
        const like = `%${tok}%`;
        query = query.or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`);
      }
      const { data } = await query.limit(50);
      if (cancelled) return;
      // Rank by relevance, then dedupe by display name and keep the top few.
      const ranked = rankNameMatches((data ?? []) as CustomerSuggestion[], q);
      const seen = new Set<string>();
      const unique: CustomerSuggestion[] = [];
      for (const c of ranked) {
        const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim().toLowerCase();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        unique.push(c);
        if (unique.length >= 6) break;
      }
      setSuggestions(unique);
      setActiveSuggestion(-1);
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, canAutocomplete]);

  // Close the suggestions dropdown on an outside click.
  useEffect(() => {
    if (!canAutocomplete) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [canAutocomplete]);

  // Pick a suggestion: drop its display name into the search box (which filters
  // the list) and close the dropdown without triggering another fetch.
  const applySuggestion = (c: CustomerSuggestion) => {
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
    suppressSuggestRef.current = true;
    setSearch(name);
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestion((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestion((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeSuggestion >= 0 && activeSuggestion < suggestions.length) {
        e.preventDefault();
        applySuggestion(suggestions[activeSuggestion]);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  // Server-side paginated fetch (status + search + page).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelected(new Set());
    getInvoices({
      status: statusFilter !== 'all' ? statusFilter : undefined,
      invoice_type: isPrepaidTab ? 'prepaid' : 'standard',
      created_source: sourceFilter !== 'all' ? sourceFilter : undefined,
      currency: currencyFilter !== 'all' ? currencyFilter : undefined,
      q: debouncedSearch || undefined,
      limit: pageSize,
      offset: page * pageSize,
    })
      .then((res) => {
        if (cancelled) return;
        setRows(res.invoices);
        setTotal(res.total);
        setStats(res.stats);
      })
      .catch((err) => {
        if (cancelled) return;
        // Never leave the page stuck in a loading spinner on error.
        console.error('Failed to load invoices:', err);
        setRows([]);
        setTotal(0);
        setStats(EMPTY_STATS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [statusFilter, sourceFilter, currencyFilter, debouncedSearch, page, pageSize, refreshKey, isPrepaidTab]);

  // Aging report is an admin/assistant tool; load it once for them only.
  useEffect(() => {
    if (!canSeeAging) return;
    getAgingReport().then(setAging).catch(() => {});
  }, [canSeeAging]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(total, (page + 1) * pageSize);
  const hasFilters =
    debouncedSearch.length > 0 ||
    statusFilter !== 'all' ||
    sourceFilter !== 'all' ||
    currencyFilter !== 'all';
  // Split the current page of invoices into per-day groups (by issue date) so
  // the table shows a readable date divider between days.
  const invoiceGroups = groupByDay(rows, (r) => r.issue_date);
  const invoiceColSpan = (canManageDelete ? 1 : 0) + 7;

  const openPdf = async (id: string, download = false) => {
    const { data: { session } } = await supabase.auth.getSession();
    const url = `/api/admin/invoices/${id}/pdf${download ? '?download=1' : ''}`;
    const res = await fetch(url, {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
    if (!res.ok) return alert('Could not open invoice PDF');
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  };

  // Selection is keyed by invoice id. "Select all" toggles the current page.
  const pageIds = rows.map((r) => r.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const somePageSelected = pageIds.some((id) => selected.has(id)) && !allPageSelected;
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

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteInvoices(deleteTarget);
      setDeleting(false);
      setDeleteTarget(null);
      setSelected(new Set());
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete invoices');
      setDeleting(false);
    }
  };

  // --- Bulk shipping (operates on each invoice's bound order) ---------------
  // Selection is per-page (cleared on each fetch), so `rows` holds every
  // selected invoice.
  const selectedInvoices = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected],
  );
  // Only invoices bound to an order can have a shipment; keep an order id →
  // invoice map so bulk results (keyed by order id) map back to the right row.
  const selectedOrderInvoices = useMemo(
    () => selectedInvoices.filter((i) => i.order_shipment?.order_id),
    [selectedInvoices],
  );
  const orderToInvoice = useMemo(() => {
    const m = new Map<string, InvoiceListItem>();
    for (const inv of selectedOrderInvoices) {
      if (inv.order_shipment?.order_id) m.set(inv.order_shipment.order_id, inv);
    }
    return m;
  }, [selectedOrderInvoices]);
  const labelEligible = useMemo(
    () => selectedInvoices.filter(isLabelEligible),
    [selectedInvoices],
  );
  const anyBulkRunning = runningShipments || runningLabels;

  const openShipmentDialog = async () => {
    setShipmentError('');
    setShipmentPreview([]);
    setShipmentPreviewLoading(true);
    const orderIds = selectedOrderInvoices.map((i) => i.order_shipment!.order_id);
    const res = await getBulkShipmentReadiness(orderIds);
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
      const busyId = orderToInvoice.get(row.id)?.id ?? row.id;
      markRowBusy(busyId, 'Creating shipment…');
      const res = await createOrderShipment(row.id);
      if (res.success) ok++;
      else failed++;
      clearRowBusy(busyId);
    });
    setRunningShipments(false);
    setShipmentPreview(null);
    setBulkNotice(
      `Created ${ok} shipment${ok !== 1 ? 's' : ''}` +
        (failed ? ` · ${failed} failed` : '') +
        '.',
    );
    setRefreshKey((k) => k + 1);
  };

  const runBulkLabels = async () => {
    if (labelEligible.length === 0) return;
    setRunningLabels(true);
    setLabelError('');
    let generated = 0;
    let pending = 0;
    let failed = 0;
    await runPool(labelEligible, 4, async (inv) => {
      markRowBusy(inv.id, 'Buying label…');
      const res = await buyOrderLabel(inv.order_shipment!.order_id);
      if (!res.success) failed++;
      else if (res.labelState === 'generated') generated++;
      else pending++;
      clearRowBusy(inv.id);
    });
    setRunningLabels(false);
    setLabelDialogOpen(false);
    setBulkNotice(
      `Bought ${generated + pending} label${generated + pending !== 1 ? 's' : ''}` +
        (pending ? ` · ${pending} still generating` : '') +
        (failed ? ` · ${failed} failed` : '') +
        '.',
    );
    setRefreshKey((k) => k + 1);
  };

  const shipmentEligible = (shipmentPreview ?? []).filter((r) => r.eligible);
  const shipmentSkipped = (shipmentPreview ?? []).filter((r) => !r.eligible);
  // Show the invoice number for a skipped row when we can map it back.
  const skippedLabel = (row: BulkShipmentReadinessRow): string =>
    orderToInvoice.get(row.id)?.invoice_number ?? row.orderNumber ?? row.id.slice(0, 8);

  return (
    <>
      {/* Tabs — scroll horizontally on narrow screens so the three tabs never
          wrap or clip; unchanged (fits on one row) at desktop widths. */}
      <div className="flex items-center gap-1 mb-6 border-b border-line overflow-x-auto scrollbar-hide">
        <TabButton active={tab === 'invoices'} onClick={() => setTab('invoices')} icon={FileText}>
          Invoices
        </TabButton>
        <TabButton active={tab === 'prepaid'} onClick={() => setTab('prepaid')} icon={Package}>
          Prepaid Invoice
        </TabButton>
        {userRole !== 'affiliate' && (
          <TabButton active={tab === 'pricelists'} onClick={() => setTab('pricelists')} icon={Tag}>
            Pricelists
          </TabButton>
        )}
      </div>

      {tab === 'pricelists' && userRole !== 'affiliate' ? (
        <PricelistsTab />
      ) : (
      <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            {isPrepaidTab ? <Package className="w-6 h-6 text-bronze" /> : <FileText className="w-6 h-6 text-bronze" />}
            {isPrepaidTab ? 'Prepaid Invoices' : 'Invoices'}
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            {isPrepaidTab
              ? `${stats.count} prepaid invoice${stats.count !== 1 ? 's' : ''} · client pays up front, we procure from suppliers`
              : `${stats.count} invoice${stats.count !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSeeAging && (
            <button
              onClick={() => setShowAging((v) => !v)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-colors ${
                showAging
                  ? 'bg-bronze/10 border border-bronze text-bronze'
                  : 'bg-white border border-line text-ink-muted hover:text-ink hover:border-ink/20'
              }`}
            >
              <BarChart2 className="w-4 h-4" /> Aging
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setSyncOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm bg-white border border-line text-ink-muted hover:text-ink hover:border-ink/20 transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Sync Easyship
            </button>
          )}
          {/* Affiliates may create invoices too — the create endpoint scopes
              them to their own bound customers. */}
          <Link
            href={isPrepaidTab ? '/admin/invoices/new?type=prepaid' : '/admin/invoices/new'}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> {isPrepaidTab ? 'New Prepaid Invoice' : 'New Invoice'}
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total" value={stats.count} />
        <StatCard label="Outstanding" value={`$${stats.outstanding.toFixed(2)}`} highlight />
        <StatCard label="Overdue" value={stats.overdueCount} tone={stats.overdueCount > 0 ? 'danger' : 'normal'} />
        <StatCard label="Paid" value={stats.paid} />
      </div>

      {/* Aging panel */}
      {showAging && (
        <div className="bg-white rounded-xl border border-line p-5 mb-6">
          <h3 className="text-sm font-semibold text-ink mb-3">Accounts Receivable Aging</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 sm:divide-x divide-line/50 border border-line rounded-lg overflow-hidden">
            {aging.map((b) => (
              <div key={b.label} className="px-3 py-3 text-center bg-surface">
                <div className="text-[10px] uppercase tracking-wider text-ink-muted">{b.label}</div>
                <div className="mt-1 text-lg font-bold text-ink tabular-nums">${b.total.toFixed(2)}</div>
                <div className="text-xs text-ink-muted">{b.count} inv.</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-right text-sm">
            <span className="text-ink-muted">Grand total: </span>
            <span className="font-semibold text-ink tabular-nums">
              ${aging.reduce((s, b) => s + b.total, 0).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 mb-6">
        <div ref={searchBoxRef} className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder="Search by invoice # or customer..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShowSuggestions(true); }}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            onKeyDown={onSearchKeyDown}
            autoComplete="off"
            role="combobox"
            aria-expanded={canAutocomplete && showSuggestions && suggestions.length > 0}
            aria-autocomplete="list"
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-bronze/40"
          />
          {canAutocomplete && showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-30 mt-1 w-full bg-white border border-line rounded-lg shadow-lg max-h-72 overflow-auto">
              {suggestions.map((c, i) => {
                const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
                const showEmail = c.email && !isGuestEmail(c.email);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applySuggestion(c)}
                    onMouseEnter={() => setActiveSuggestion(i)}
                    className={`w-full text-left px-4 py-2.5 text-sm border-b border-line/50 last:border-0 transition-colors ${
                      i === activeSuggestion ? 'bg-surface' : 'hover:bg-surface'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <UserRound className="w-3.5 h-3.5 text-ink-muted flex-shrink-0" />
                      <span className="font-medium text-ink">{name}</span>
                    </div>
                    {showEmail && (
                      <div className="text-xs text-ink-muted mt-0.5 pl-[22px]">{c.email}</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Status filter toggles (segmented, like the admin/customers page). */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-light shrink-0">Status</span>
          <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-white p-0.5">
            {STATUS_FILTER_OPTIONS.map((o) => {
              const active = statusFilter === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setStatusFilter(o.value)}
                  aria-pressed={active}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                    active ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink hover:bg-surface'
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Source + Currency share a row (each is a short set of options), so the
            filters flow across instead of stacking a third control below Status.
            Collapses back to two stacked rows on narrow screens. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-x-8">
          {/* Source filter — who entered the invoice (Admin / Client / Online). */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-light shrink-0">Source</span>
            <div role="group" aria-label="Filter by source" className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-white p-0.5">
              {INVOICE_SOURCE_FILTER_OPTIONS.map((o) => {
                const active = sourceFilter === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setSourceFilter(o.value)}
                    aria-pressed={active}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      active ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink hover:bg-surface'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Currency filter — the money the invoice is billed in (CAD / USD). */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-light shrink-0">Currency</span>
            <div role="group" aria-label="Filter by currency" className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-white p-0.5">
              {INVOICE_CURRENCY_FILTER_OPTIONS.map((o) => {
                const active = currencyFilter === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setCurrencyFilter(o.value)}
                    aria-pressed={active}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                      active ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink hover:bg-surface'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
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
              disabled={anyBulkRunning || selectedOrderInvoices.length === 0}
              title={
                selectedOrderInvoices.length === 0
                  ? 'None of the selected invoices have a linked order to ship'
                  : undefined
              }
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
                  ? 'None of the selected invoices have a shipment awaiting a label'
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
            {isAdmin && (
              <button
                onClick={() => setExportOpen(true)}
                disabled={anyBulkRunning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-line text-ink text-sm font-medium hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ExternalLink className="w-4 h-4" /> Export to site
              </button>
            )}
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

      {/* Table (desktop ≥lg) / cards (mobile). Per ADR 0007: the desktop table
          is untouched — just hidden below lg — and a purpose-built card list
          renders the same rows for phones instead of a horizontal scroll. */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[840px]">
            <thead>
              <tr className="border-b border-line">
                {canManageDelete && (
                  <th className="px-5 py-3 w-10">
                    <Checkbox
                      ariaLabel="Select all on this page"
                      checked={allPageSelected}
                      indeterminate={somePageSelected}
                      onChange={toggleSelectAllPage}
                    />
                  </th>
                )}
                {['Invoice', 'Customer', 'Due', 'Total', 'Status', 'Shipping', ''].map((h, i) => (
                  <th key={h || `col-${i}`} className="px-5 py-3 text-left text-[8.4px] font-semibold text-ink-muted uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} withCheckbox={canManageDelete} />)
              ) : rows.length === 0 ? (
                <tr><td colSpan={invoiceColSpan} className="px-5 py-12 text-center text-sm text-ink-muted">
                  {hasFilters ? 'No invoices match your filters' : 'No invoices yet'}
                </td></tr>
              ) : invoiceGroups.map((group) => (
                <React.Fragment key={group.key}>
                  <DayDividerRow colSpan={invoiceColSpan} label={group.label} count={group.items.length} />
                  {group.items.map((inv) => {
                const effective = inv.status_effective ?? inv.status;
                const meta = INVOICE_STATUS_META[effective];
                const isOverdueRow = effective === 'overdue';
                return (
                  <tr
                    key={inv.id}
                    onClick={() => { markInvoiceOpened(inv.id); router.push(`/admin/invoices/${inv.id}`); }}
                    className={`transition-colors cursor-pointer ${
                      inv.id === markedId ? 'bg-bronze/10' : 'hover:bg-surface'
                    }`}
                  >
                    {canManageDelete && (
                      <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          ariaLabel={`Select invoice ${inv.invoice_number}`}
                          checked={selected.has(inv.id)}
                          onChange={() => toggleSelect(inv.id)}
                        />
                      </td>
                    )}
                    <td className="px-5 py-4">
                      <Link href={`/admin/invoices/${inv.id}`} className="font-mono text-[9.8px] text-ink hover:text-bronze">
                        {inv.invoice_number}
                      </Link>
                      {inv.is_backorder && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[7px] font-semibold bg-amber-100 text-amber-700 align-middle">
                          Backorder
                        </span>
                      )}
                      {/* Source tag — who entered the invoice (Admin / Client /
                          Online), with the creator's name beside it when known.
                          Hidden for legacy rows with no creator on record. */}
                      {(() => {
                        const src = invoiceSourceMeta(inv.created_by_role);
                        if (!src) return null;
                        return (
                          <div className="mt-1 flex items-center gap-1.5">
                            <span
                              title={src.description}
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[7px] font-semibold ${src.badge}`}
                            >
                              {src.label}
                            </span>
                            {inv.created_by_name && (
                              <span
                                title={`${src.description} — ${inv.created_by_name}`}
                                className="text-[7.7px] text-ink-muted truncate max-w-[10rem]"
                              >
                                {inv.created_by_name}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9.8px] text-ink">{inv.customer_name_display ?? '—'}</span>
                        {inv.customer_deleted && (
                          <span
                            title="This customer's record has been deleted"
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] font-semibold bg-red-100 text-red-600 align-middle whitespace-nowrap"
                          >
                            <Trash2 className="w-2.5 h-2.5" /> Deleted
                          </span>
                        )}
                      </div>
                      {inv.customer_email_display && (
                        isGuestEmail(inv.customer_email_display) ? (
                          <span
                            title="Guest customer — checked out without creating an account (no login)"
                            className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[7.7px] font-medium bg-surface-2 text-ink-muted border border-line/70"
                          >
                            <UserRound className="w-3 h-3 flex-shrink-0" /> Guest Customer
                          </span>
                        ) : (
                          <div className="text-[8.4px] text-ink-muted">{inv.customer_email_display}</div>
                        )
                      )}
                      {inv.ships_to_client && inv.client && (() => {
                        const clientName =
                          [inv.client.first_name, inv.client.last_name].filter(Boolean).join(' ') || 'client';
                        const clientPlace = [inv.client.city, inv.client.state]
                          .filter(Boolean)
                          .join(', ');
                        return (
                          <div
                            className="mt-0.5 flex items-center gap-1 text-[7.7px] text-bronze"
                            title={`Ships to client: ${clientName}${clientPlace ? ` — ${clientPlace}` : ''}`}
                          >
                            <Users className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">
                              Ship to {clientName}{clientPlace ? ` · ${clientPlace}` : ''}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className={`px-5 py-4 text-[9.8px] whitespace-nowrap ${isOverdueRow ? 'text-red-600 font-medium' : 'text-ink-muted'}`}>
                      {toLocalDate(inv.due_date).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className="text-[9.8px] font-semibold text-ink tabular-nums">${Number(inv.total).toFixed(2)}</span>
                        {/* Currency tag — a "$" alone is ambiguous since amounts
                            aren't converted, so mark CAD vs USD on every row. */}
                        {(() => {
                          const cur = invoiceCurrencyMeta(inv.currency);
                          return (
                            <span
                              title={cur.description}
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[7px] font-semibold ${cur.badge}`}
                            >
                              {cur.label}
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col items-start gap-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[8.4px] font-medium ${meta.badge}`}>{meta.label}</span>
                          {/* How the customer chose to pay on the emailed payment
                              page. Absent until a payment request is opened. */}
                          <PaymentMethodBadge method={inv.payment_method_selected} size="xs" />
                        </div>
                        {/* Quick "record payment" — one click opens the method
                            picker pre-filled with the amount still due. Admin
                            only; hidden once nothing is outstanding. */}
                        {isAdmin && Number(inv.amount_due ?? 0) > 0 && inv.status !== 'cancelled' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setPayTarget(inv); }}
                            title="Record a payment"
                            className="inline-flex items-center gap-1 text-[7.7px] font-medium text-emerald-700 hover:text-emerald-800"
                          >
                            <DollarSign className="w-3 h-3" /> Record payment
                          </button>
                        )}
                        {/* Quick "reverse payment" — shown once anything has been
                            paid, so an admin can undo a mistaken/paid status right
                            from the list. Removes a payment and re-derives the
                            invoice's status (paid → partial → sent). */}
                        {isAdmin && Number(inv.amount_paid ?? 0) > 0 && inv.status !== 'cancelled' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setReverseTarget(inv); }}
                            title="Reverse a payment"
                            className="inline-flex items-center gap-1 text-[7.7px] font-medium text-amber-700 hover:text-amber-800"
                          >
                            <Undo2 className="w-3 h-3" /> Reverse payment
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                      {rowBusy[inv.id] ? (
                        <span className="inline-flex items-center gap-1.5 text-[8.4px] text-bronze font-medium">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          {rowBusy[inv.id]}
                        </span>
                      ) : (() => {
                        const tracking = inv.order_shipment?.tracking_number;
                        const isPickup = inv.fulfillment_type === 'pickup';
                        // packed_photos is already on the row payload — count it
                        // for an at-a-glance badge without loading any images.
                        const photoCount = Array.isArray(inv.packed_photos) ? inv.packed_photos.length : 0;
                        return (
                          <div className="flex flex-col gap-1.5 items-start">
                            <FulfillmentSelect
                              value={(inv.fulfillment_status ?? 'pending') as FulfillmentStatus}
                              isPickup={isPickup}
                              disabled={!!savingFulfillment[inv.id]}
                              onChange={(status) => handleFulfillmentChange(inv, status)}
                              ariaLabel={`Fulfillment status for ${inv.invoice_number}`}
                            />
                            {(tracking || photoCount > 0) && (
                              <div className="flex items-center gap-1.5">
                                {tracking && (
                                  <span className="font-mono text-[7px] text-ink-muted">{tracking}</span>
                                )}
                                {photoCount > 0 && (
                                  <Link
                                    href={`/admin/invoices/${inv.id}`}
                                    onClick={(e) => { e.stopPropagation(); markInvoiceOpened(inv.id); }}
                                    title={`${photoCount} packed photo${photoCount === 1 ? '' : 's'}`}
                                    className="inline-flex items-center gap-1 pl-1.5 pr-2 py-0.5 rounded-full bg-surface border border-line/70 text-[7px] font-semibold text-ink-muted hover:text-ink hover:border-ink/20 transition-colors"
                                  >
                                    <Camera className="w-3 h-3" />
                                    <span className="tabular-nums">{photoCount}</span>
                                  </Link>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <ActionTooltip label="View">
                          <Link
                            href={`/admin/invoices/${inv.id}`}
                            onClick={() => markInvoiceOpened(inv.id)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Link>
                        </ActionTooltip>
                        <ActionTooltip label="View PDF">
                          <button
                            onClick={() => openPdf(inv.id, false)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        </ActionTooltip>
                        <ActionTooltip label="Download / Print">
                          <button
                            onClick={() => openPdf(inv.id, true)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </ActionTooltip>
                        {canManageDelete && (
                          <ActionTooltip label="Delete invoice">
                            <button
                              onClick={() => {
                                setDeleteError('');
                                setDeleteTarget([inv.id]);
                              }}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </ActionTooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards (below lg). Mirrors the table rows above — same data,
            handlers and dialogs — so phones get tappable cards instead of a
            horizontally-scrolling, micro-font table. See ADR 0007. */}
        <div className="lg:hidden">
          {loading ? (
            <div className="divide-y divide-line/50">
              {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-ink-muted">
              {hasFilters ? 'No invoices match your filters' : 'No invoices yet'}
            </div>
          ) : (
            <div>
              {invoiceGroups.map((group) => (
                <div key={group.key}>
                  {/* Day divider (card-list equivalent of DayDividerRow) */}
                  <div className="flex items-center gap-2 bg-surface/60 px-4 py-2 border-y border-line/70">
                    <CalendarDays className="w-3.5 h-3.5 text-ink-muted" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{group.label}</span>
                    <span className="inline-flex items-center justify-center min-w-[1.25rem] px-1 rounded-full text-[10px] font-semibold bg-white text-ink-muted border border-line">
                      {group.items.length}
                    </span>
                  </div>
                  <div className="divide-y divide-line/50">
                    {group.items.map((inv) => {
                      const effective = inv.status_effective ?? inv.status;
                      const meta = INVOICE_STATUS_META[effective];
                      const isOverdueRow = effective === 'overdue';
                      const cur = invoiceCurrencyMeta(inv.currency);
                      const src = invoiceSourceMeta(inv.created_by_role);
                      const tracking = inv.order_shipment?.tracking_number;
                      const isPickup = inv.fulfillment_type === 'pickup';
                      const photoCount = Array.isArray(inv.packed_photos) ? inv.packed_photos.length : 0;
                      const clientName = inv.client
                        ? [inv.client.first_name, inv.client.last_name].filter(Boolean).join(' ') || 'client'
                        : '';
                      const clientPlace = inv.client
                        ? [inv.client.city, inv.client.state].filter(Boolean).join(', ')
                        : '';
                      return (
                        <div
                          key={inv.id}
                          onClick={() => { markInvoiceOpened(inv.id); router.push(`/admin/invoices/${inv.id}`); }}
                          className={`px-4 py-3.5 transition-colors cursor-pointer ${
                            inv.id === markedId ? 'bg-bronze/10' : 'active:bg-surface'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {canManageDelete && (
                              <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  ariaLabel={`Select invoice ${inv.invoice_number}`}
                                  checked={selected.has(inv.id)}
                                  onChange={() => toggleSelect(inv.id)}
                                />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              {/* Invoice # + status */}
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                                  <span className="font-mono text-sm text-ink">{inv.invoice_number}</span>
                                  {inv.is_backorder && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">
                                      Backorder
                                    </span>
                                  )}
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  {/* How the customer chose to pay on the emailed
                                      payment page (absent until they choose). */}
                                  <PaymentMethodBadge method={inv.payment_method_selected} />
                                  <span className={`inline-flex shrink-0 px-2 py-0.5 rounded text-xs font-medium ${meta.badge}`}>{meta.label}</span>
                                </div>
                              </div>

                              {/* Source tag + creator */}
                              {src && (
                                <div className="mt-1 flex items-center gap-1.5">
                                  <span title={src.description} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${src.badge}`}>
                                    {src.label}
                                  </span>
                                  {inv.created_by_name && (
                                    <span className="text-xs text-ink-muted truncate">{inv.created_by_name}</span>
                                  )}
                                </div>
                              )}

                              {/* Customer */}
                              <div className="mt-1.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm text-ink">{inv.customer_name_display ?? '—'}</span>
                                  {inv.customer_deleted && (
                                    <span title="This customer's record has been deleted" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-600 whitespace-nowrap">
                                      <Trash2 className="w-2.5 h-2.5" /> Deleted
                                    </span>
                                  )}
                                </div>
                                {inv.customer_email_display && (
                                  isGuestEmail(inv.customer_email_display) ? (
                                    <span title="Guest customer — checked out without creating an account (no login)" className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-surface-2 text-ink-muted border border-line/70">
                                      <UserRound className="w-3 h-3 flex-shrink-0" /> Guest Customer
                                    </span>
                                  ) : (
                                    <div className="text-xs text-ink-muted truncate">{inv.customer_email_display}</div>
                                  )
                                )}
                                {inv.ships_to_client && inv.client && (
                                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-bronze" title={`Ships to client: ${clientName}${clientPlace ? ` — ${clientPlace}` : ''}`}>
                                    <Users className="w-3 h-3 flex-shrink-0" />
                                    <span className="truncate">Ship to {clientName}{clientPlace ? ` · ${clientPlace}` : ''}</span>
                                  </div>
                                )}
                              </div>

                              {/* Due + Total */}
                              <div className="mt-2.5 grid grid-cols-2 gap-2">
                                <div>
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-light">Due</div>
                                  <div className={`text-sm whitespace-nowrap ${isOverdueRow ? 'text-red-600 font-medium' : 'text-ink'}`}>
                                    {toLocalDate(inv.due_date).toLocaleDateString()}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-light">Total</div>
                                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                                    <span className="text-sm font-semibold text-ink tabular-nums">${Number(inv.total).toFixed(2)}</span>
                                    <span title={cur.description} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${cur.badge}`}>{cur.label}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Fulfillment / shipping */}
                              <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
                                {rowBusy[inv.id] ? (
                                  <span className="inline-flex items-center gap-1.5 text-xs text-bronze font-medium">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    {rowBusy[inv.id]}
                                  </span>
                                ) : (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <FulfillmentSelect
                                      value={(inv.fulfillment_status ?? 'pending') as FulfillmentStatus}
                                      isPickup={isPickup}
                                      disabled={!!savingFulfillment[inv.id]}
                                      onChange={(status) => handleFulfillmentChange(inv, status)}
                                      ariaLabel={`Fulfillment status for ${inv.invoice_number}`}
                                    />
                                    {tracking && (
                                      <span className="font-mono text-[10px] text-ink-muted">{tracking}</span>
                                    )}
                                    {photoCount > 0 && (
                                      <span className="inline-flex items-center gap-1 pl-1.5 pr-2 py-0.5 rounded-full bg-surface border border-line/70 text-[10px] font-semibold text-ink-muted">
                                        <Camera className="w-3 h-3" />
                                        <span className="tabular-nums">{photoCount}</span>
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Quick payment actions (admin) */}
                              {isAdmin && inv.status !== 'cancelled' && (Number(inv.amount_due ?? 0) > 0 || Number(inv.amount_paid ?? 0) > 0) && (
                                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5" onClick={(e) => e.stopPropagation()}>
                                  {Number(inv.amount_due ?? 0) > 0 && (
                                    <button onClick={() => setPayTarget(inv)} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800">
                                      <DollarSign className="w-3.5 h-3.5" /> Record payment
                                    </button>
                                  )}
                                  {Number(inv.amount_paid ?? 0) > 0 && (
                                    <button onClick={() => setReverseTarget(inv)} className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-800">
                                      <Undo2 className="w-3.5 h-3.5" /> Reverse payment
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Actions */}
                              <div className="mt-2 -ml-2.5 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                                <Link href={`/admin/invoices/${inv.id}`} onClick={() => markInvoiceOpened(inv.id)} aria-label="View invoice" className="w-11 h-11 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors">
                                  <ExternalLink className="w-4 h-4" />
                                </Link>
                                <button onClick={() => openPdf(inv.id, false)} aria-label="View PDF" className="w-11 h-11 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors">
                                  <FileText className="w-4 h-4" />
                                </button>
                                <button onClick={() => openPdf(inv.id, true)} aria-label="Download / Print" className="w-11 h-11 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors">
                                  <Download className="w-4 h-4" />
                                </button>
                                {canManageDelete && (
                                  <button onClick={() => { setDeleteError(''); setDeleteTarget([inv.id]); }} aria-label="Delete invoice" className="w-11 h-11 flex items-center justify-center rounded-lg text-ink-muted hover:text-red-500 hover:bg-red-500/10 transition-colors">
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
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {!loading && total > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 border-t border-line">
            <div className="flex items-center gap-3">
              <span className="text-sm text-ink-muted">
                Showing <span className="font-medium text-ink tabular-nums">{rangeStart}</span>–
                <span className="font-medium text-ink tabular-nums">{rangeEnd}</span> of{' '}
                <span className="font-medium text-ink tabular-nums">{total}</span>
              </span>
              <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                <span className="hidden sm:inline">Rows</span>
                <select
                  value={pageSize}
                  onChange={(e) => changePageSize(Number(e.target.value))}
                  aria-label="Rows per page"
                  className="bg-white border border-line rounded-lg pl-2 pr-6 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40 appearance-none cursor-pointer"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">Page {page + 1} of {totalPages}</span>
              <button
                onClick={() => setPage(0)}
                disabled={page === 0}
                title="First page"
                aria-label="First page"
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <button
                onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))}
                disabled={page + 1 >= totalPages}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(totalPages - 1)}
                disabled={page + 1 >= totalPages}
                title="Last page"
                aria-label="Last page"
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
      </>
      )}

      {deleteTarget && (
        <ConfirmDeleteDialog
          title={deleteTarget.length > 1 ? 'Delete Invoices' : 'Delete Invoice'}
          message={
            <>
              <p className="mb-2">
                You are about to permanently delete{' '}
                <span className="font-semibold text-ink">
                  {deleteTarget.length} invoice{deleteTarget.length !== 1 ? 's' : ''}
                </span>
                .
              </p>
              <p>
                The linked order is deleted too (invoices and orders are paired).{' '}
                <span className="font-semibold text-red-500">This cannot be undone.</span>
              </p>
            </>
          }
          confirmLabel={deleteTarget.length > 1 ? `Delete ${deleteTarget.length} invoices` : 'Delete invoice'}
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
                  {shipmentEligible.length !== 1 ? 's' : ''} will be created in Easyship for the
                  linked order{shipmentEligible.length !== 1 ? 's' : ''}.
                </p>
                {shipmentSkipped.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="font-medium text-amber-700 mb-1.5">
                      {shipmentSkipped.length} invoice{shipmentSkipped.length !== 1 ? 's' : ''} will be
                      skipped:
                    </p>
                    <ul className="space-y-1 max-h-48 overflow-y-auto">
                      {shipmentSkipped.map((r) => (
                        <li key={r.id} className="text-xs text-ink-muted">
                          <span className="font-mono text-ink">{skippedLabel(r)}</span>
                          {' — '}
                          {r.reason ?? 'Not eligible'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {shipmentEligible.length > 0 && (
                  <p className="text-xs">
                    Only the eligible invoices above will be created. You can continue or cancel.
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

      {/* Easyship sync — pull shipments by date, match to invoices by name */}
      {syncOpen && (
        <EasyshipSyncDialog
          onClose={() => setSyncOpen(false)}
          onApplied={(notice) => {
            setSyncOpen(false);
            setBulkNotice(notice);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {exportOpen && selected.size > 0 && (
        <ExportInvoiceDialog
          invoiceIds={Array.from(selected)}
          onClose={() => setExportOpen(false)}
          onDone={(summary) => {
            setBulkNotice(summary);
            setSelected(new Set());
          }}
        />
      )}

      {/* Per-row quick "record payment". On success, refetch so the status
          badge and outstanding total reflect the new payment. */}
      {payTarget && (
        <RecordPaymentDialog
          invoiceId={payTarget.id}
          invoiceNumber={payTarget.invoice_number}
          amountDue={Number(payTarget.amount_due ?? Math.max(0, Number(payTarget.total)))}
          customerEmail={payTarget.customer_email_display ?? payTarget.customer_email ?? null}
          onClose={() => setPayTarget(null)}
          onRecorded={(res) => {
            // Leave the dialog open on its result step (it closes via onClose);
            // refresh the list so the status badge/outstanding total update.
            setBulkNotice(
              res.email.requested
                ? res.email.sent
                  ? 'Payment recorded · confirmation email sent.'
                  : 'Payment recorded · confirmation email could not be sent.'
                : 'Payment recorded.',
            );
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {/* Per-row quick "reverse payment". Lists the invoice's payments and lets
          the admin undo one; on success, refetch so the status badge and
          outstanding total reflect the removed payment. */}
      {reverseTarget && (
        <ReversePaymentDialog
          invoiceId={reverseTarget.id}
          invoiceNumber={reverseTarget.invoice_number}
          onClose={() => setReverseTarget(null)}
          onReversed={(res) => {
            setBulkNotice(
              `Payment reversed · invoice is now ${INVOICE_STATUS_META[res.invoice.status].label}` +
                (res.stock_restored ? ' · stock restored.' : '.'),
            );
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}

export default function InvoicesIndexPage() {
  // InvoicesIndex reads the URL via useSearchParams, which Next requires to sit
  // inside a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <InvoicesIndex />
    </Suspense>
  );
}

function SkeletonRow({ withCheckbox = false }: { withCheckbox?: boolean }) {
  return (
    <tr className="animate-pulse">
      {withCheckbox && <td className="px-5 py-4"><div className="h-4 w-4 bg-surface rounded" /></td>}
      <td className="px-5 py-4"><div className="h-4 w-24 bg-surface rounded" /></td>
      <td className="px-5 py-4">
        <div className="h-3.5 w-32 bg-surface rounded mb-1.5" />
        <div className="h-3 w-40 bg-surface rounded" />
      </td>
      <td className="px-5 py-4"><div className="h-3.5 w-20 bg-surface rounded" /></td>
      <td className="px-5 py-4"><div className="h-4 w-16 bg-surface rounded" /></td>
      <td className="px-5 py-4"><div className="h-5 w-16 bg-surface rounded-full" /></td>
      <td className="px-5 py-4"><div className="h-5 w-20 bg-surface rounded-full" /></td>
      <td className="px-5 py-4">
        <div className="flex items-center gap-1">
          <div className="w-8 h-8 bg-surface rounded-lg" />
          <div className="w-8 h-8 bg-surface rounded-lg" />
          <div className="w-8 h-8 bg-surface rounded-lg" />
        </div>
      </td>
    </tr>
  );
}

// Mobile-only loading placeholder for the card list (below lg). Mirrors the
// desktop <SkeletonRow> but in the stacked-card shape.
function SkeletonCard() {
  return (
    <div className="px-4 py-3.5 animate-pulse">
      <div className="flex items-start justify-between gap-2">
        <div className="h-4 w-24 bg-surface rounded" />
        <div className="h-5 w-16 bg-surface rounded-full" />
      </div>
      <div className="mt-2 h-3.5 w-40 bg-surface rounded" />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="h-8 bg-surface rounded" />
        <div className="h-8 bg-surface rounded" />
      </div>
      <div className="mt-3 h-8 w-32 bg-surface rounded" />
    </div>
  );
}

function TabButton({
  active, onClick, icon: Icon, children,
}: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap shrink-0 transition-colors ${
        active
          ? 'border-bronze text-bronze'
          : 'border-transparent text-ink-muted hover:text-ink'
      }`}
    >
      <Icon className="w-4 h-4" /> {children}
    </button>
  );
}

function StatCard({
  label, value, highlight, tone = 'normal',
}: { label: string; value: string | number; highlight?: boolean; tone?: 'normal' | 'danger' }) {
  const valueColor =
    tone === 'danger'
      ? 'text-red-600'
      : highlight
        ? 'text-bronze'
        : 'text-ink';
  return (
    <div className={`bg-white rounded-xl border ${highlight ? 'border-bronze/40' : 'border-line'} p-4`}>
      <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${valueColor}`}>{value}</div>
    </div>
  );
}
