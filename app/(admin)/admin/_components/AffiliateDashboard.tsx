'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Users, DollarSign, Clock, Copy, Check, ArrowRight, FileText, BarChart3, Receipt } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSmartLoad } from '@/lib/hooks/useSmartLoad';
import { LoadingError, SlowLoadingNotice } from '@/components/LoadingFeedback';

interface Summary {
  firstName: string;
  referralCode: string | null;
  boundCustomers: number;
  pendingEarnings: number;
  paidEarnings: number;
}

interface CommissionRow {
  id: string;
  source: 'referral' | 'sales';
  amount: number;
  base: number;
  rate: number | null;
  status: string;
  reference: string | null;
  created_at: string;
}

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  status: string;
  status_effective: string;
  issue_date: string | null;
  due_date: string | null;
  total: number;
  currency: string;
  customer_name: string | null;
  amount_due: number;
  created_at: string;
}

async function authedGet<T>(path: string): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

const statusColors: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-500',
  paid: 'bg-emerald-500/10 text-emerald-500',
  cancelled: 'bg-red-500/10 text-red-400',
};

const invoiceStatusColors: Record<string, string> = {
  draft: 'bg-gray-500/10 text-gray-500',
  sent: 'bg-blue-500/10 text-blue-500',
  partial: 'bg-amber-500/10 text-amber-500',
  paid: 'bg-emerald-500/10 text-emerald-500',
  overdue: 'bg-red-500/10 text-red-500',
  cancelled: 'bg-red-500/10 text-red-400',
};

export default function AffiliateDashboard() {
  const [tab, setTab] = useState<'overview' | 'invoices' | 'commissions'>('overview');

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-ink">Client Dashboard</h1>
        <p className="text-sm text-ink-muted">Your referrals, customers, invoices and earnings.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-line">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} icon={BarChart3} label="Overview" />
        <TabButton active={tab === 'invoices'} onClick={() => setTab('invoices')} icon={FileText} label="Invoices" />
        <TabButton active={tab === 'commissions'} onClick={() => setTab('commissions')} icon={Receipt} label="Commissions" />
      </div>

      {tab === 'overview' ? <OverviewTab /> : tab === 'invoices' ? <InvoicesTab /> : <CommissionsTab />}
    </>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:text-ink'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function OverviewTab() {
  const { data, loading, slow, error, reload } = useSmartLoad(() => authedGet<Summary>('/api/affiliate/me'), []);
  const [copied, setCopied] = useState(false);

  const referralUrl =
    data?.referralCode && typeof window !== 'undefined'
      ? `${window.location.origin}?ref=${data.referralCode}`
      : '';

  const copy = async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  if (error) return <LoadingError onRetry={reload} />;

  return (
    <>
      {slow && loading && <SlowLoadingNotice onReload={reload} />}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 mb-8">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-5 border border-line animate-pulse">
              <div className="w-10 h-10 bg-surface rounded-lg mb-3" />
              <div className="h-8 w-24 bg-surface rounded mb-2" />
              <div className="h-3 w-20 bg-surface rounded" />
            </div>
          ))
        ) : (
          <>
            <StatCard icon={Users} tint="blue" value={String(data?.boundCustomers ?? 0)} label="Your Customers" />
            <StatCard icon={Clock} tint="vital" value={`$${(data?.pendingEarnings ?? 0).toFixed(2)}`} label="Pending Earnings" />
            <StatCard icon={DollarSign} tint="emerald" value={`$${(data?.paidEarnings ?? 0).toFixed(2)}`} label="Paid Earnings" />
          </>
        )}
      </div>

      {!loading && data?.referralCode && (
        <div className="bg-white rounded-xl border border-line p-5 md:p-6 mb-6">
          <h2 className="text-sm font-semibold text-ink mb-1">Your referral link</h2>
          <p className="text-xs text-ink-muted mb-3">
            Customers who sign up through this link are bound to you automatically.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2.5 bg-surface border border-line rounded-lg text-sm text-ink truncate">
              {referralUrl}
            </code>
            <button
              onClick={copy}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-ink text-white text-sm font-medium rounded-lg hover:bg-ink/90 transition-colors"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <QuickLink href="/admin/customers" icon={Users} label="Your customers" />
        <QuickLink href="/admin/invoices" icon={FileText} label="Create an invoice" />
      </div>
    </>
  );
}

function CommissionsTab() {
  const { data, loading, slow, error, reload } = useSmartLoad(
    () => authedGet<{ commissions: CommissionRow[]; totals: { paid: number; pending: number; total: number } }>('/api/affiliate/commissions'),
    [],
  );

  if (error) return <LoadingError onRetry={reload} />;

  const rows = data?.commissions ?? [];
  const totals = data?.totals ?? { paid: 0, pending: 0, total: 0 };

  return (
    <>
      {slow && loading && <SlowLoadingNotice onReload={reload} />}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard icon={Clock} tint="vital" value={`$${totals.pending.toFixed(2)}`} label="Pending" loading={loading} />
        <StatCard icon={DollarSign} tint="emerald" value={`$${totals.paid.toFixed(2)}`} label="Paid" loading={loading} />
        <StatCard icon={Receipt} tint="blue" value={`$${totals.total.toFixed(2)}`} label="Total" loading={loading} />
      </div>

      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="p-5 border-b border-line">
          <h2 className="text-lg font-bold text-ink">Commission history</h2>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-5 bg-surface rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <>
          {/* Desktop table (≥lg) / mobile cards — ADR 0007. */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Date</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Source</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Reference</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Base</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Commission</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {rows.map((c) => (
                  <tr key={`${c.source}-${c.id}`} className="hover:bg-surface transition-colors">
                    <td className="px-5 py-4 text-sm text-ink-muted whitespace-nowrap">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-4">
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-surface text-ink-muted capitalize">
                        {c.source === 'sales' ? 'Invoice' : 'Referral'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-ink font-mono">{c.reference || '—'}</td>
                    <td className="px-5 py-4 text-sm text-ink-muted tabular-nums">${c.base.toFixed(2)}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-ink tabular-nums">
                      ${c.amount.toFixed(2)}
                      {c.rate != null && <span className="text-ink-muted font-normal"> ({c.rate}%)</span>}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize ${statusColors[c.status] || 'bg-surface text-ink-muted'}`}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-ink-muted text-sm">
                      No commissions yet. Earnings appear here as your customers order and you're invoiced.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards (below lg) */}
          <ul className="lg:hidden divide-y divide-line/50">
            {rows.length === 0 ? (
              <li className="px-5 py-12 text-center text-ink-muted text-sm">No commissions yet. Earnings appear here as your customers order and you&apos;re invoiced.</li>
            ) : rows.map((c) => (
              <li key={`${c.source}-${c.id}`} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-ink font-mono">{c.reference || '—'}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted flex-wrap">
                      <span className="inline-flex px-2 py-0.5 rounded font-medium bg-surface capitalize">{c.source === 'sales' ? 'Invoice' : 'Referral'}</span>
                      <span>{new Date(c.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <span className={`inline-flex shrink-0 px-2 py-0.5 rounded text-xs font-medium capitalize ${statusColors[c.status] || 'bg-surface text-ink-muted'}`}>{c.status}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                  <span>Base <span className="text-ink tabular-nums">${c.base.toFixed(2)}</span></span>
                  <span>Commission <span className="text-ink font-semibold tabular-nums">${c.amount.toFixed(2)}</span>{c.rate != null && <span className="text-ink-muted"> ({c.rate}%)</span>}</span>
                </div>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>
    </>
  );
}

function InvoicesTab() {
  const { data, loading, slow, error, reload } = useSmartLoad(
    () => authedGet<{ invoices: InvoiceRow[]; totals: { count: number; outstanding: number; paid: number } }>('/api/affiliate/invoices'),
    [],
  );

  if (error) return <LoadingError onRetry={reload} />;

  const rows = data?.invoices ?? [];
  const totals = data?.totals ?? { count: 0, outstanding: 0, paid: 0 };
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

  return (
    <>
      {slow && loading && <SlowLoadingNotice onReload={reload} />}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard icon={FileText} tint="blue" value={String(totals.count)} label="Your Invoices" loading={loading} />
        <StatCard icon={Clock} tint="vital" value={`$${totals.outstanding.toFixed(2)}`} label="Outstanding" loading={loading} />
        <StatCard icon={DollarSign} tint="emerald" value={String(totals.paid)} label="Paid" loading={loading} />
      </div>

      <div className="bg-white rounded-xl border border-line overflow-hidden">
        <div className="p-5 border-b border-line">
          <h2 className="text-lg font-bold text-ink">Invoices you&rsquo;re the sales person on</h2>
          <p className="text-xs text-ink-muted mt-0.5">Every invoice you&rsquo;re attached to, newest first.</p>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-5 bg-surface rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <>
          {/* Desktop table (≥lg) / mobile cards — ADR 0007. */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Invoice</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Customer</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Issued</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Total</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Due</th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {rows.map((inv) => (
                  <tr key={inv.id} className="hover:bg-surface transition-colors">
                    <td className="px-5 py-4">
                      <Link href={`/admin/invoices/${inv.id}`} className="text-sm font-mono font-medium text-ink hover:text-vital inline-flex items-center gap-1">
                        {inv.invoice_number || inv.id.slice(0, 8)}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-sm text-ink">{inv.customer_name || '—'}</td>
                    <td className="px-5 py-4 text-sm text-ink-muted whitespace-nowrap">{fmtDate(inv.issue_date)}</td>
                    <td className="px-5 py-4 text-sm font-semibold text-ink tabular-nums whitespace-nowrap">
                      ${inv.total.toFixed(2)} {inv.currency}
                    </td>
                    <td className="px-5 py-4 text-sm text-ink-muted tabular-nums whitespace-nowrap">
                      ${inv.amount_due.toFixed(2)}
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize ${invoiceStatusColors[inv.status_effective] || 'bg-surface text-ink-muted'}`}>
                        {inv.status_effective}
                      </span>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-ink-muted text-sm">
                      No invoices yet. Invoices you&rsquo;re assigned to as the sales person show up here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards (below lg) */}
          <ul className="lg:hidden divide-y divide-line/50">
            {rows.length === 0 ? (
              <li className="px-5 py-12 text-center text-ink-muted text-sm">No invoices yet. Invoices you&rsquo;re assigned to as the sales person show up here.</li>
            ) : rows.map((inv) => (
              <li key={inv.id} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/admin/invoices/${inv.id}`} className="text-sm font-mono font-medium text-ink hover:text-vital inline-flex items-center gap-1">
                    {inv.invoice_number || inv.id.slice(0, 8)}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                  <span className={`inline-flex shrink-0 px-2 py-0.5 rounded text-xs font-medium capitalize ${invoiceStatusColors[inv.status_effective] || 'bg-surface text-ink-muted'}`}>{inv.status_effective}</span>
                </div>
                <div className="mt-1 text-sm text-ink">{inv.customer_name || '—'}</div>
                <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                  <span>Issued <span className="text-ink">{fmtDate(inv.issue_date)}</span></span>
                  <span>Total <span className="text-ink font-semibold tabular-nums">${inv.total.toFixed(2)} {inv.currency}</span></span>
                  <span>Due <span className="text-ink tabular-nums">${inv.amount_due.toFixed(2)}</span></span>
                </div>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>
    </>
  );
}

function StatCard({
  icon: Icon,
  tint,
  value,
  label,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: 'blue' | 'vital' | 'emerald';
  value: string;
  label: string;
  loading?: boolean;
}) {
  const tints: Record<string, string> = {
    blue: 'bg-blue-500/10 text-blue-400',
    vital: 'bg-vital/10 text-vital',
    emerald: 'bg-emerald-500/10 text-emerald-400',
  };
  if (loading) {
    return (
      <div className="bg-white rounded-xl p-5 border border-line animate-pulse">
        <div className="w-10 h-10 bg-surface rounded-lg mb-3" />
        <div className="h-8 w-20 bg-surface rounded mb-2" />
        <div className="h-3 w-16 bg-surface rounded" />
      </div>
    );
  }
  return (
    <div className="bg-white rounded-xl p-5 border border-line">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${tints[tint]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-2xl md:text-3xl font-bold text-ink tabular-nums">{value}</p>
      <p className="text-xs text-ink-muted mt-1">{label}</p>
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="bg-white rounded-xl border border-line p-5 hover:border-ink/20 transition-colors flex items-center justify-between"
    >
      <span className="flex items-center gap-2 text-sm font-medium text-ink">
        <Icon className="w-4 h-4 text-ink-muted" /> {label}
      </span>
      <ArrowRight className="w-4 h-4 text-ink-muted" />
    </Link>
  );
}
