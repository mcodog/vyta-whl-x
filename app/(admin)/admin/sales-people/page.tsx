'use client';

import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Search, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, ChevronDown,
  ArrowUpDown, MousePointerClick, FileText, Briefcase, Network, LockKeyhole, Check,
} from 'lucide-react';
import { getMergedSalesPeople, type MergedSalesPerson } from '@/lib/admin/sales-persons';
import { sendCustomerPasswordReset } from '@/lib/admin/api';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { canCreate, canEdit, canDelete } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import type { Affiliate } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { rankBySearch, byNewest } from '@/lib/search';
import TableSkeleton from '@/components/admin/TableSkeleton';
import CreateSalesPersonModal from './_components/CreateSalesPersonModal';
import EditSalesPersonModal from './_components/EditSalesPersonModal';
import DeletionReviewModal from '../_components/DeletionReviewModal';
import CreateAffiliateModal from '../affiliates/_components/CreateAffiliateModal';
import EditAffiliateModal from '../affiliates/_components/EditAffiliateModal';
import PendingAffiliateRequests from '../affiliates/_components/PendingAffiliateRequests';

const PAGE_SIZE = 20;

type TierFilter = 'all' | 'reps' | 'affiliates';
type ActiveFilter = 'all' | 'active' | 'inactive';
type SortKey = 'recent' | 'name' | 'invoices' | 'earnings' | 'customers';

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Newest first',
  name: 'Name (A–Z)',
  invoices: 'Most invoices',
  earnings: 'Highest earnings',
  customers: 'Most customers',
};

type Perf = Record<string, { bound_customers: number; customer_revenue: number }>;

// View state mirrored to sessionStorage so returning from a person restores the
// exact list (mirrors the customers/invoices lists).
const VIEW_KEY = 'admin.salespeople.viewState';
interface ViewState {
  q?: string; tier?: TierFilter; active?: ActiveFilter; sort?: SortKey;
  page?: number; scrollY?: number; lastOpened?: string;
}
function readViewState(): ViewState | null {
  if (typeof window === 'undefined') return null;
  try { const raw = sessionStorage.getItem(VIEW_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function patchViewState(patch: ViewState) {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ ...(readViewState() ?? {}), ...patch })); } catch { /* ignore */ }
}
function markOpened(id: string) { patchViewState({ lastOpened: id }); }

function money(n: number) {
  const v = Number(n) || 0;
  return `$${v.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function nameOf(p: MergedSalesPerson) {
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || '';
}
function initials(p: MergedSalesPerson) {
  const s = `${(p.first_name ?? '').charAt(0)}${(p.last_name ?? '').charAt(0)}`.trim();
  return (s || (p.email ?? '?').charAt(0)).toUpperCase();
}
// Build an Affiliate-shaped object for the affiliate modals from a merged row.
function toAffiliate(p: MergedSalesPerson): Affiliate {
  return {
    id: p.user_id as string,
    email: p.email ?? '',
    first_name: p.first_name,
    last_name: p.last_name,
    wallet_address: p.affiliate?.wallet_address ?? null,
    password_hash: '',
    active: p.affiliate?.login_active ?? true,
    manual_code_only: p.affiliate?.manual_code_only ?? false,
    total_earnings: p.affiliate?.total_earnings ?? 0,
    price_currency: p.affiliate?.price_currency ?? 'CAD',
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

function Segmented<T extends string>({
  options, value, onChange, ariaLabel,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex items-center rounded-lg border border-line bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            value === o.value ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink hover:bg-surface'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TierBadge({ affiliate }: { affiliate: boolean }) {
  return affiliate ? (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-emerald-500/10 text-emerald-600">
      <Network className="w-2.5 h-2.5" /> Affiliate
    </span>
  ) : (
    <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-surface text-ink-muted border border-line">
      Rep
    </span>
  );
}

function SalesPeople() {
  const userRole = useUserRole();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const mayCreate = canCreate(userRole);
  const mayEdit = canEdit(userRole);
  const mayDelete = canDelete(userRole);

  const [initialView] = useState(() => {
    const saved = readViewState();
    return {
      q: searchParams.get('q') ?? saved?.q ?? '',
      tier: ((searchParams.get('tier') as TierFilter | null) ?? saved?.tier ?? 'all') as TierFilter,
      active: ((searchParams.get('active') as ActiveFilter | null) ?? saved?.active ?? 'all') as ActiveFilter,
      sort: (saved?.sort ?? 'recent') as SortKey,
      page: typeof saved?.page === 'number' && saved.page > 0 ? saved.page : 0,
      scrollY: typeof saved?.scrollY === 'number' && saved.scrollY > 0 ? saved.scrollY : 0,
    };
  });

  const [people, setPeople] = useState<MergedSalesPerson[]>([]);
  const [perf, setPerf] = useState<Perf>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(initialView.q);
  const [tierFilter, setTierFilter] = useState<TierFilter>(initialView.tier);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>(initialView.active);
  const [sortKey, setSortKey] = useState<SortKey>(initialView.sort);
  const [page, setPage] = useState(initialView.page);
  const [markedId, setMarkedId] = useState<string | null>(null);
  // Row currently having a password-reset email sent, and the last one sent
  // (briefly shown as a checkmark).
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetSentId, setResetSentId] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  const [showCreateRep, setShowCreateRep] = useState(false);
  const [showCreateAffiliate, setShowCreateAffiliate] = useState(false);
  const [editRep, setEditRep] = useState<MergedSalesPerson | null>(null);
  const [editAffiliate, setEditAffiliate] = useState<MergedSalesPerson | null>(null);
  const [deleteRep, setDeleteRep] = useState<MergedSalesPerson | null>(null);
  const [deleteAffiliate, setDeleteAffiliate] = useState<MergedSalesPerson | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const [merged, perfRes] = await Promise.all([
        getMergedSalesPeople(),
        fetch('/api/admin/affiliate-performance', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        }).then((r) => (r.ok ? r.json() : { performance: {} })).catch(() => ({ performance: {} })),
      ]);
      setPeople(merged);
      setPerf(perfRes.performance ?? {});
    } catch {
      toast.error('Failed to load sales people');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // Sync active view → URL + sessionStorage.
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (tierFilter !== 'all') params.set('tier', tierFilter);
    if (activeFilter !== 'all') params.set('active', activeFilter);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    patchViewState({ q: search, tier: tierFilter, active: activeFilter, sort: sortKey, page });
  }, [search, tierFilter, activeFilter, sortKey, page, pathname, router]);

  // Scroll persistence.
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { patchViewState({ scrollY: window.scrollY }); ticking = false; });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const pendingScrollRef = useRef(initialView.scrollY);
  const didRestore = useRef(false);
  useEffect(() => {
    if (didRestore.current || loading) return;
    didRestore.current = true;
    const y = pendingScrollRef.current;
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [loading]);
  useEffect(() => {
    const saved = readViewState();
    if (saved?.lastOpened) { setMarkedId(saved.lastOpened); patchViewState({ lastOpened: undefined }); }
  }, []);
  useEffect(() => {
    if (!markedId || loading) return;
    const t = setTimeout(() => setMarkedId(null), 4000);
    return () => clearTimeout(t);
  }, [markedId, loading]);

  const boundCount = (p: MergedSalesPerson) => (p.user_id ? perf[p.user_id]?.bound_customers ?? 0 : 0);
  const boundRevenue = (p: MergedSalesPerson) => (p.user_id ? perf[p.user_id]?.customer_revenue ?? 0 : 0);

  const filtered = useMemo(() => {
    let result = people;
    if (tierFilter === 'reps') result = result.filter((p) => !p.is_affiliate);
    else if (tierFilter === 'affiliates') result = result.filter((p) => p.is_affiliate);

    if (activeFilter === 'active') result = result.filter((p) => p.active !== false);
    else if (activeFilter === 'inactive') result = result.filter((p) => p.active === false);

    const searching = search.trim().length > 0;
    if (searching) {
      result = rankBySearch(
        result,
        search,
        [
          { value: (p) => p.first_name, weight: 3 },
          { value: (p) => p.last_name, weight: 3 },
          { value: (p) => `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(), weight: 2 },
          { value: (p) => p.affiliate?.referral_code ?? null, weight: 2 },
          { value: (p) => p.phone, weight: 1 },
          { value: (p) => p.email, weight: 1 },
        ],
        byNewest,
      );
    }

    if (!(searching && sortKey === 'recent')) {
      const arr = [...result];
      switch (sortKey) {
        case 'name': arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b))); break;
        case 'invoices': arr.sort((a, b) => (b.invoice_count ?? 0) - (a.invoice_count ?? 0)); break;
        case 'earnings': arr.sort((a, b) => (b.paid_earnings + b.pending_earnings) - (a.paid_earnings + a.pending_earnings)); break;
        case 'customers': arr.sort((a, b) => boundCount(b) - boundCount(a)); break;
        case 'recent':
        default: arr.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); break;
      }
      result = arr;
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, perf, search, tierFilter, activeFilter, sortKey]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const skipReset = useRef(true);
  useEffect(() => {
    if (skipReset.current) { skipReset.current = false; return; }
    setPage(0);
  }, [search, tierFilter, activeFilter, sortKey]);
  useEffect(() => { if (page > totalPages - 1) setPage(totalPages - 1); }, [page, totalPages]);
  const safePage = Math.min(page, totalPages - 1);
  const rangeStart = total === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (safePage + 1) * PAGE_SIZE);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const openPerson = (id: string) => { markOpened(id); router.push(`/admin/sales-people/${id}`); };

  const downloadReport = async () => {
    setReportBusy(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch('/api/admin/affiliates/report', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) { toast.error('Could not generate the affiliate report'); return; }
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } catch {
      toast.error('Could not generate the affiliate report');
    } finally {
      setReportBusy(false);
    }
  };

  // Emails a password-reset link to an affiliate's login account.
  const handleSendPasswordReset = async (e: React.MouseEvent, p: MergedSalesPerson) => {
    e.stopPropagation();
    if (!p.user_id || resettingId) return;
    const id = p.user_id;
    setResettingId(id);
    const r = await sendCustomerPasswordReset(id);
    setResettingId(null);
    if (r.success) {
      toast.success('Password reset link sent');
      setResetSentId(id);
      setTimeout(() => setResetSentId((cur) => (cur === id ? null : cur)), 3000);
    } else {
      toast.error(r.error || 'Could not send the password reset link');
    }
  };

  // Only people with a login account (affiliates — reps get a user_id when
  // promoted) can be sent a password-reset link, and guests' synthetic
  // @aminocan.local addresses have no inbox behind them.
  const mayResetPassword = (p: MergedSalesPerson) => {
    if (!mayEdit || !p.user_id) return false;
    const email = (p.email ?? '').trim().toLowerCase();
    return !!email && !email.endsWith('@aminocan.local');
  };

  const showActions = mayEdit || mayDelete;
  const colCount = 6 + (showActions ? 1 : 0);

  const stats = useMemo(() => ({
    total: people.length,
    reps: people.filter((p) => !p.is_affiliate).length,
    affiliates: people.filter((p) => p.is_affiliate).length,
  }), [people]);

  const SortHeader = ({ label, keyName }: { label: string; keyName: SortKey }) => {
    const active = sortKey === keyName;
    return (
      <button
        type="button"
        onClick={() => setSortKey(keyName)}
        className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider transition-colors ${active ? 'text-ink' : 'text-ink-muted hover:text-ink'}`}
      >
        {label}
        {active ? <ChevronDown className="w-3.5 h-3.5" /> : <ArrowUpDown className="w-3 h-3 opacity-50" />}
      </button>
    );
  };

  return (
    <>
      {/* Pending affiliate requests (apply → approve/deny) */}
      <PendingAffiliateRequests canReview={mayEdit} onApproved={load} />

      {/* Stat chips */}
      <div className="flex flex-wrap gap-3 mb-5 text-sm">
        <div className="flex items-center gap-2 bg-white border border-line rounded-lg px-4 py-2.5">
          <Briefcase className="w-4 h-4 text-ink-muted" />
          <span className="text-ink font-semibold tabular-nums">{stats.total}</span>
          <span className="text-ink-muted">total</span>
        </div>
        <div className="flex items-center gap-2 bg-white border border-line rounded-lg px-4 py-2.5">
          <span className="w-2 h-2 rounded-full bg-ink-muted" />
          <span className="text-ink font-semibold tabular-nums">{stats.reps}</span>
          <span className="text-ink-muted">reps</span>
        </div>
        <div className="flex items-center gap-2 bg-white border border-line rounded-lg px-4 py-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-emerald-600 font-semibold tabular-nums">{stats.affiliates}</span>
          <span className="text-ink-muted">affiliates</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
            <input
              type="text"
              placeholder="Search by name, email, phone, or referral code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40"
            />
          </div>
          <button
            onClick={downloadReport}
            disabled={reportBusy}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-line text-ink rounded-lg text-sm font-semibold hover:bg-surface transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <FileText className="w-4 h-4" />
            {reportBusy ? 'Generating…' : 'Affiliate report'}
          </button>
          {mayCreate && (
            <>
              <button
                onClick={() => setShowCreateRep(true)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-line text-ink rounded-lg text-sm font-semibold hover:bg-surface transition-colors whitespace-nowrap"
              >
                <Plus className="w-4 h-4" /> Sales person
              </button>
              <button
                onClick={() => setShowCreateAffiliate(true)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-ink text-white rounded-lg text-sm font-semibold hover:bg-ink/90 transition-colors whitespace-nowrap"
              >
                <Plus className="w-4 h-4" /> Affiliate
              </button>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-light">Tier</span>
            <Segmented<TierFilter>
              ariaLabel="Filter by tier"
              value={tierFilter}
              onChange={setTierFilter}
              options={[{ value: 'all', label: 'All' }, { value: 'reps', label: 'Reps' }, { value: 'affiliates', label: 'Affiliates' }]}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-light">Status</span>
            <Segmented<ActiveFilter>
              ariaLabel="Filter by status"
              value={activeFilter}
              onChange={setActiveFilter}
              options={[{ value: 'all', label: 'Any' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]}
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

      {/* Table */}
      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="px-5 md:px-6 py-4 border-b border-line flex items-center justify-between">
          <h2 className="text-base font-bold text-ink">Sales People</h2>
          <span className="text-sm text-ink-muted tabular-nums">{loading ? '…' : `${total} shown`}</span>
        </div>
        {/* Desktop table (≥lg) / mobile cards — ADR 0007. */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-line bg-surface/40">
                <th className="px-5 py-3 text-left"><SortHeader label="Sales Person" keyName="name" /></th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Phone</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Rate</th>
                <th className="px-5 py-3 text-left"><SortHeader label="Invoices" keyName="invoices" /></th>
                <th className="px-5 py-3 text-left"><SortHeader label="Affiliate book" keyName="customers" /></th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
                {showActions && <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/50">
              {loading ? (
                <TableSkeleton rows={8} cols={colCount} />
              ) : (
                paged.map((p) => {
                  const isActive = p.active !== false;
                  const marked = markedId === p.id;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => openPerson(p.id)}
                      className={`group cursor-pointer transition-colors ${marked ? 'bg-vital/5' : 'hover:bg-surface'}`}
                    >
                      {/* Person */}
                      <td className="px-5 py-3.5 relative">
                        <span className="pointer-events-none absolute left-14 -top-1 z-20 -translate-y-full whitespace-nowrap rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-ink shadow-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                          <span className="inline-flex items-center gap-1.5"><MousePointerClick className="w-3.5 h-3.5 text-vital" /> Click to view profile</span>
                          <span className="absolute left-5 top-full h-2 w-2 -translate-y-1 rotate-45 border-b border-r border-line bg-white" />
                        </span>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-vital/10 text-vital flex items-center justify-center text-xs font-bold shrink-0">{initials(p)}</div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-ink text-sm whitespace-nowrap group-hover:text-vital transition-colors">{nameOf(p)}</span>
                              <TierBadge affiliate={p.is_affiliate} />
                            </div>
                            <div className="text-xs text-ink-muted break-all">{p.email || '—'}</div>
                          </div>
                        </div>
                      </td>
                      {/* Phone */}
                      <td className="px-5 py-3.5 text-sm text-ink-muted whitespace-nowrap">{p.phone || '—'}</td>
                      {/* Rate */}
                      <td className="px-5 py-3.5 text-sm text-ink tabular-nums whitespace-nowrap">{p.commission_rate}%</td>
                      {/* Invoices */}
                      <td className="px-5 py-3.5">
                        {p.invoice_count > 0 ? (
                          <div className="whitespace-nowrap">
                            <span className="text-sm font-semibold text-ink tabular-nums">{p.invoice_count}</span>
                            <div className="text-[11px] text-ink-muted tabular-nums">
                              <span className="text-emerald-600">{money(p.paid_earnings)} paid</span>
                              {p.pending_earnings > 0 && <span className="text-vital"> · {money(p.pending_earnings)} pending</span>}
                            </div>
                          </div>
                        ) : (
                          <span className="text-ink-muted text-sm">—</span>
                        )}
                      </td>
                      {/* Affiliate book */}
                      <td className="px-5 py-3.5">
                        {p.is_affiliate ? (
                          <div className="whitespace-nowrap">
                            {p.affiliate?.referral_code && (
                              <span className="inline-block font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface border border-line text-ink-muted mb-1">{p.affiliate.referral_code}</span>
                            )}
                            <div className="text-[11px] text-ink-muted tabular-nums">
                              {boundCount(p)} customer{boundCount(p) === 1 ? '' : 's'}
                              {boundRevenue(p) > 0 && <span> · {money(boundRevenue(p))}</span>}
                            </div>
                          </div>
                        ) : (
                          <span className="text-ink-muted text-sm">—</span>
                        )}
                      </td>
                      {/* Status */}
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'}`}>
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      {/* Actions */}
                      {showActions && (
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {mayResetPassword(p) && (
                              <button
                                onClick={(e) => handleSendPasswordReset(e, p)}
                                disabled={resettingId === p.user_id}
                                title="Email a password reset link"
                                className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors disabled:opacity-50 ${
                                  resetSentId === p.user_id
                                    ? 'border-green-500/20 bg-green-500/10 text-green-600'
                                    : 'border-amber-500/20 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'
                                }`}
                              >
                                {resetSentId === p.user_id ? <Check className="w-4 h-4" /> : <LockKeyhole className="w-4 h-4" />}
                              </button>
                            )}
                            {mayEdit && (
                              <button
                                onClick={(e) => { e.stopPropagation(); p.is_affiliate ? setEditAffiliate(p) : setEditRep(p); }}
                                title="Edit"
                                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line bg-white text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            {mayDelete && (
                              <button
                                onClick={(e) => { e.stopPropagation(); p.is_affiliate ? setDeleteAffiliate(p) : setDeleteRep(p); }}
                                title={p.is_affiliate ? 'Delete affiliate' : 'Delete sales person'}
                                className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                            <ChevronRight className="w-4 h-4 text-ink-light group-hover:text-vital transition-colors" />
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
              {!loading && total === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-5 py-12 text-center text-ink-muted text-sm">
                    {search || tierFilter !== 'all' || activeFilter !== 'all' ? 'No sales people match your filters' : 'No sales people yet'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards (below lg) — same rows and open-on-tap. ADR 0007. */}
        <div className="lg:hidden">
          {loading ? (
            <div className="divide-y divide-line/50">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-4 py-3.5 animate-pulse flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-surface shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 bg-surface rounded" />
                    <div className="h-3 w-44 bg-surface rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : total === 0 ? (
            <div className="px-5 py-12 text-center text-ink-muted text-sm">
              {search || tierFilter !== 'all' || activeFilter !== 'all' ? 'No sales people match your filters' : 'No sales people yet'}
            </div>
          ) : (
            <ul className="divide-y divide-line/50">
              {paged.map((p) => {
                const isActive = p.active !== false;
                const marked = markedId === p.id;
                return (
                  <li
                    key={p.id}
                    onClick={() => openPerson(p.id)}
                    className={`px-4 py-3.5 cursor-pointer transition-colors ${marked ? 'bg-vital/5' : 'active:bg-surface'}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-full bg-vital/10 text-vital flex items-center justify-center text-xs font-bold shrink-0">{initials(p)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="font-medium text-ink text-sm">{nameOf(p)}</span>
                            <TierBadge affiliate={p.is_affiliate} />
                          </div>
                          <ChevronRight className="w-4 h-4 text-ink-light shrink-0 mt-0.5" />
                        </div>
                        <div className="text-xs text-ink-muted break-all">{p.email || '—'}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                          {p.phone && <span>{p.phone}</span>}
                          <span>Rate <span className="text-ink tabular-nums font-medium">{p.commission_rate}%</span></span>
                          <span className={`inline-flex px-2 py-0.5 rounded font-medium ${isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'}`}>
                            {isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        {p.invoice_count > 0 && (
                          <div className="mt-1.5 text-xs text-ink-muted">
                            <span className="text-sm font-semibold text-ink tabular-nums">{p.invoice_count}</span> inv ·{' '}
                            <span className="text-emerald-600 tabular-nums">{money(p.paid_earnings)} paid</span>
                            {p.pending_earnings > 0 && <span className="text-vital tabular-nums"> · {money(p.pending_earnings)} pending</span>}
                          </div>
                        )}
                        {p.is_affiliate && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                            {p.affiliate?.referral_code && (
                              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface border border-line text-ink-muted">{p.affiliate.referral_code}</span>
                            )}
                            <span className="tabular-nums">
                              {boundCount(p)} customer{boundCount(p) === 1 ? '' : 's'}
                              {boundRevenue(p) > 0 && <> · {money(boundRevenue(p))}</>}
                            </span>
                          </div>
                        )}
                        {showActions && (mayEdit || mayDelete) && (
                          <div className="mt-2.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            {mayResetPassword(p) && (
                              <button
                                onClick={(e) => handleSendPasswordReset(e, p)}
                                disabled={resettingId === p.user_id}
                                title="Email a password reset link"
                                className={`inline-flex items-center justify-center w-10 h-10 rounded-lg border transition-colors disabled:opacity-50 ${
                                  resetSentId === p.user_id
                                    ? 'border-green-500/20 bg-green-500/10 text-green-600'
                                    : 'border-amber-500/20 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'
                                }`}
                              >
                                {resetSentId === p.user_id ? <Check className="w-4 h-4" /> : <LockKeyhole className="w-4 h-4" />}
                              </button>
                            )}
                            {mayEdit && (
                              <button
                                onClick={(e) => { e.stopPropagation(); p.is_affiliate ? setEditAffiliate(p) : setEditRep(p); }}
                                title="Edit"
                                className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-line bg-white text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            {mayDelete && (
                              <button
                                onClick={(e) => { e.stopPropagation(); p.is_affiliate ? setDeleteAffiliate(p) : setDeleteRep(p); }}
                                title={p.is_affiliate ? 'Delete affiliate' : 'Delete sales person'}
                                className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {!loading && total > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3 border-t border-line">
            <span className="text-sm text-ink-muted">
              Showing <span className="font-medium text-ink tabular-nums">{rangeStart}</span>–
              <span className="font-medium text-ink tabular-nums">{rangeEnd}</span> of{' '}
              <span className="font-medium text-ink tabular-nums">{total}</span>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">Page {safePage + 1} of {totalPages}</span>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <button onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))} disabled={safePage + 1 >= totalPages} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:border-ink/20 disabled:opacity-40 disabled:cursor-not-allowed">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreateRep && <CreateSalesPersonModal onClose={() => setShowCreateRep(false)} onCreated={() => { setShowCreateRep(false); load(); }} />}
      {showCreateAffiliate && <CreateAffiliateModal onClose={() => setShowCreateAffiliate(false)} onCreated={() => { setShowCreateAffiliate(false); load(); }} />}
      {editRep && <EditSalesPersonModal person={editRep} onClose={() => setEditRep(null)} onUpdated={() => { setEditRep(null); load(); }} />}
      {editAffiliate && <EditAffiliateModal affiliate={toAffiliate(editAffiliate)} onClose={() => setEditAffiliate(null)} onUpdated={() => { setEditAffiliate(null); load(); }} />}
      {deleteRep && <DeletionReviewModal kind="sales_person" entity={deleteRep} onClose={() => setDeleteRep(null)} onDeleted={() => { setDeleteRep(null); load(); }} />}
      {deleteAffiliate && (
        <DeletionReviewModal
          kind="affiliate"
          entity={{
            id: deleteAffiliate.user_id as string,
            first_name: deleteAffiliate.first_name,
            last_name: deleteAffiliate.last_name,
            email: deleteAffiliate.email,
          }}
          onClose={() => setDeleteAffiliate(null)}
          onDeleted={() => { setDeleteAffiliate(null); load(); }}
        />
      )}
    </>
  );
}

export default function SalesPeoplePage() {
  return (
    <Suspense fallback={null}>
      <SalesPeople />
    </Suspense>
  );
}
