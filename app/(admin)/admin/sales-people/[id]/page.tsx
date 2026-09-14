'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Briefcase, Network, Mail, Phone, Calendar, DollarSign, FileText,
  Users, Percent, Loader2, AlertCircle, Pencil, Trash2, KeyRound, Check, Power,
  ArrowUpCircle, Copy, Wallet, CircleDollarSign, ExternalLink, X, UserPlus, ListChecks,
  LockKeyhole,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { SalesPerson, Affiliate } from '@/lib/supabase';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { canEdit, canDelete } from '@/lib/permissions';
import { useToast } from '@/contexts/ToastContext';
import { INVOICE_STATUS_META } from '@/lib/admin/invoice-status';
import { updateSalesPerson } from '@/lib/admin/sales-persons';
import { markSalesCommissionPaid, markCommissionPaid, toggleAffiliateActive, sendCustomerMagicLink, sendCustomerPasswordReset } from '@/lib/admin/api';
import EditSalesPersonModal from '../_components/EditSalesPersonModal';
import DeletionReviewModal from '../../_components/DeletionReviewModal';
import PriceSheetButton from '../../_components/PriceSheetButton';
import EditAffiliateModal from '../../affiliates/_components/EditAffiliateModal';
import CreateCustomerModal from '../../customers/_components/CreateCustomerModal';
import CustomerPricingPanel from '../../customers/_components/CustomerPricingPanel';

interface CommissionRow {
  id: string;
  amount: number;
  base: number;
  commission_rate: number;
  status: string;
  paid_at: string | null;
  created_at: string;
  reference: string | null;
  invoice_id?: string | null;
}

interface DetailData {
  sales_person: SalesPerson;
  is_affiliate: boolean;
  affiliate: {
    id: string;
    referral_code: string | null;
    referral_uses: number;
    wallet_address: string | null;
    login_active: boolean | null;
    manual_code_only: boolean;
    total_earnings: number;
    referral_paid: number;
    referral_pending: number;
    price_currency: 'CAD' | 'USD';
  } | null;
  stats: { invoice_count: number; paid_earnings: number; pending_earnings: number };
  customers: { id: string; first_name: string | null; last_name: string | null; email: string; created_at: string; price_currency: string | null; active: boolean | null }[];
  invoices: { id: string; invoice_number: string; status_effective: string; currency: string; total: number; amount_paid: number; amount_due: number; issue_date: string; due_date: string; non_payable: boolean; is_backorder: boolean }[];
  commissions: { sales: CommissionRow[]; referral: CommissionRow[] };
}

function money(n: number, cur?: string | null) {
  const v = Number(n) || 0;
  const s = v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur ? `$${s} ${cur}` : `$${s}`;
}
function dateShort(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}
function nameOf(sp: { first_name?: string | null; last_name?: string | null; email?: string | null }) {
  return `${sp.first_name ?? ''} ${sp.last_name ?? ''}`.trim() || sp.email || '';
}
function toAffiliate(d: DetailData): Affiliate {
  const sp = d.sales_person;
  return {
    id: d.affiliate?.id ?? (sp.user_id as string),
    email: sp.email ?? '',
    first_name: sp.first_name,
    last_name: sp.last_name,
    wallet_address: d.affiliate?.wallet_address ?? null,
    password_hash: '',
    active: d.affiliate?.login_active ?? true,
    manual_code_only: d.affiliate?.manual_code_only ?? false,
    total_earnings: d.affiliate?.total_earnings ?? 0,
    price_currency: d.affiliate?.price_currency ?? 'CAD',
    created_at: sp.created_at,
    updated_at: sp.updated_at,
  };
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const meta = INVOICE_STATUS_META[status as keyof typeof INVOICE_STATUS_META];
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${meta?.badge ?? 'bg-gray-500/10 text-ink-muted'}`}>{meta?.label ?? status}</span>;
}

function CommStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid: 'bg-emerald-500/10 text-emerald-600',
    pending: 'bg-amber-500/10 text-amber-600',
    cancelled: 'bg-gray-500/10 text-ink-muted line-through',
  };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${map[status] ?? 'bg-gray-500/10 text-ink-muted'}`}>{status}</span>;
}

function Card({ title, icon: Icon, action, children }: { title: string; icon: any; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-line p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2"><Icon className="w-4 h-4 text-ink-muted" /><h2 className="text-sm font-semibold text-ink uppercase tracking-wider">{title}</h2></div>
        {action}
      </div>
      {children}
    </div>
  );
}

const TABS = [
  { key: 'overview', label: 'Overview', icon: Briefcase },
  { key: 'customers', label: 'Customers', icon: Users },
  { key: 'pricing', label: 'Pricing', icon: ListChecks },
  { key: 'invoices', label: 'Invoices', icon: FileText },
  { key: 'commissions', label: 'Commissions', icon: DollarSign },
] as const;
type TabKey = (typeof TABS)[number]['key'];

// Promote-a-rep-to-affiliate modal.
function PromoteModal({ data, onClose, onDone }: { data: DetailData; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(data.sales_person.email ?? '');
  const [wallet, setWallet] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError('An email is required for the affiliate login.'); return; }
    setBusy(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/sales-persons/${data.sales_person.id}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ email: email.trim(), wallet_address: wallet.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not promote to affiliate');
      // Email a set-password link, same as the Add Affiliate flow.
      if (json.affiliate_id) await sendCustomerMagicLink(json.affiliate_id, '/account/set-password');
      toast.success(`${nameOf(data.sales_person)} is now an affiliate — set-up link sent`);
      onDone();
    } catch (err: any) {
      setError(err.message || 'Could not promote to affiliate');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-xl border border-line shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h3 className="text-base font-bold text-ink">Promote to affiliate</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <p className="text-xs text-ink-muted">
            Gives {nameOf(data.sales_person)} a login and a referral code so they can create invoices for their
            own customers and earn referral commissions. Their existing commission history is kept.
          </p>
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2"><AlertCircle className="w-4 h-4 text-red-500 shrink-0" /><span className="text-red-700 text-xs">{error}</span></div>}
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">Login email <span className="text-red-500">*</span></label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-muted mb-1">Payout wallet (optional)</label>
            <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="0x…" className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:bg-surface">Cancel</button>
            <button type="submit" disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold hover:bg-ink/90 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />} Promote
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="max-w-6xl animate-pulse">
      <div className="h-4 w-32 bg-line/40 rounded mb-6" />
      <div className="flex items-center gap-3 mb-6"><div className="w-12 h-12 rounded-xl bg-line/40" /><div className="space-y-2"><div className="h-6 w-48 bg-line/40 rounded" /><div className="h-3 w-32 bg-line/30 rounded" /></div></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="rounded-xl border border-line bg-white p-4"><div className="h-3 w-16 bg-line/40 rounded mb-3" /><div className="h-5 w-20 bg-line/40 rounded" /></div>)}</div>
      <div className="grid lg:grid-cols-2 gap-6">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="bg-white rounded-xl border border-line p-6 space-y-3"><div className="h-3 w-24 bg-line/40 rounded mb-4" />{Array.from({ length: 4 }).map((__, j) => <div key={j} className="h-4 w-full bg-line/30 rounded" />)}</div>)}</div>
    </div>
  );
}

export default function SalesPersonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const role = useUserRole();
  const toast = useToast();
  const mayEdit = canEdit(role);
  const mayDelete = canDelete(role);

  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabKey>('overview');
  const [busy, setBusy] = useState(false);
  const [magic, setMagic] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [reset, setReset] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [editRep, setEditRep] = useState(false);
  const [editAff, setEditAff] = useState(false);
  const [del, setDel] = useState(false);
  const [promote, setPromote] = useState(false);
  const [addCustomer, setAddCustomer] = useState(false);
  const [editingRate, setEditingRate] = useState(false);
  const [rateValue, setRateValue] = useState('');
  const [markingId, setMarkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Not authenticated'); setLoading(false); return; }
      const res = await fetch(`/api/admin/sales-persons/${id}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || 'Failed to load sales person'); }
      setData(await res.json());
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load sales person');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const sp = data?.sales_person;

  const toggleActive = async () => {
    if (!data || !sp) return;
    setBusy(true);
    const next = sp.active === false;
    try {
      if (data.is_affiliate && sp.user_id) {
        const r = await toggleAffiliateActive(sp.user_id, next);
        if (!r.success) throw new Error(r.error);
      }
      await updateSalesPerson(sp.id, { active: next });
      toast.success(next ? 'Activated' : 'Deactivated');
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Could not update status');
    } finally {
      setBusy(false);
    }
  };

  const resendLink = async () => {
    if (!sp?.user_id || magic === 'sending') return;
    setMagic('sending');
    const r = await sendCustomerMagicLink(sp.user_id, '/account/set-password');
    if (r.success) { setMagic('sent'); toast.success('Set-up link sent'); setTimeout(() => setMagic('idle'), 3000); }
    else { setMagic('idle'); toast.error(r.error || 'Failed to send link'); }
  };

  // Emails a password-reset link — unlike the set-up link above it doesn't sign
  // them in, it drops them on /account/set-password to choose a new password.
  const sendPasswordReset = async () => {
    if (!sp?.user_id || reset === 'sending') return;
    setReset('sending');
    const r = await sendCustomerPasswordReset(sp.user_id);
    if (r.success) { setReset('sent'); toast.success('Password reset link sent'); setTimeout(() => setReset('idle'), 3000); }
    else { setReset('idle'); toast.error(r.error || 'Failed to send password reset link'); }
  };

  const saveRate = async () => {
    if (!sp) return;
    const rate = Number(rateValue);
    if (Number.isNaN(rate) || rate < 0 || rate > 100) { toast.error('Rate must be between 0 and 100'); return; }
    try {
      await updateSalesPerson(sp.id, { commission_rate: rate });
      toast.success('Commission rate updated');
      setEditingRate(false);
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Could not update rate');
    }
  };

  const markPaid = async (row: CommissionRow, source: 'sales' | 'referral') => {
    setMarkingId(row.id);
    const r = source === 'sales' ? await markSalesCommissionPaid(row.id) : await markCommissionPaid(row.id);
    setMarkingId(null);
    if (r.success) { toast.success('Marked paid'); await load(); }
    else toast.error(r.error || 'Could not mark paid');
  };

  if (loading) return <Skeleton />;
  if (error || !data || !sp) {
    return (
      <div className="max-w-3xl">
        <Link href="/admin/sales-people" className="inline-flex items-center gap-2 text-ink-muted hover:text-ink text-sm mb-6"><ArrowLeft className="w-4 h-4" /> Back to Sales People</Link>
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3"><AlertCircle className="w-5 h-5 text-red-500 shrink-0" /><span className="text-red-700 text-sm">{error || 'Sales person not found'}</span></div>
      </div>
    );
  }

  const name = nameOf(sp);
  const isAff = data.is_affiliate;
  const referralLink = data.affiliate?.referral_code && typeof window !== 'undefined' ? `${window.location.origin}?ref=${data.affiliate.referral_code}` : null;
  const boundCount = data.customers.length;

  return (
    <div className="max-w-6xl">
      <Link href="/admin/sales-people" className="inline-flex items-center gap-2 text-ink-muted hover:text-ink text-sm mb-6"><ArrowLeft className="w-4 h-4" /> Back to Sales People</Link>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-bronze/10 flex items-center justify-center shrink-0">
            {isAff ? <Network className="w-6 h-6 text-bronze" /> : <Briefcase className="w-6 h-6 text-bronze" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-ink truncate">{name}</h1>
              {isAff ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-emerald-500/10 text-emerald-600"><Network className="w-2.5 h-2.5" /> Affiliate</span>
              ) : (
                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-surface text-ink-muted border border-line">Rep</span>
              )}
              {sp.active === false && <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-red-500/10 text-red-500">Inactive</span>}
            </div>
            <p className="text-ink-muted text-sm break-all">{sp.email || 'No email on file'}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
            <PriceSheetButton type="salesperson" id={sp.id} defaultEmail={sp.email ?? ''} entityName={name} />
            {mayEdit && !isAff && (
              <button onClick={() => setPromote(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 text-sm font-medium hover:bg-emerald-500/20 transition-colors">
                <ArrowUpCircle className="w-4 h-4" /> Promote to affiliate
              </button>
            )}
            {mayEdit && isAff && (
              <button onClick={resendLink} disabled={magic === 'sending'} className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 ${magic === 'sent' ? 'border-green-500/20 bg-green-500/10 text-green-600' : 'border-blue-500/20 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20'}`}>
                {magic === 'sent' ? <Check className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
                {magic === 'sending' ? 'Sending…' : magic === 'sent' ? 'Link sent' : 'Set-up link'}
              </button>
            )}
            {mayEdit && isAff && sp.user_id && (
              <button onClick={sendPasswordReset} disabled={reset === 'sending'} title="Email a link to set a new password" className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 ${reset === 'sent' ? 'border-green-500/20 bg-green-500/10 text-green-600' : 'border-amber-500/20 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'}`}>
                {reset === 'sent' ? <Check className="w-4 h-4" /> : <LockKeyhole className="w-4 h-4" />}
                {reset === 'sending' ? 'Sending…' : reset === 'sent' ? 'Reset sent' : 'Reset password'}
              </button>
            )}
            {mayEdit && (
              <button onClick={() => (isAff ? setEditAff(true) : setEditRep(true))} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-white text-ink text-sm font-medium hover:bg-surface transition-colors"><Pencil className="w-4 h-4" /> Edit</button>
            )}
            {mayEdit && (
              <button onClick={toggleActive} disabled={busy} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-white text-ink-muted text-sm font-medium hover:text-ink hover:bg-surface transition-colors disabled:opacity-50"><Power className="w-4 h-4" /> {sp.active === false ? 'Activate' : 'Deactivate'}</button>
            )}
            {mayDelete && (
              <button onClick={() => setDel(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/20 bg-red-500/10 text-red-500 text-sm font-medium hover:bg-red-500/20 transition-colors"><Trash2 className="w-4 h-4" /></button>
            )}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <div className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-center gap-2 mb-1"><Percent className="w-4 h-4 text-ink-muted" /><span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Rate</span></div>
          <p className="text-lg font-bold text-ink tabular-nums">{sp.commission_rate}%</p>
          <p className="text-[11px] text-ink-muted">on invoices</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-center gap-2 mb-1"><FileText className="w-4 h-4 text-ink-muted" /><span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Invoices</span></div>
          <p className="text-lg font-bold text-ink tabular-nums">{data.stats.invoice_count}</p>
          <p className="text-[11px] text-ink-muted">as rep</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-center gap-2 mb-1"><DollarSign className="w-4 h-4 text-ink-muted" /><span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Invoice earned</span></div>
          <p className="text-lg font-bold text-emerald-600 tabular-nums">${data.stats.paid_earnings.toFixed(2)}</p>
          <p className="text-[11px] text-bronze tabular-nums">${data.stats.pending_earnings.toFixed(2)} pending</p>
        </div>
        <div className={`rounded-xl border p-4 ${isAff ? 'border-line bg-white' : 'border-line bg-surface/40'}`}>
          <div className="flex items-center gap-2 mb-1"><Users className="w-4 h-4 text-ink-muted" /><span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Customers</span></div>
          <p className="text-lg font-bold text-ink tabular-nums">{isAff ? boundCount : '—'}</p>
          <p className="text-[11px] text-ink-muted">bound</p>
        </div>
        <div className={`rounded-xl border p-4 ${isAff ? 'border-line bg-white' : 'border-line bg-surface/40'}`}>
          <div className="flex items-center gap-2 mb-1"><CircleDollarSign className="w-4 h-4 text-ink-muted" /><span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Referral earned</span></div>
          <p className="text-lg font-bold text-emerald-600 tabular-nums">{isAff ? `$${(data.affiliate?.referral_paid ?? 0).toFixed(2)}` : '—'}</p>
          <p className="text-[11px] text-bronze tabular-nums">{isAff ? `$${(data.affiliate?.referral_pending ?? 0).toFixed(2)} pending` : ''}</p>
        </div>
        <div className={`rounded-xl border p-4 ${isAff ? 'border-line bg-white' : 'border-line bg-surface/40'}`}>
          <div className="flex items-center gap-2 mb-1"><Network className="w-4 h-4 text-ink-muted" /><span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Referrals</span></div>
          <p className="text-lg font-bold text-ink tabular-nums">{isAff ? (data.affiliate?.referral_uses ?? 0) : '—'}</p>
          <p className="text-[11px] text-ink-muted">code uses</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-line mb-6 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            const count = t.key === 'customers' ? data.customers.length : t.key === 'invoices' ? data.invoices.length : t.key === 'commissions' ? data.commissions.sales.length + data.commissions.referral.length : null;
            if ((t.key === 'customers' || t.key === 'pricing') && !isAff) return null;
            return (
              <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? 'border-bronze text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>
                <Icon className="w-4 h-4" /> {t.label}
                {count != null && count > 0 && <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${active ? 'bg-bronze/15 text-bronze' : 'bg-surface text-ink-muted'}`}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* OVERVIEW */}
      {tab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Card title="Profile" icon={Briefcase}>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3"><Mail className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" />{sp.email ? <a href={`mailto:${sp.email}`} className="text-bronze font-medium break-all hover:underline">{sp.email}</a> : <span className="text-ink-muted">No email</span>}</div>
              <div className="flex items-start gap-3"><Phone className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" />{sp.phone ? <a href={`tel:${sp.phone}`} className="text-bronze font-medium hover:underline">{sp.phone}</a> : <span className="text-ink-muted">No phone</span>}</div>
              <div className="flex items-start gap-3"><Calendar className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" /><span className="text-ink">Added {dateShort(sp.created_at)}</span></div>
              {isAff && (
                <>
                  <div className="flex items-start gap-3"><Wallet className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" /><span className="text-ink break-all">{data.affiliate?.wallet_address || <span className="text-ink-muted">No payout wallet</span>}</span></div>
                  <div className="flex items-start gap-3"><KeyRound className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" /><span className="text-ink">Login {data.affiliate?.login_active === false ? 'disabled' : 'active'}</span></div>
                </>
              )}
            </div>
          </Card>

          <Card title="Commission & account" icon={Percent}>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-muted">Invoice commission rate</span>
                {editingRate ? (
                  <span className="inline-flex items-center gap-1">
                    <input type="number" step="0.01" min="0" max="100" value={rateValue} onChange={(e) => setRateValue(e.target.value)} className="w-20 px-2 py-1 bg-surface border border-line rounded text-sm text-ink text-right focus:outline-none focus:ring-2 focus:ring-bronze/40" autoFocus />
                    <span className="text-ink-muted">%</span>
                    <button onClick={saveRate} className="w-7 h-7 inline-flex items-center justify-center rounded border border-line text-emerald-600 hover:bg-emerald-50"><Check className="w-4 h-4" /></button>
                    <button onClick={() => setEditingRate(false)} className="w-7 h-7 inline-flex items-center justify-center rounded border border-line text-ink-muted hover:bg-surface"><X className="w-4 h-4" /></button>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <span className="font-semibold text-ink tabular-nums">{sp.commission_rate}%</span>
                    {mayEdit && <button onClick={() => { setRateValue(String(sp.commission_rate)); setEditingRate(true); }} className="text-bronze hover:underline text-xs">Edit</button>}
                  </span>
                )}
              </div>
              {isAff && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-muted">Referral rate</span>
                  <span className="font-semibold text-ink tabular-nums">10% <span className="text-ink-muted font-normal text-xs">(fixed)</span></span>
                </div>
              )}
              {isAff && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-muted">Billing currency</span>
                  <span className="inline-flex items-center gap-2">
                    <span className="font-semibold text-ink">{data.affiliate?.price_currency ?? 'CAD'}</span>
                    {mayEdit && <button onClick={() => setEditAff(true)} className="text-bronze hover:underline text-xs">Edit</button>}
                  </span>
                </div>
              )}
              {sp.notes && <div className="pt-2 border-t border-line"><div className="text-ink-muted text-xs mb-1">Notes</div><p className="text-ink whitespace-pre-wrap">{sp.notes}</p></div>}
            </div>
          </Card>

          {isAff && data.affiliate?.referral_code && (
            <Card title="Referral link" icon={Network}>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-sm px-2 py-1 rounded bg-surface border border-line text-ink">{data.affiliate.referral_code}</span>
                <span className="text-xs text-ink-muted">{data.affiliate.referral_uses} uses</span>
              </div>
              {referralLink && (
                <button onClick={() => { navigator.clipboard?.writeText(referralLink); toast.success('Referral link copied'); }} className="inline-flex items-center gap-2 text-sm text-bronze hover:underline break-all">
                  <Copy className="w-3.5 h-3.5 shrink-0" /> {referralLink}
                </button>
              )}
            </Card>
          )}

          <Card title="Recent invoices" icon={FileText} action={data.invoices.length > 5 ? <button onClick={() => setTab('invoices')} className="text-xs text-bronze hover:underline">View all</button> : undefined}>
            {data.invoices.length === 0 ? <p className="text-sm text-ink-muted">No invoices yet.</p> : (
              <div className="space-y-2">
                {data.invoices.slice(0, 5).map((inv) => (
                  <Link key={inv.id} href={`/admin/invoices/${inv.id}`} className="flex items-center justify-between gap-3 p-2.5 bg-surface rounded-lg border border-line hover:border-bronze/40 transition-colors">
                    <div className="min-w-0"><div className="flex items-center gap-2"><span className="text-sm font-medium text-ink truncate">{inv.invoice_number}</span><InvoiceStatusBadge status={inv.status_effective} /></div><p className="text-[11px] text-ink-muted">{dateShort(inv.issue_date)}</p></div>
                    <div className="text-sm font-semibold text-ink tabular-nums shrink-0">{money(inv.total, inv.currency)}</div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* CUSTOMERS */}
      {tab === 'customers' && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-sm text-ink-muted">{boundCount === 1 ? '1 customer' : `${boundCount} customers`} bound to this affiliate.</p>
            {mayEdit && (
              <button onClick={() => setAddCustomer(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-ink text-white text-sm font-semibold hover:bg-ink/90 transition-colors">
                <UserPlus className="w-4 h-4" /> New Customer
              </button>
            )}
          </div>
          <div className="bg-white rounded-xl border border-line overflow-hidden">
            {data.customers.length === 0 ? <div className="text-center py-12 text-ink-muted text-sm">No customers bound to this affiliate yet.</div> : (
              <div className="divide-y divide-line/50">
                {data.customers.map((c) => (
                  <Link key={c.id} href={`/admin/customers/${c.id}`} className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-surface transition-colors">
                    <div className="min-w-0"><div className="text-sm font-medium text-ink truncate">{nameOf(c)}</div><div className="text-xs text-ink-muted break-all">{c.email}</div></div>
                    <div className="flex items-center gap-3 shrink-0">
                      {c.active === false && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">Inactive</span>}
                      <span className="text-xs text-ink-muted">Since {dateShort(c.created_at)}</span>
                      <ExternalLink className="w-4 h-4 text-ink-light" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PRICING (affiliates only) — the affiliate's own price record drives
          their invoices and syncs to their bound customers. */}
      {tab === 'pricing' && isAff && sp.user_id && (
        <div>
          <div className="mb-3 text-sm text-ink-muted">
            Apply a price list to this affiliate — optionally multiply, convert, or round it first. Their prices
            drive the invoices they raise and sync to the {boundCount} customer{boundCount !== 1 ? 's' : ''} bound to them.
          </div>
          <div className="bg-white rounded-xl border border-line p-5 sm:p-6">
            <CustomerPricingPanel
              customer={{
                id: sp.user_id,
                first_name: sp.first_name,
                last_name: sp.last_name,
                email: sp.email,
              }}
              variant="card"
              onApplied={() => load()}
            />
          </div>
        </div>
      )}

      {/* INVOICES */}
      {tab === 'invoices' && (
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          {data.invoices.length === 0 ? <div className="text-center py-12 text-ink-muted text-sm">No invoices for this sales person.</div> : (
            <>
            {/* Desktop table (≥lg) / mobile cards — ADR 0007. */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead><tr className="border-b border-line"><th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Invoice</th><th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Issued</th><th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th><th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Total</th><th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Balance</th></tr></thead>
                <tbody className="divide-y divide-line/50">
                  {data.invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-surface transition-colors">
                      <td className="px-5 py-3"><Link href={`/admin/invoices/${inv.id}`} className="text-sm font-medium text-ink hover:text-bronze">{inv.invoice_number}</Link></td>
                      <td className="px-5 py-3 text-sm text-ink-muted whitespace-nowrap">{dateShort(inv.issue_date)}</td>
                      <td className="px-5 py-3"><InvoiceStatusBadge status={inv.status_effective} /></td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-ink tabular-nums whitespace-nowrap">{money(inv.total, inv.currency)}</td>
                      <td className="px-5 py-3 text-right text-sm tabular-nums whitespace-nowrap">{inv.non_payable ? <span className="text-ink-muted">—</span> : inv.amount_due > 0 ? <span className="text-amber-600 font-semibold">{money(inv.amount_due, inv.currency)}</span> : <span className="text-emerald-600">Paid</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards (below lg) */}
            <ul className="lg:hidden divide-y divide-line/50">
              {data.invoices.map((inv) => (
                <li key={inv.id} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/admin/invoices/${inv.id}`} className="text-sm font-medium text-ink hover:text-bronze">{inv.invoice_number}</Link>
                    <InvoiceStatusBadge status={inv.status_effective} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                    <span>Issued <span className="text-ink">{dateShort(inv.issue_date)}</span></span>
                    <span>Total <span className="text-ink font-semibold tabular-nums">{money(inv.total, inv.currency)}</span></span>
                    <span>
                      Balance{' '}
                      {inv.non_payable ? <span className="text-ink-muted">—</span>
                        : inv.amount_due > 0 ? <span className="text-amber-600 font-semibold tabular-nums">{money(inv.amount_due, inv.currency)}</span>
                          : <span className="text-emerald-600">Paid</span>}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            </>
          )}
        </div>
      )}

      {/* COMMISSIONS */}
      {tab === 'commissions' && (
        <div className="space-y-6">
          <CommissionTable title="Invoice commissions" rows={data.commissions.sales} source="sales" mayMark={mayEdit} markingId={markingId} onMark={markPaid} refLabel="Invoice" />
          {isAff && <CommissionTable title="Referral commissions" rows={data.commissions.referral} source="referral" mayMark={mayEdit} markingId={markingId} onMark={markPaid} refLabel="Order" />}
        </div>
      )}

      {/* Modals */}
      {editRep && sp && <EditSalesPersonModal person={sp} onClose={() => setEditRep(false)} onUpdated={() => { setEditRep(false); load(); }} />}
      {editAff && <EditAffiliateModal affiliate={toAffiliate(data)} onClose={() => setEditAff(false)} onUpdated={() => { setEditAff(false); load(); }} />}
      {del && (isAff
        ? <DeletionReviewModal
            kind="affiliate"
            entity={{
              id: data.affiliate?.id ?? (sp.user_id as string),
              first_name: sp.first_name,
              last_name: sp.last_name,
              email: sp.email,
            }}
            onClose={() => setDel(false)}
            onDeleted={() => router.push('/admin/sales-people')}
          />
        : <DeletionReviewModal kind="sales_person" entity={sp} onClose={() => setDel(false)} onDeleted={() => router.push('/admin/sales-people')} />)}
      {promote && <PromoteModal data={data} onClose={() => setPromote(false)} onDone={() => { setPromote(false); load(); }} />}
      {addCustomer && data.affiliate && (
        <CreateCustomerModal
          affiliateId={data.affiliate.id}
          onClose={() => setAddCustomer(false)}
          onCreated={() => { setAddCustomer(false); load(); }}
        />
      )}
    </div>
  );
}

function CommissionTable({ title, rows, source, mayMark, markingId, onMark, refLabel }: {
  title: string; rows: CommissionRow[]; source: 'sales' | 'referral'; mayMark: boolean; markingId: string | null; onMark: (r: CommissionRow, s: 'sales' | 'referral') => void; refLabel: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-line overflow-hidden">
      <div className="px-5 py-3.5 border-b border-line flex items-center gap-2"><DollarSign className="w-4 h-4 text-ink-muted" /><h3 className="text-sm font-semibold text-ink uppercase tracking-wider">{title}</h3><span className="text-xs text-ink-muted ml-auto">{rows.length}</span></div>
      {rows.length === 0 ? <div className="text-center py-8 text-ink-muted text-sm">None yet.</div> : (
        <>
        {/* Desktop table (≥lg) / mobile cards — ADR 0007. */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead><tr className="border-b border-line"><th className="px-5 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Date</th><th className="px-5 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">{refLabel}</th><th className="px-5 py-2.5 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Base</th><th className="px-5 py-2.5 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Commission</th><th className="px-5 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th><th className="px-5 py-2.5" /></tr></thead>
            <tbody className="divide-y divide-line/50">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface transition-colors">
                  <td className="px-5 py-3 text-sm text-ink-muted whitespace-nowrap">{dateShort(r.created_at)}</td>
                  <td className="px-5 py-3 text-sm text-ink">{r.invoice_id ? <Link href={`/admin/invoices/${r.invoice_id}`} className="hover:text-bronze">{r.reference || '—'}</Link> : (r.reference || '—')}</td>
                  <td className="px-5 py-3 text-right text-sm text-ink-muted tabular-nums">${r.base.toFixed(2)}</td>
                  <td className="px-5 py-3 text-right text-sm font-semibold text-ink tabular-nums whitespace-nowrap">${r.amount.toFixed(2)} <span className="text-ink-muted font-normal">({r.commission_rate}%)</span></td>
                  <td className="px-5 py-3"><CommStatusBadge status={r.status} /></td>
                  <td className="px-5 py-3 text-right">
                    {mayMark && r.status === 'pending' && (
                      <button onClick={() => onMark(r, source)} disabled={markingId === r.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 text-xs font-medium hover:bg-emerald-500/20 disabled:opacity-50">
                        {markingId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Mark paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards (below lg) */}
        <ul className="lg:hidden divide-y divide-line/50">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-sm text-ink">
                  {r.invoice_id ? <Link href={`/admin/invoices/${r.invoice_id}`} className="hover:text-bronze">{r.reference || '—'}</Link> : (r.reference || '—')}
                  <div className="text-xs text-ink-muted mt-0.5">{dateShort(r.created_at)}</div>
                </div>
                <CommStatusBadge status={r.status} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-muted">
                <span>Base <span className="text-ink tabular-nums">${r.base.toFixed(2)}</span></span>
                <span>Commission <span className="text-ink font-semibold tabular-nums">${r.amount.toFixed(2)}</span> ({r.commission_rate}%)</span>
              </div>
              {mayMark && r.status === 'pending' && (
                <div className="mt-2.5">
                  <button onClick={() => onMark(r, source)} disabled={markingId === r.id} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 text-xs font-medium hover:bg-emerald-500/20 disabled:opacity-50">
                    {markingId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Mark paid
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}
