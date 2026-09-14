'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Check,
  Search,
  DollarSign,
  FileText,
  LayoutGrid,
  Table as TableIcon,
  Users,
  Briefcase,
  ArrowRight,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  getAllCommissions,
  markCommissionPaid,
  getAllSalesCommissions,
  markSalesCommissionPaid,
} from '@/lib/admin/api';
import { rankBySearch, byNewest } from '@/lib/search';
import Pagination from '@/components/admin/Pagination';
import TableSkeleton from '@/components/admin/TableSkeleton';

const PAGE_SIZE = 20;

type Source = 'affiliate' | 'sales';
type ViewMode = 'cards' | 'table';

type UnifiedCommission = {
  id: string;
  source: Source;
  recipient_id: string | null;
  recipient_name: string;
  recipient_email: string;
  reference: string;
  total: number;
  amount: number;
  status: string;
  paid_at: string | null;
  created_at: string;
};

type RecipientCard = {
  key: string;
  source: Source;
  recipient_id: string | null;
  name: string;
  email: string;
  count: number;
  pendingCount: number;
  pendingTotal: number;
  paidTotal: number;
  lifetimeTotal: number;
  lastActivity: string;
  recent: UnifiedCommission[];
  pendingIds: string[];
};

export default function AdminCommissions() {
  const [commissions, setCommissions] = useState<UnifiedCommission[]>([]);
  const [view, setView] = useState<ViewMode>('cards');
  const [paying, setPaying] = useState<string | null>(null);
  const [payingAll, setPayingAll] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | Source>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [recipientFilter, setRecipientFilter] = useState<string>('all');
  const [downloading, setDownloading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
    const [affiliate, sales] = await Promise.all([
      getAllCommissions(),
      getAllSalesCommissions(),
    ]);

    const affiliateRows: UnifiedCommission[] = affiliate.map((c) => ({
      id: c.id,
      source: 'affiliate',
      recipient_id: c.affiliate_id ?? null,
      recipient_name: c.affiliate_name || '—',
      recipient_email: c.affiliate_email || '',
      reference: c.order_number || c.order_id?.slice(0, 8) || '—',
      total: c.order_total || 0,
      amount: c.amount || 0,
      status: c.status,
      paid_at: c.paid_at,
      created_at: c.created_at,
    }));

    const salesRows: UnifiedCommission[] = sales.map((c) => ({
      id: c.id,
      source: 'sales',
      recipient_id: c.sales_person_id ?? null,
      recipient_name: c.sales_person_name || '—',
      recipient_email: c.sales_person_email || '',
      reference: c.invoice_number || c.invoice_id?.slice(0, 8) || '—',
      total: c.invoice_total || 0,
      amount: c.amount || 0,
      status: c.status,
      paid_at: c.paid_at,
      created_at: c.created_at,
    }));

    const merged = [...affiliateRows, ...salesRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    setCommissions(merged);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleMarkPaid = async (comm: UnifiedCommission) => {
    setPaying(comm.id);
    if (comm.source === 'affiliate') {
      await markCommissionPaid(comm.id);
    } else {
      await markSalesCommissionPaid(comm.id);
    }
    await load();
    setPaying(null);
  };

  // Mark every pending commission for a single recipient as paid in one action.
  const handleMarkAllPaid = async (card: RecipientCard) => {
    if (card.pendingIds.length === 0) return;
    setPayingAll(card.key);
    try {
      const markOne =
        card.source === 'affiliate' ? markCommissionPaid : markSalesCommissionPaid;
      await Promise.all(card.pendingIds.map((id) => markOne(id)));
      await load();
    } finally {
      setPayingAll(null);
    }
  };

  // Jump from a recipient card into the table, pre-filtered to that recipient.
  const viewRecipientInTable = (card: RecipientCard) => {
    setRecipientFilter(`${card.source}::${card.name}`);
    setView('table');
  };

  const recipients = useMemo(() => {
    const map = new Map<string, { key: string; label: string; source: Source }>();
    for (const c of commissions) {
      if (!c.recipient_name || c.recipient_name === '—') continue;
      const key = `${c.source}::${c.recipient_name}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: `${c.recipient_name} (${c.source === 'affiliate' ? 'Affiliate' : 'Sales'})`,
          source: c.source,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [commissions]);

  const filtered = useMemo(() => {
    let result = commissions;
    if (sourceFilter !== 'all') {
      result = result.filter((c) => c.source === sourceFilter);
    }
    if (statusFilter !== 'all') {
      result = result.filter((c) => c.status === statusFilter);
    }
    if (recipientFilter !== 'all') {
      const [src, ...nameParts] = recipientFilter.split('::');
      const name = nameParts.join('::');
      result = result.filter((c) => c.source === src && c.recipient_name === name);
    }
    if (search) {
      result = rankBySearch(
        result,
        search,
        [
          { value: (c) => c.recipient_name, weight: 3 },
          { value: (c) => c.reference, weight: 2 },
          { value: (c) => c.recipient_email, weight: 1 },
        ],
        byNewest,
      );
    }
    return result;
  }, [commissions, sourceFilter, statusFilter, recipientFilter, search]);

  // Cards aggregate per recipient. The status filter is table-only (a card
  // shows its own pending/paid breakdown), so cards respect search + source.
  const cards = useMemo(() => {
    let base = commissions;
    if (sourceFilter !== 'all') base = base.filter((c) => c.source === sourceFilter);
    if (search) {
      base = rankBySearch(
        base,
        search,
        [
          { value: (c) => c.recipient_name, weight: 3 },
          { value: (c) => c.recipient_email, weight: 1 },
        ],
        byNewest,
      );
    }

    const map = new Map<string, RecipientCard>();
    for (const c of base) {
      const key = `${c.source}::${c.recipient_id ?? c.recipient_name}`;
      let card = map.get(key);
      if (!card) {
        card = {
          key,
          source: c.source,
          recipient_id: c.recipient_id,
          name: c.recipient_name,
          email: c.recipient_email,
          count: 0,
          pendingCount: 0,
          pendingTotal: 0,
          paidTotal: 0,
          lifetimeTotal: 0,
          lastActivity: c.created_at,
          recent: [],
          pendingIds: [],
        };
        map.set(key, card);
      }
      card.count += 1;
      card.lifetimeTotal += c.amount;
      if (c.status === 'pending') {
        card.pendingCount += 1;
        card.pendingTotal += c.amount;
        card.pendingIds.push(c.id);
      }
      if (c.status === 'paid') card.paidTotal += c.amount;
      if (new Date(c.created_at) > new Date(card.lastActivity)) {
        card.lastActivity = c.created_at;
      }
      if (card.recent.length < 3) card.recent.push(c);
    }

    // Recipients who are owed the most float to the top so the pay-out
    // workflow starts where the action is.
    return Array.from(map.values()).sort(
      (a, b) =>
        b.pendingTotal - a.pendingTotal ||
        b.lifetimeTotal - a.lifetimeTotal ||
        a.name.localeCompare(b.name),
    );
  }, [commissions, sourceFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Reset to the first page whenever the filters/search change.
  useEffect(() => {
    setPage(0);
  }, [search, sourceFilter, statusFilter, recipientFilter]);

  const downloadReport = async () => {
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      // Status + recipient filters only apply in the table view.
      if (view === 'table') {
        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (recipientFilter !== 'all') params.set('recipient', recipientFilter);
      }
      if (search) params.set('q', search);
      const qs = params.toString();
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/commissions/report${qs ? `?${qs}` : ''}`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
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

  const pendingTotal = commissions
    .filter((c) => c.status === 'pending')
    .reduce((sum, c) => sum + c.amount, 0);
  const paidTotal = commissions
    .filter((c) => c.status === 'paid')
    .reduce((sum, c) => sum + c.amount, 0);

  return (
    <>
      {/* Stats */}
      <div className="flex flex-wrap gap-4 mb-6 text-sm">
        <div className="flex items-center gap-2 bg-white border border-line rounded-lg px-4 py-2.5">
          <DollarSign className="w-4 h-4 text-ink-muted" />
          <span className="text-ink font-semibold">{commissions.length}</span>
          <span className="text-ink-muted">total</span>
        </div>
        <div className="flex items-center gap-2 bg-white border border-line rounded-lg px-4 py-2.5">
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-vital font-semibold tabular-nums">${pendingTotal.toFixed(2)}</span>
          <span className="text-ink-muted">pending</span>
        </div>
        <div className="flex items-center gap-2 bg-white border border-line rounded-lg px-4 py-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-emerald-500 font-semibold tabular-nums">${paidTotal.toFixed(2)}</span>
          <span className="text-ink-muted">paid</span>
        </div>
      </div>

      {/* View tabs */}
      <div className="inline-flex items-center gap-1 mb-6 bg-white border border-line rounded-lg p-1">
        <button
          onClick={() => setView('cards')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            view === 'cards' ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          By Recipient
        </button>
        <button
          onClick={() => setView('table')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            view === 'table' ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
          }`}
        >
          <TableIcon className="w-4 h-4" />
          All Commissions
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
          <input
            type="text"
            placeholder={
              view === 'cards'
                ? 'Search by recipient name or email...'
                : 'Search by name, email, or order/invoice...'
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink placeholder-ink-muted focus:outline-none focus:ring-2 focus:ring-vital/40"
          />
        </div>
        {view === 'table' && (
          <select
            value={recipientFilter}
            onChange={(e) => setRecipientFilter(e.target.value)}
            className="px-3 pr-8 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 appearance-none max-w-[240px]"
          >
            <option value="all">All Recipients</option>
            {recipients.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        )}
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as 'all' | Source)}
          className="px-3 pr-8 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 appearance-none"
        >
          <option value="all">All Sources</option>
          <option value="affiliate">Affiliate</option>
          <option value="sales">Sales Person</option>
        </select>
        {view === 'table' && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 pr-8 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40 appearance-none"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
          </select>
        )}
        <button
          onClick={downloadReport}
          disabled={downloading}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          <FileText className="w-4 h-4" />
          {downloading ? 'Generating…' : 'Download Report'}
        </button>
      </div>

      {view === 'cards' ? (
        <CardsView
          cards={cards}
          loading={loading}
          totalCommissions={commissions.length}
          payingAll={payingAll}
          paying={paying}
          onMarkAllPaid={handleMarkAllPaid}
          onMarkPaid={handleMarkPaid}
          onViewInTable={viewRecipientInTable}
        />
      ) : (
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          <div className="p-5 md:p-6 border-b border-line flex items-center justify-between">
            <h2 className="text-lg font-bold text-ink">All Commissions</h2>
            <span className="text-sm text-ink-muted">{filtered.length} shown</span>
          </div>
          {/* Desktop table (≥lg) / mobile cards — ADR 0007. */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Source</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Recipient</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Order / Invoice</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Total</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Commission</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {loading && <TableSkeleton rows={8} cols={7} />}
                {!loading && paged.map((comm) => (
                  <tr key={`${comm.source}-${comm.id}`} className="hover:bg-surface transition-colors">
                    <td className="px-5 py-4">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                        comm.source === 'affiliate'
                          ? 'bg-blue-500/10 text-blue-500'
                          : 'bg-purple-500/10 text-purple-500'
                      }`}>
                        {comm.source === 'affiliate' ? 'Affiliate' : 'Sales Person'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-medium text-ink text-sm">{comm.recipient_name}</div>
                      <div className="text-xs text-ink-muted">{comm.recipient_email}</div>
                    </td>
                    <td className="px-5 py-4 font-mono text-sm text-ink">{comm.reference}</td>
                    <td className="px-5 py-4 text-sm text-ink tabular-nums">${comm.total.toFixed(2)}</td>
                    <td className="px-5 py-4 font-semibold text-emerald-400 tabular-nums">${comm.amount.toFixed(2)}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                        comm.status === 'paid' ? 'bg-emerald-500/10 text-emerald-400' :
                        comm.status === 'pending' ? 'bg-amber-500/10 text-amber-400' :
                        'bg-red-500/10 text-red-400'
                      }`}>
                        {comm.status}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {comm.status === 'pending' && (
                        <button
                          onClick={() => handleMarkPaid(comm)}
                          disabled={paying === comm.id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{paying === comm.id ? '...' : 'Mark Paid'}</span>
                        </button>
                      )}
                      {comm.status === 'paid' && (
                        <span className="text-xs text-ink-muted">
                          Paid {comm.paid_at ? new Date(comm.paid_at).toLocaleDateString() : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-ink-muted text-sm">
                      {commissions.length === 0
                        ? 'No commissions yet'
                        : 'No commissions match your filters'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards (below lg) — same rows and actions. ADR 0007. */}
          <div className="lg:hidden">
            {loading ? (
              <div className="px-5 py-12 text-center text-sm text-ink-muted">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="px-5 py-12 text-center text-ink-muted text-sm">
                {commissions.length === 0 ? 'No commissions yet' : 'No commissions match your filters'}
              </div>
            ) : (
              <ul className="divide-y divide-line/50">
                {paged.map((comm) => (
                  <li key={`${comm.source}-${comm.id}`} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-ink text-sm">{comm.recipient_name}</div>
                        <div className="text-xs text-ink-muted break-all">{comm.recipient_email}</div>
                      </div>
                      <span className={`inline-flex shrink-0 px-2 py-0.5 rounded text-xs font-medium ${
                        comm.source === 'affiliate' ? 'bg-blue-500/10 text-blue-500' : 'bg-purple-500/10 text-purple-500'
                      }`}>
                        {comm.source === 'affiliate' ? 'Affiliate' : 'Sales Person'}
                      </span>
                    </div>
                    <div className="mt-1.5 font-mono text-xs text-ink-muted">{comm.reference}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                      <span>Total <span className="text-ink tabular-nums">${comm.total.toFixed(2)}</span></span>
                      <span>Commission <span className="text-emerald-600 font-semibold tabular-nums">${comm.amount.toFixed(2)}</span></span>
                      <span className={`inline-flex px-2 py-0.5 rounded font-medium ${
                        comm.status === 'paid' ? 'bg-emerald-500/10 text-emerald-600' :
                        comm.status === 'pending' ? 'bg-amber-500/10 text-amber-600' :
                        'bg-red-500/10 text-red-500'
                      }`}>
                        {comm.status}
                      </span>
                    </div>
                    {comm.status === 'pending' && (
                      <div className="mt-2.5">
                        <button
                          onClick={() => handleMarkPaid(comm)}
                          disabled={paying === comm.id}
                          className="inline-flex items-center gap-1 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-lg text-xs font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{paying === comm.id ? '...' : 'Mark Paid'}</span>
                        </button>
                      </div>
                    )}
                    {comm.status === 'paid' && comm.paid_at && (
                      <div className="mt-2 text-xs text-ink-muted">Paid {new Date(comm.paid_at).toLocaleDateString()}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!loading && (
            <Pagination
              page={safePage}
              pageCount={pageCount}
              onPageChange={setPage}
              total={filtered.length}
              pageSize={PAGE_SIZE}
            />
          )}
        </div>
      )}
    </>
  );
}

function CardsView({
  cards,
  loading,
  totalCommissions,
  payingAll,
  paying,
  onMarkAllPaid,
  onMarkPaid,
  onViewInTable,
}: {
  cards: RecipientCard[];
  loading: boolean;
  totalCommissions: number;
  payingAll: string | null;
  paying: string | null;
  onMarkAllPaid: (card: RecipientCard) => void;
  onMarkPaid: (comm: UnifiedCommission) => void;
  onViewInTable: (card: RecipientCard) => void;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-64 bg-white border border-line rounded-xl animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-line px-5 py-16 text-center text-ink-muted text-sm">
        {totalCommissions === 0
          ? 'No commissions yet'
          : 'No recipients match your filters'}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {cards.map((card) => (
        <RecipientCardView
          key={card.key}
          card={card}
          payingAll={payingAll === card.key}
          paying={paying}
          onMarkAllPaid={onMarkAllPaid}
          onMarkPaid={onMarkPaid}
          onViewInTable={onViewInTable}
        />
      ))}
    </div>
  );
}

function RecipientCardView({
  card,
  payingAll,
  paying,
  onMarkAllPaid,
  onMarkPaid,
  onViewInTable,
}: {
  card: RecipientCard;
  payingAll: boolean;
  paying: string | null;
  onMarkAllPaid: (card: RecipientCard) => void;
  onMarkPaid: (comm: UnifiedCommission) => void;
  onViewInTable: (card: RecipientCard) => void;
}) {
  const isAffiliate = card.source === 'affiliate';
  const initials = card.name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="bg-white border border-line rounded-xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-5 flex items-start gap-3 border-b border-line">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
            isAffiliate ? 'bg-blue-500/10 text-blue-500' : 'bg-purple-500/10 text-purple-500'
          }`}
        >
          {initials || (isAffiliate ? <Users className="w-4 h-4" /> : <Briefcase className="w-4 h-4" />)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink text-sm truncate">{card.name}</div>
          <div className="text-xs text-ink-muted truncate">{card.email || '—'}</div>
        </div>
        <span
          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
            isAffiliate ? 'bg-blue-500/10 text-blue-500' : 'bg-purple-500/10 text-purple-500'
          }`}
        >
          {isAffiliate ? 'Affiliate' : 'Sales'}
        </span>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
        <div className="px-3 py-3 text-center">
          <div className="text-[11px] uppercase tracking-wide text-ink-muted">Pending</div>
          <div className="text-sm font-bold text-vital tabular-nums">${card.pendingTotal.toFixed(2)}</div>
        </div>
        <div className="px-3 py-3 text-center">
          <div className="text-[11px] uppercase tracking-wide text-ink-muted">Paid</div>
          <div className="text-sm font-bold text-emerald-500 tabular-nums">${card.paidTotal.toFixed(2)}</div>
        </div>
        <div className="px-3 py-3 text-center">
          <div className="text-[11px] uppercase tracking-wide text-ink-muted">Entries</div>
          <div className="text-sm font-bold text-ink tabular-nums">{card.count}</div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="p-5 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-ink-muted mb-2">Recent</div>
        <div className="space-y-2">
          {card.recent.map((c) => (
            <div key={`${c.source}-${c.id}`} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-xs text-ink-muted truncate flex-1 min-w-0">{c.reference}</span>
              <span className="tabular-nums font-medium text-ink shrink-0">${c.amount.toFixed(2)}</span>
              {c.status === 'pending' ? (
                <button
                  onClick={() => onMarkPaid(c)}
                  disabled={paying === c.id}
                  title="Mark this commission paid"
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              ) : (
                <span
                  className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
                    c.status === 'paid'
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {c.status}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className="p-4 border-t border-line flex items-center gap-2">
        {card.pendingCount > 0 ? (
          <button
            onClick={() => onMarkAllPaid(card)}
            disabled={payingAll}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-lg text-xs font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-50 flex-1 justify-center"
          >
            <Check className="w-3.5 h-3.5" />
            {payingAll
              ? 'Paying…'
              : `Pay ${card.pendingCount} pending · $${card.pendingTotal.toFixed(2)}`}
          </button>
        ) : (
          <span className="text-xs text-ink-muted flex-1 text-center">All settled up</span>
        )}
        <button
          onClick={() => onViewInTable(card)}
          title="View all commissions in table"
          className="inline-flex items-center gap-1 px-3 py-2 border border-line text-ink-muted rounded-lg text-xs font-medium hover:text-ink hover:border-ink/20 transition-colors shrink-0"
        >
          Details
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
