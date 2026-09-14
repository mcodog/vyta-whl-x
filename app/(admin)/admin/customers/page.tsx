'use client';

import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Search, Truck, Store, UserPlus, Pencil, Trash2, FileText, ChevronLeft,
  ChevronRight, ChevronDown, ArrowUpDown, MousePointerClick, Users, LockKeyhole,
  Check,
} from 'lucide-react';
import { updateCustomerFulfillment, deleteCustomer, sendCustomerPasswordReset } from '@/lib/admin/api';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { canEdit, canDelete, getRoleBadgeClasses, getRoleName } from '@/lib/permissions';
import type { UserRole } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { rankBySearch, byNewest } from '@/lib/search';
import TableSkeleton from '@/components/admin/TableSkeleton';
import CreateCustomerModal from './_components/CreateCustomerModal';
import EditCustomerModal from './_components/EditCustomerModal';
import DeletionReviewModal from '../_components/DeletionReviewModal';

const PAGE_SIZE = 20;

type AffiliateFilter = 'all' | 'with' | 'without';
type ActiveFilter = 'all' | 'active' | 'inactive';
type SortKey = 'clients' | 'recent' | 'oldest' | 'name' | 'invoices' | 'spend';

const SORT_LABELS: Record<SortKey, string> = {
  clients: 'Most ship-to clients',
  recent: 'Newest first',
  oldest: 'Oldest first',
  name: 'Name (A–Z)',
  invoices: 'Most invoices',
  spend: 'Highest invoiced',
};

// The list opens on the customers with the most ship-to clients (resellers
// first); ties fall back to newest.
const DEFAULT_SORT: SortKey = 'clients';

// The list's transient view (search, filters, sort, page, scroll) is mirrored to
// sessionStorage so returning from a customer — via the browser Back button OR
// the detail page's bare-URL back link — restores exactly what you were looking
// at, including scroll position.
const VIEW_KEY = 'admin.customers.viewState';

interface CustomerViewState {
  q?: string;
  affiliate?: AffiliateFilter;
  active?: ActiveFilter;
  sort?: SortKey;
  page?: number;
  scrollY?: number;
  /** Id of the last customer opened from the list, briefly highlighted on return. */
  lastOpened?: string;
}

function readViewState(): CustomerViewState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(VIEW_KEY);
    return raw ? (JSON.parse(raw) as CustomerViewState) : null;
  } catch {
    return null;
  }
}

function patchViewState(patch: CustomerViewState) {
  if (typeof window === 'undefined') return;
  try {
    const cur = readViewState() ?? {};
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch {
    /* ignore */
  }
}

function markCustomerOpened(id: string) {
  patchViewState({ lastOpened: id });
}

// ---- helpers -------------------------------------------------------------

function money(n: number) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function nameOf(c: any) {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email || '';
}

// Ship-to clients (end-recipients) attached to a customer. The API sends a
// count for every role and the client rows only to affiliates, so fall back to
// the rows' length if an older payload has no count.
function clientCountOf(c: any) {
  return typeof c.ship_to_client_count === 'number'
    ? c.ship_to_client_count
    : (c.ship_to_clients?.length ?? 0);
}

function initials(c: any) {
  const f = (c.first_name ?? '').trim();
  const l = (c.last_name ?? '').trim();
  const s = `${f.charAt(0)}${l.charAt(0)}`.trim();
  return (s || (c.email ?? '?').charAt(0)).toUpperCase();
}

// A segmented toggle-button group (replaces the old filter dropdowns).
function Segmented<T extends string>({
  options, value, onChange, ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex items-center rounded-lg border border-line bg-white p-0.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
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
  );
}

function AdminCustomers() {
  const userRole = useUserRole();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const isAffiliate = userRole === 'affiliate';
  const canCreateCustomer = userRole === 'admin' || userRole === 'affiliate';

  // Resolve the starting view once: the URL wins (bookmarkable/shareable),
  // otherwise the sessionStorage snapshot (so a return restores everything).
  const [initialView] = useState(() => {
    const saved = readViewState();
    const q = searchParams.get('q') ?? saved?.q ?? '';
    const affiliate = ((searchParams.get('affiliate') as AffiliateFilter | null) ?? saved?.affiliate ?? 'all') as AffiliateFilter;
    const active = ((searchParams.get('active') as ActiveFilter | null) ?? saved?.active ?? 'all') as ActiveFilter;
    const sort = (saved?.sort ?? DEFAULT_SORT) as SortKey;
    const page = typeof saved?.page === 'number' && saved.page > 0 ? saved.page : 0;
    const scrollY = typeof saved?.scrollY === 'number' && saved.scrollY > 0 ? saved.scrollY : 0;
    return { q, affiliate, active, sort, page, scrollY };
  });

  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialView.q);
  const [affiliateFilter, setAffiliateFilter] = useState<AffiliateFilter>(initialView.affiliate);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(initialView.active);
  const [sortKey, setSortKey] = useState<SortKey>(initialView.sort);
  const [page, setPage] = useState(initialView.page);
  const [togglingFulfillment, setTogglingFulfillment] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState<any | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [markedId, setMarkedId] = useState<string | null>(null);
  // Row id currently having a password-reset email sent, and the last one sent
  // (briefly shown as a checkmark).
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetSentId, setResetSentId] = useState<string | null>(null);

  // Sync active view into the URL + sessionStorage on change.
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (affiliateFilter !== 'all') params.set('affiliate', affiliateFilter);
    if (activeFilter !== 'all') params.set('active', activeFilter);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    patchViewState({ q: search, affiliate: affiliateFilter, active: activeFilter, sort: sortKey, page });
  }, [search, affiliateFilter, activeFilter, sortKey, page, pathname, router]);

  // Save scroll position (throttled to one write per frame) for restore.
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

  const downloadReport = async () => {
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (affiliateFilter !== 'all') params.set('affiliate', affiliateFilter);
      if (activeFilter !== 'all') params.set('active', activeFilter);
      const qs = params.toString();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch(`/api/admin/customers/report${qs ? `?${qs}` : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        toast.error('Could not generate the customer report');
        return;
      }
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } catch {
      toast.error('Could not generate the customer report');
    } finally {
      setDownloading(false);
    }
  };

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch('/api/admin/customers', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        toast.error('Failed to load customers');
        return;
      }
      const { customers: data } = await res.json();
      setCustomers(data || []);
    } catch {
      toast.error('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  // Restore saved scroll once rows are on screen (once, after first load).
  const pendingScrollRef = useRef(initialView.scrollY);
  const didRestoreScrollRef = useRef(false);
  useEffect(() => {
    if (didRestoreScrollRef.current || loading) return;
    didRestoreScrollRef.current = true;
    const y = pendingScrollRef.current;
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [loading]);

  // Consume the "last opened" marker once so a manual refresh doesn't re-flash.
  useEffect(() => {
    const saved = readViewState();
    if (saved?.lastOpened) {
      setMarkedId(saved.lastOpened);
      patchViewState({ lastOpened: undefined });
    }
  }, []);
  useEffect(() => {
    if (!markedId || loading) return;
    const t = setTimeout(() => setMarkedId(null), 4000);
    return () => clearTimeout(t);
  }, [markedId, loading]);

  const filtered = useMemo(() => {
    // Customers-only view (staff/affiliate accounts are managed under Users).
    let result = customers.filter((c) => (c.role || (c.is_admin ? 'admin' : 'customer')) === 'customer');

    if (affiliateFilter === 'with') result = result.filter((c) => c.affiliate_id);
    else if (affiliateFilter === 'without') result = result.filter((c) => !c.affiliate_id);

    if (activeFilter === 'active') result = result.filter((c) => c.active !== false);
    else if (activeFilter === 'inactive') result = result.filter((c) => c.active === false);

    const searching = search.trim().length > 0;
    if (searching) {
      result = rankBySearch(
        result,
        search,
        [
          { value: (c) => c.first_name, weight: 3 },
          { value: (c) => c.last_name, weight: 3 },
          { value: (c) => `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(), weight: 2 },
          { value: (c) => c.email, weight: 1 },
          { value: (c) => c.alternate_email, weight: 1 },
        ],
        byNewest,
      );
    }

    // Apply the chosen sort. While searching, the default sort keeps the
    // relevance ranking; any explicit sort overrides it.
    if (!(searching && sortKey === DEFAULT_SORT)) {
      const arr = [...result];
      const newest = (a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      switch (sortKey) {
        case 'clients': arr.sort((a, b) => (clientCountOf(b) - clientCountOf(a)) || newest(a, b)); break;
        case 'name': arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b))); break;
        case 'invoices': arr.sort((a, b) => ((b.invoice_count ?? 0) - (a.invoice_count ?? 0)) || newest(a, b)); break;
        case 'spend': arr.sort((a, b) => ((b.invoiced_total ?? 0) - (a.invoiced_total ?? 0)) || newest(a, b)); break;
        case 'oldest': arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); break;
        case 'recent':
        default: arr.sort(newest); break;
      }
      result = arr;
    }

    return result;
  }, [customers, search, affiliateFilter, activeFilter, sortKey]);

  // ---- pagination (client-side over the filtered list) --------------------
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Reset to the first page when the result set changes — but not on the initial
  // mount, so a restored page survives.
  const skipReset = useRef(true);
  useEffect(() => {
    if (skipReset.current) { skipReset.current = false; return; }
    setPage(0);
  }, [search, affiliateFilter, activeFilter, sortKey]);
  useEffect(() => {
    if (page > totalPages - 1) setPage(totalPages - 1);
  }, [page, totalPages]);
  const safePage = Math.min(page, totalPages - 1);
  const rangeStart = total === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (safePage + 1) * PAGE_SIZE);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const openCustomer = (id: string) => {
    markCustomerOpened(id);
    router.push(`/admin/customers/${id}`);
  };

  const handleToggleFulfillment = async (
    e: React.MouseEvent,
    customer: any,
    allowPickup: boolean,
    allowShipping: boolean,
    label: string,
  ) => {
    e.stopPropagation();
    setTogglingFulfillment(customer.id);
    const res = await updateCustomerFulfillment(customer.id, allowPickup, allowShipping);
    setTogglingFulfillment(null);
    if (res && (res as any).success === false) {
      toast.error((res as any).error || 'Could not update delivery options');
      return;
    }
    toast.success(label);
    await loadCustomers();
  };

  // Emails the customer a link to choose a new password (/account/set-password).
  // Guest records carry a synthetic @aminocan.local address and have no inbox,
  // so the button is hidden for them — see hasRealEmail.
  const handleSendPasswordReset = async (e: React.MouseEvent, customer: any) => {
    e.stopPropagation();
    if (resettingId) return;
    setResettingId(customer.id);
    const r = await sendCustomerPasswordReset(customer.id);
    setResettingId(null);
    if (r.success) {
      toast.success('Password reset link sent');
      setResetSentId(customer.id);
      setTimeout(() => setResetSentId((cur) => (cur === customer.id ? null : cur)), 3000);
    } else {
      toast.error(r.error || 'Could not send the password reset link');
    }
  };

  const affiliateName = (c: any) => {
    const a = c.bound_affiliate;
    if (!a) return null;
    return `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || a.email;
  };
  /**
   * The customer's sales team, primary first. Falls back to the single
   * `default_sales_person` for a customer saved before teams existed (and for
   * any payload that predates the roster join).
   */
  const salesTeamOf = (c: any): { id: string; name: string; rate: number | null }[] => {
    const roster = (c.sales_people ?? []) as any[];
    if (roster.length > 0) {
      return roster.map((m) => ({
        id: m.sales_person_id,
        name:
          `${m.sales_person?.first_name ?? ''} ${m.sales_person?.last_name ?? ''}`.trim() ||
          m.sales_person?.email ||
          'Unknown',
        rate: m.commission_rate != null ? Number(m.commission_rate) : null,
      }));
    }
    const s = c.default_sales_person;
    if (!s) return [];
    return [
      {
        id: s.id,
        name: `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim() || s.email,
        rate: s.commission_rate != null ? Number(s.commission_rate) : null,
      },
    ];
  };

  const showAffiliateCol = !isAffiliate;
  // Staff (and affiliates, over their own bound customers) can email a
  // password-reset link — the API enforces the same rule.
  const maySendPasswordReset =
    userRole === 'admin' || userRole === 'assistant' || userRole === 'affiliate';
  const showActions = canEdit(userRole) || canDelete(userRole) || maySendPasswordReset;
  // Guests have a synthetic @aminocan.local address with no inbox behind it.
  const hasRealEmail = (c: any) => {
    const email = (c.email ?? '').trim().toLowerCase();
    return !!email && !email.endsWith('@aminocan.local');
  };
  // Customer, Contact, [Attribution], Invoices, Ship-to clients, Delivery,
  // Actions/open.
  const colCount = 6 + (showAffiliateCol ? 1 : 0);

  // A sortable column header — clicking it selects that sort key.
  const SortHeader = ({
    label, keyName, align = 'left',
  }: { label: string; keyName: SortKey; align?: 'left' | 'right' }) => {
    const active = sortKey === keyName;
    return (
      <button
        type="button"
        onClick={() => setSortKey(keyName)}
        className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
          active ? 'text-ink' : 'text-ink-muted hover:text-ink'
        } ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {label}
        {active ? <ChevronDown className="w-3.5 h-3.5" /> : <ArrowUpDown className="w-3 h-3 opacity-50" />}
      </button>
    );
  };

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
            <input
              type="text"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40"
            />
          </div>
          <button
            onClick={downloadReport}
            disabled={downloading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-line text-ink rounded-lg text-sm font-semibold hover:bg-surface transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            {downloading ? 'Generating…' : 'Report'}
          </button>
          {canCreateCustomer && (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors whitespace-nowrap"
            >
              <UserPlus className="w-4 h-4" />
              New Customer
            </button>
          )}
        </div>

        {/* Filter toggles + sort */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {showAffiliateCol && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-light">Source</span>
              <Segmented<AffiliateFilter>
                ariaLabel="Filter by source"
                value={affiliateFilter}
                onChange={setAffiliateFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'with', label: 'Affiliate' },
                  { value: 'without', label: 'Direct' },
                ]}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-light">Status</span>
            <Segmented<ActiveFilter>
              ariaLabel="Filter by status"
              value={activeFilter}
              onChange={setActiveFilter}
              options={[
                { value: 'all', label: 'Any' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-light">Sort</span>
            <div className="relative">
              <ArrowUpDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted pointer-events-none" />
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="pl-8 pr-8 py-2 bg-white border border-line rounded-lg text-xs font-medium text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>{SORT_LABELS[k]}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="px-5 md:px-6 py-4 border-b border-line flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">{isAffiliate ? 'Your Customers' : 'Customers'}</h2>
          <span className="text-sm text-ink-muted tabular-nums">{loading ? '…' : `${total} total`}</span>
        </div>
        {/* Desktop table (≥lg). Below lg it is hidden and replaced by the card
            list further down — per ADR 0007, the table is untouched at ≥lg. */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b border-line bg-surface/40">
                <th className="px-5 py-3 text-left"><SortHeader label="Customer" keyName="name" /></th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Phone</th>
                {showAffiliateCol && (
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Affiliate / Rep</th>
                )}
                <th className="px-5 py-3 text-left"><SortHeader label="Invoices" keyName="invoices" /></th>
                <th className="px-5 py-3 text-left"><SortHeader label="Ship-to clients" keyName="clients" /></th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Delivery</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">
                  {showActions ? 'Actions' : ''}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                <TableSkeleton rows={8} cols={colCount} />
              ) : (
                paged.map((customer) => {
                  const role: UserRole = customer.role || (customer.is_admin ? 'admin' : 'customer');
                  const aff = affiliateName(customer);
                  const team = salesTeamOf(customer);
                  const marked = markedId === customer.id;
                  const shipOn = customer.allow_shipping ?? true;
                  const pickupOn = customer.allow_pickup ?? true;
                  return (
                    <tr
                      key={customer.id}
                      onClick={() => openCustomer(customer.id)}
                      className={`group cursor-pointer transition-colors ${marked ? 'bg-vital/5' : 'hover:bg-surface'}`}
                    >
                      {/* Customer */}
                      <td className="px-5 py-3.5 relative">
                        {/* Hover hint tooltip (white + shadow) */}
                        <span className="pointer-events-none absolute left-14 -top-1 z-20 -translate-y-full whitespace-nowrap rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-ink shadow-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                          <span className="inline-flex items-center gap-1.5">
                            <MousePointerClick className="w-3.5 h-3.5 text-vital" />
                            Click to view customer information
                          </span>
                          <span className="absolute left-5 top-full h-2 w-2 -translate-y-1 rotate-45 border-b border-r border-line bg-white" />
                        </span>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-vital/10 text-vital flex items-center justify-center text-xs font-bold shrink-0">
                            {initials(customer)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-ink text-sm whitespace-nowrap group-hover:text-vital transition-colors">
                                {nameOf(customer)}
                              </span>
                              {role !== 'customer' && (
                                <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${getRoleBadgeClasses(role)}`}>
                                  {getRoleName(role)}
                                </span>
                              )}
                              <span
                                title={`Quoted in ${customer.price_currency === 'USD' ? 'USD' : 'CAD'}`}
                                className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${
                                  customer.price_currency === 'USD' ? 'bg-blue-500/10 text-blue-600' : 'bg-surface text-ink-muted border border-line'
                                }`}
                              >
                                {customer.price_currency === 'USD' ? 'USD' : 'CAD'}
                              </span>
                              {customer.active === false && (
                                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-red-500/10 text-red-500">
                                  Inactive
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-ink-muted break-all">{customer.email}</div>
                          </div>
                        </div>
                      </td>

                      {/* Phone */}
                      <td className="px-5 py-3.5 text-sm text-ink-muted whitespace-nowrap">{customer.phone || '—'}</td>

                      {/* Attribution */}
                      {showAffiliateCol && (
                        <td className="px-5 py-3.5 text-sm">
                          {aff || team.length > 0 ? (
                            <div className="flex flex-col items-start gap-1">
                              {aff && <span title="Bound affiliate" className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-600">{aff}</span>}
                              {team.map((m) => (
                                <span
                                  key={m.id}
                                  title={m.rate != null ? `Sales person · ${m.rate}% commission` : 'Sales person'}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-500/10 text-purple-600"
                                >
                                  {m.name}
                                  {m.rate != null && <span className="tabular-nums opacity-70">{m.rate}%</span>}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-ink-muted">—</span>
                          )}
                        </td>
                      )}

                      {/* Invoices */}
                      <td className="px-5 py-3.5">
                        {customer.invoice_count > 0 ? (
                          <div className="whitespace-nowrap">
                            <span className="text-sm font-semibold text-ink tabular-nums">{customer.invoice_count}</span>
                            <span className="text-xs text-ink-muted"> invoice{customer.invoice_count === 1 ? '' : 's'}</span>
                            {customer.invoiced_total > 0 && (
                              <div className="text-[11px] text-ink-muted tabular-nums">{money(customer.invoiced_total)} invoiced</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-ink-muted text-sm">—</span>
                        )}
                      </td>

                      {/* Ship-to clients — the list's default sort. Names come
                          with the affiliate portal's payload only. */}
                      <td className="px-5 py-3.5">
                        {(() => {
                          const count = clientCountOf(customer);
                          if (count === 0) return <span className="text-ink-muted text-sm">—</span>;
                          const clients: Array<{ id: string; first_name: string | null; last_name: string | null }> =
                            customer.ship_to_clients ?? [];
                          const names = clients.map(
                            (cl) => `${cl.first_name ?? ''} ${cl.last_name ?? ''}`.trim() || 'Unnamed client',
                          );
                          const extra = names.length - 2;
                          return (
                            <div className="flex flex-col gap-0.5 max-w-[220px]">
                              <span className="inline-flex items-center gap-1 text-sm font-medium text-ink whitespace-nowrap">
                                <Users className="w-3.5 h-3.5 text-vital" />
                                {count} client{count === 1 ? '' : 's'}
                              </span>
                              {names.length > 0 && (
                                <span className="text-[11px] text-ink-muted truncate" title={names.join(', ')}>
                                  {names.slice(0, 2).join(', ')}{extra > 0 ? ` +${extra} more` : ''}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Delivery */}
                      <td className="px-5 py-3.5">
                        {canEdit(userRole) ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={(e) => handleToggleFulfillment(e, customer, pickupOn, !shipOn, `Shipping ${!shipOn ? 'enabled' : 'disabled'}`)}
                              disabled={togglingFulfillment === customer.id}
                              title={`Shipping: ${shipOn ? 'enabled' : 'disabled'} — click to toggle`}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                                shipOn ? 'bg-green-500/10 border border-green-500/20 text-green-600' : 'bg-surface border border-line text-ink-muted'
                              }`}
                            >
                              <Truck className="w-3 h-3" /> Ship
                            </button>
                            <button
                              onClick={(e) => handleToggleFulfillment(e, customer, !pickupOn, shipOn, `Pickup ${!pickupOn ? 'enabled' : 'disabled'}`)}
                              disabled={togglingFulfillment === customer.id}
                              title={`Pickup: ${pickupOn ? 'enabled' : 'disabled'} — click to toggle`}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                                pickupOn ? 'bg-green-500/10 border border-green-500/20 text-green-600' : 'bg-surface border border-line text-ink-muted'
                              }`}
                            >
                              <Store className="w-3 h-3" /> Pickup
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${shipOn ? 'bg-green-500/10 text-green-600' : 'bg-surface text-ink-muted'}`}><Truck className="w-3 h-3" />Ship</span>
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${pickupOn ? 'bg-green-500/10 text-green-600' : 'bg-surface text-ink-muted'}`}><Store className="w-3 h-3" />Pickup</span>
                          </div>
                        )}
                      </td>

                      {/* Actions + open affordance */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          {maySendPasswordReset && hasRealEmail(customer) && (
                            <button
                              onClick={(e) => handleSendPasswordReset(e, customer)}
                              disabled={resettingId === customer.id}
                              title="Email a password reset link"
                              className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors disabled:opacity-50 ${
                                resetSentId === customer.id
                                  ? 'border-green-500/20 bg-green-500/10 text-green-600'
                                  : 'border-amber-500/20 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'
                              }`}
                            >
                              {resetSentId === customer.id ? <Check className="w-4 h-4" /> : <LockKeyhole className="w-4 h-4" />}
                            </button>
                          )}
                          {canEdit(userRole) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingCustomer(customer); }}
                              title="Edit customer"
                              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line bg-white text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {canDelete(userRole) && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeletingCustomer(customer); }}
                              title="Remove customer"
                              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <ChevronRight className="w-4 h-4 text-ink-light group-hover:text-vital transition-colors" />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-5 py-12 text-center text-ink-muted text-sm">
                    {search || affiliateFilter !== 'all' || activeFilter !== 'all'
                      ? 'No customers match your filters'
                      : 'No customers yet'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards (below lg). Same rows, handlers and open-on-tap as the
            table above — see ADR 0007. */}
        <div className="lg:hidden">
          {loading ? (
            <div className="divide-y divide-line/50">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-4 py-3.5 animate-pulse flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-surface shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 bg-surface rounded" />
                    <div className="h-3 w-44 bg-surface rounded" />
                    <div className="h-3 w-24 bg-surface rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-12 text-center text-ink-muted text-sm">
              {search || affiliateFilter !== 'all' || activeFilter !== 'all'
                ? 'No customers match your filters'
                : 'No customers yet'}
            </div>
          ) : (
            <ul className="divide-y divide-line/50">
              {paged.map((customer) => {
                const role: UserRole = customer.role || (customer.is_admin ? 'admin' : 'customer');
                const aff = affiliateName(customer);
                const team = salesTeamOf(customer);
                const marked = markedId === customer.id;
                const shipOn = customer.allow_shipping ?? true;
                const pickupOn = customer.allow_pickup ?? true;
                const clientCount = clientCountOf(customer);
                return (
                  <li
                    key={customer.id}
                    onClick={() => openCustomer(customer.id)}
                    className={`px-4 py-3.5 cursor-pointer transition-colors ${marked ? 'bg-vital/5' : 'active:bg-surface'}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-full bg-vital/10 text-vital flex items-center justify-center text-xs font-bold shrink-0">
                        {initials(customer)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="font-medium text-ink text-sm">{nameOf(customer)}</span>
                            {role !== 'customer' && (
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${getRoleBadgeClasses(role)}`}>
                                {getRoleName(role)}
                              </span>
                            )}
                            <span
                              title={`Quoted in ${customer.price_currency === 'USD' ? 'USD' : 'CAD'}`}
                              className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${
                                customer.price_currency === 'USD' ? 'bg-blue-500/10 text-blue-600' : 'bg-surface text-ink-muted border border-line'
                              }`}
                            >
                              {customer.price_currency === 'USD' ? 'USD' : 'CAD'}
                            </span>
                            {customer.active === false && (
                              <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-red-500/10 text-red-500">Inactive</span>
                            )}
                          </div>
                          <ChevronRight className="w-4 h-4 text-ink-light shrink-0 mt-0.5" />
                        </div>
                        <div className="text-xs text-ink-muted break-all">{customer.email}</div>

                        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                          {customer.phone && (
                            <span>Phone <span className="text-ink">{customer.phone}</span></span>
                          )}
                          {customer.invoice_count > 0 && (
                            <span>
                              <span className="font-semibold text-ink tabular-nums">{customer.invoice_count}</span> invoice{customer.invoice_count === 1 ? '' : 's'}
                              {customer.invoiced_total > 0 && <span className="tabular-nums"> · {money(customer.invoiced_total)}</span>}
                            </span>
                          )}
                        </div>

                        {showAffiliateCol && (aff || team.length > 0) && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {aff && <span title="Bound affiliate" className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-600">{aff}</span>}
                            {team.map((m) => (
                              <span
                                key={m.id}
                                title={m.rate != null ? `Sales person · ${m.rate}% commission` : 'Sales person'}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-purple-500/10 text-purple-600"
                              >
                                {m.name}
                                {m.rate != null && <span className="tabular-nums opacity-70">{m.rate}%</span>}
                              </span>
                            ))}
                          </div>
                        )}

                        {clientCount > 0 && (
                          <div className="mt-1.5 inline-flex items-center gap-1 text-xs text-ink">
                            <Users className="w-3.5 h-3.5 text-vital" />
                            {clientCount} ship-to client{clientCount === 1 ? '' : 's'}
                          </div>
                        )}

                        {/* Delivery toggles */}
                        <div className="mt-2.5 flex items-center gap-1.5">
                          {canEdit(userRole) ? (
                            <>
                              <button
                                onClick={(e) => handleToggleFulfillment(e, customer, pickupOn, !shipOn, `Shipping ${!shipOn ? 'enabled' : 'disabled'}`)}
                                disabled={togglingFulfillment === customer.id}
                                title={`Shipping: ${shipOn ? 'enabled' : 'disabled'} — tap to toggle`}
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                                  shipOn ? 'bg-green-500/10 border border-green-500/20 text-green-600' : 'bg-surface border border-line text-ink-muted'
                                }`}
                              >
                                <Truck className="w-3 h-3" /> Ship
                              </button>
                              <button
                                onClick={(e) => handleToggleFulfillment(e, customer, !pickupOn, shipOn, `Pickup ${!pickupOn ? 'enabled' : 'disabled'}`)}
                                disabled={togglingFulfillment === customer.id}
                                title={`Pickup: ${pickupOn ? 'enabled' : 'disabled'} — tap to toggle`}
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                                  pickupOn ? 'bg-green-500/10 border border-green-500/20 text-green-600' : 'bg-surface border border-line text-ink-muted'
                                }`}
                              >
                                <Store className="w-3 h-3" /> Pickup
                              </button>
                            </>
                          ) : (
                            <>
                              <span className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${shipOn ? 'bg-green-500/10 text-green-600' : 'bg-surface text-ink-muted'}`}><Truck className="w-3 h-3" />Ship</span>
                              <span className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${pickupOn ? 'bg-green-500/10 text-green-600' : 'bg-surface text-ink-muted'}`}><Store className="w-3 h-3" />Pickup</span>
                            </>
                          )}
                          {/* Reset password / edit / delete */}
                          {(canEdit(userRole) || canDelete(userRole) || maySendPasswordReset) && (
                            <span className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              {maySendPasswordReset && hasRealEmail(customer) && (
                                <button
                                  onClick={(e) => handleSendPasswordReset(e, customer)}
                                  disabled={resettingId === customer.id}
                                  title="Email a password reset link"
                                  className={`inline-flex items-center justify-center w-10 h-10 rounded-lg border transition-colors disabled:opacity-50 ${
                                    resetSentId === customer.id
                                      ? 'border-green-500/20 bg-green-500/10 text-green-600'
                                      : 'border-amber-500/20 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'
                                  }`}
                                >
                                  {resetSentId === customer.id ? <Check className="w-4 h-4" /> : <LockKeyhole className="w-4 h-4" />}
                                </button>
                              )}
                              {canEdit(userRole) && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setEditingCustomer(customer); }}
                                  title="Edit customer"
                                  className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-line bg-white text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                              )}
                              {canDelete(userRole) && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setDeletingCustomer(customer); }}
                                  title="Remove customer"
                                  className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </span>
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

        {/* Pagination */}
        {!loading && total > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 border-t border-line">
            <span className="text-sm text-ink-muted">
              Showing <span className="font-medium text-ink tabular-nums">{rangeStart}</span>–
              <span className="font-medium text-ink tabular-nums">{rangeEnd}</span> of{' '}
              <span className="font-medium text-ink tabular-nums">{total}</span>
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

      {showCreate && (
        <CreateCustomerModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadCustomers(); }}
        />
      )}
      {editingCustomer && (
        <EditCustomerModal
          customer={editingCustomer}
          onClose={() => setEditingCustomer(null)}
          onUpdated={() => { setEditingCustomer(null); loadCustomers(); }}
        />
      )}
      {deletingCustomer && (
        <DeletionReviewModal
          kind="customer"
          entity={deletingCustomer}
          onClose={() => setDeletingCustomer(null)}
          onDeleted={() => { setDeletingCustomer(null); loadCustomers(); }}
          onDeactivate={() => deleteCustomer(deletingCustomer.id, false)}
        />
      )}
    </>
  );
}

export default function AdminCustomersPage() {
  // AdminCustomers reads the URL via useSearchParams, which Next requires to sit
  // inside a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <AdminCustomers />
    </Suspense>
  );
}
