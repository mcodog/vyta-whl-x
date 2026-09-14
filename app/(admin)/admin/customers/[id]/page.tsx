'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, User, Mail, Phone, MapPin, Calendar, Clock, DollarSign, FileText,
  Users, Tag, Pencil, Trash2, KeyRound, Check, Loader2, AlertCircle, UserCheck,
  ShoppingCart, Package, Plus, X, Truck, Store, Briefcase, Network, Percent,
  AlertTriangle, ReceiptText, CircleDollarSign, Building2, ExternalLink, Handshake,
  LockKeyhole,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { CustomerClient } from '@/lib/supabase';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { canEdit, canDelete } from '@/lib/permissions';
import { useToast } from '@/contexts/ToastContext';
import { INVOICE_STATUS_META } from '@/lib/admin/invoice-status';
import { deleteCustomer, sendCustomerPasswordReset } from '@/lib/admin/api';
import EditCustomerModal from '../_components/EditCustomerModal';
import DeletionReviewModal from '../../_components/DeletionReviewModal';
import CustomerPricingModal from '../_components/CustomerPricingModal';
import PriceSheetButton from '../../_components/PriceSheetButton';
import SalesTeamCard, { type SalesTeamMember } from '../_components/SalesTeamCard';
import CustomerMoneyFlow, { type SalesFlowData } from '../_components/CustomerMoneyFlow';

// ---- API response shape --------------------------------------------------

type Currency = 'CAD' | 'USD';

interface ArBucket {
  invoiced: number;
  paid: number;
  outstanding: number;
  overdue: number;
  count: number;
  openCount: number;
  overdueCount: number;
  paidCount: number;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  status: string;
  status_effective: string;
  currency: Currency;
  total: number;
  amount_paid: number;
  amount_due: number;
  issue_date: string;
  due_date: string;
  created_at: string;
  is_backorder: boolean;
  non_payable: boolean;
  fulfillment_status: string | null;
  fulfillment_type: string | null;
  ships_to_client: boolean;
  client_id: string | null;
  invoice_type: string;
  payments: { amount: number; paid_at: string | null; method: string | null }[];
}

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  total: number;
  created_at: string;
}

interface CustomerData {
  customer: any;
  invoices: InvoiceRow[];
  ar: Record<Currency, ArBucket>;
  orders: OrderRow[];
  ordersSummary: { count: number; lifetimeSpent: number };
  clients: CustomerClient[];
  pricing: {
    appliedPricelistName: string | null;
    appliedPricelistActive: boolean | null;
    customPriceCount: number;
    hiddenCount: number;
    overrideCount: number;
  };
  cart: { items: any[]; updatedAt: string | null };
  assignment: {
    assignedAdminId: string | null;
    assignedAdminName: string | null;
    assignedAdminEmail: string | null;
    assignedAt: string | null;
    isMine: boolean;
  };
  /** Who is assigned to this customer, and — for staff — what each has earned
   *  from them. Null for an affiliate: the API withholds colleagues' money. */
  salesFlow?: (SalesFlowData & { team: SalesTeamMember[] }) | null;
}

// ---- helpers -------------------------------------------------------------

function money(n: number, cur?: Currency | null) {
  const v = Number(n) || 0;
  const s = v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur ? `$${s} ${cur}` : `$${s}`;
}

function dateLabel(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
}

function dateShort(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

const orderStatusColors: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  received: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
  confirmed: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  processing: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  shipped: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
  delivered: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  cancelled: 'bg-red-500/10 text-red-500 border-red-500/20',
  expired: 'bg-gray-500/10 text-ink-muted border-line',
};

function InvoiceStatusBadge({ status }: { status: string }) {
  const meta = INVOICE_STATUS_META[status as keyof typeof INVOICE_STATUS_META];
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${meta?.badge ?? 'bg-gray-500/10 text-ink-muted'}`}>
      {meta?.label ?? status}
    </span>
  );
}

// Warehouse fulfillment stage for a ship-to-client shipment (distinct from the
// invoice payment status). Used on the Clients tab's per-client shipment list.
const FULFILLMENT_META: Record<
  string,
  { label: string; badge: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  pending: { label: 'Preparing', badge: 'bg-amber-500/10 text-amber-600', Icon: Clock },
  packed: { label: 'Packed', badge: 'bg-blue-500/10 text-blue-500', Icon: Package },
  shipped: { label: 'Shipped', badge: 'bg-indigo-500/10 text-indigo-500', Icon: Truck },
  picked_up: { label: 'Picked up', badge: 'bg-emerald-500/10 text-emerald-600', Icon: Check },
  dropped_off: { label: 'Dropped off', badge: 'bg-emerald-500/10 text-emerald-600', Icon: Check },
};

function FulfillmentBadge({ status }: { status: string | null }) {
  const meta = status ? FULFILLMENT_META[status] : undefined;
  if (!meta) {
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-500/10 text-ink-muted shrink-0">
        Not shipped
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${meta.badge}`}>
      <meta.Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

const TABS = [
  { key: 'overview', label: 'Overview', icon: User },
  { key: 'sales', label: 'Sales & commission', icon: Briefcase },
  { key: 'invoices', label: 'Invoices', icon: FileText },
  { key: 'clients', label: 'Clients', icon: Users },
  { key: 'orders', label: 'Orders', icon: Package },
  { key: 'pricing', label: 'Pricing', icon: Tag },
  { key: 'activity', label: 'Activity', icon: Clock },
] as const;
type TabKey = (typeof TABS)[number]['key'];

// ---- add-client modal ----------------------------------------------------

function AddClientModal({
  customerId,
  onClose,
  onCreated,
}: {
  customerId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    first_name: '', last_name: '', address: '', city: '', state: '',
    postal_code: '', country: 'CA', phone: '', email: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.address.trim()) {
      setError('A shipping address is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/customers/${customerId}/clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not add client');
      }
      onCreated();
    } catch (err: any) {
      setError(err.message || 'Could not add client');
      setSaving(false);
    }
  };

  const field = (k: keyof typeof form, label: string, required = false) => (
    <div>
      <label className="block text-xs font-medium text-ink-muted mb-1">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      <input
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
        className="w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-vital/40"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white rounded-xl border border-line shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h3 className="text-base font-bold text-ink">Add ship-to client</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <p className="text-xs text-ink-muted">
            A client is an end-recipient this customer ships to. It&apos;s billed to the customer;
            the client only ever receives a packing list.
          </p>
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="text-red-700 text-xs">{error}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {field('first_name', 'First name')}
            {field('last_name', 'Last name')}
          </div>
          {field('address', 'Address', true)}
          <div className="grid grid-cols-2 gap-3">
            {field('city', 'City')}
            {field('state', 'Province / State')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field('postal_code', 'Postal code')}
            {field('country', 'Country')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field('phone', 'Phone')}
            {field('email', 'Email')}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-line text-sm text-ink-muted hover:text-ink hover:bg-surface">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold hover:bg-ink/90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add client
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- small presentational helpers ---------------------------------------

function Card({ title, icon: Icon, action, children }: {
  title: string; icon: any; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-line p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-ink-muted" />
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wider">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ icon: Icon, children }: { icon: any; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <Icon className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" />
      <div className="min-w-0 text-ink">{children}</div>
    </div>
  );
}

// Loading placeholder that mirrors the page shell so the layout doesn't jump.
function CustomerDetailSkeleton() {
  return (
    <div className="max-w-6xl animate-pulse">
      <div className="h-4 w-32 bg-line/40 rounded mb-6" />
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-line/40" />
        <div className="space-y-2">
          <div className="h-6 w-48 bg-line/40 rounded" />
          <div className="h-3 w-32 bg-line/30 rounded" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-white p-4">
            <div className="h-3 w-16 bg-line/40 rounded mb-3" />
            <div className="h-5 w-20 bg-line/40 rounded mb-2" />
            <div className="h-3 w-14 bg-line/30 rounded" />
          </div>
        ))}
      </div>
      <div className="h-9 w-full max-w-md bg-line/20 rounded mb-6" />
      <div className="grid lg:grid-cols-2 gap-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-line p-6 space-y-3">
            <div className="h-3 w-24 bg-line/40 rounded mb-4" />
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="h-4 w-full bg-line/30 rounded" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- page ----------------------------------------------------------------

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const role = useUserRole();
  const toast = useToast();
  const mayEdit = canEdit(role);
  const mayDelete = canDelete(role);
  const mayManageClients = role !== 'customer';
  const maySendMagicLink = role === 'admin' || role === 'assistant' || role === 'affiliate';
  const mayTakeOver = role === 'admin' || role === 'assistant';
  const mayCreateInvoice = role === 'admin' || role === 'affiliate';
  // Surface each client's shipments on the Clients tab for the affiliate client
  // portal only — admins/assistants see the tab exactly as before.
  const showClientShipments = role === 'affiliate';

  const [data, setData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabKey>('overview');

  const [editing, setEditing] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addingClient, setAddingClient] = useState(false);
  const [magic, setMagic] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [reset, setReset] = useState<'idle' | 'sending' | 'sent'>('idle');

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Not authenticated'); setLoading(false); return; }
      const res = await fetch(`/api/admin/customers/${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load customer');
      }
      setData(await res.json());
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load customer');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const sendMagicLink = async () => {
    if (magic === 'sending') return;
    setMagic('sending');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/customers/magic-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ customer_id: id }),
      });
      if (!res.ok) throw new Error();
      setMagic('sent');
      toast.success('Sign-in link sent');
      setTimeout(() => setMagic('idle'), 3000);
    } catch {
      setMagic('idle');
      toast.error('Failed to send sign-in link');
    }
  };

  // Emails a password-reset link instead of signing them in: the customer picks
  // their own new password on /account/set-password.
  const sendPasswordReset = async () => {
    if (reset === 'sending') return;
    setReset('sending');
    const r = await sendCustomerPasswordReset(id);
    if (r.success) {
      setReset('sent');
      toast.success('Password reset link sent');
      setTimeout(() => setReset('idle'), 3000);
    } else {
      setReset('idle');
      toast.error(r.error || 'Failed to send password reset link');
    }
  };

  // Currencies that actually carry invoice activity, primary first.
  const currencies = useMemo<Currency[]>(() => {
    if (!data) return [];
    const primary: Currency = data.customer.price_currency === 'USD' ? 'USD' : 'CAD';
    const present = (['CAD', 'USD'] as Currency[]).filter((c) => data.ar[c].count > 0);
    if (present.length === 0) return [primary];
    return [primary, ...present.filter((c) => c !== primary)].filter(
      (c, i, a) => a.indexOf(c) === i,
    );
  }, [data]);

  if (loading) {
    return <CustomerDetailSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="max-w-3xl">
        <Link href="/admin/customers" className="inline-flex items-center gap-2 text-ink-muted hover:text-ink text-sm mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to Customers
        </Link>
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <span className="text-red-700 text-sm">{error || 'Customer not found'}</span>
        </div>
      </div>
    );
  }

  const c = data.customer;
  const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email;
  const primaryCur = currencies[0];
  const primaryAr = data.ar[primaryCur];
  const takenOver = Boolean(data.assignment.assignedAdminId);
  const aff = c.bound_affiliate
    ? `${c.bound_affiliate.first_name ?? ''} ${c.bound_affiliate.last_name ?? ''}`.trim() || c.bound_affiliate.email
    : null;
  // The customer's sales team, primary first. Falls back to the single legacy
  // default sales person for a customer saved before teams existed.
  const salesTeam: SalesTeamMember[] =
    (data.salesFlow?.team ?? c.sales_people ?? []).length > 0
      ? [...(data.salesFlow?.team ?? c.sales_people ?? [])]
      : c.default_sales_person
        ? [
            {
              sales_person_id: c.default_sales_person.id,
              commission_rate: Number(c.default_sales_person.commission_rate) || 0,
              position: 0,
              sales_person: c.default_sales_person,
            },
          ]
        : [];
  const address = [c.shipping_address, c.shipping_city, c.shipping_state, c.shipping_postal_code, c.shipping_country]
    .filter(Boolean).join(', ');

  const openInvoices = data.invoices.filter(
    (i) => !i.non_payable && i.status !== 'cancelled' && i.status_effective !== 'paid',
  );

  // Synthesized business-activity timeline.
  const activity: { date: string; icon: any; tone: string; label: string; sub?: string; href?: string }[] = [];
  for (const inv of data.invoices) {
    activity.push({
      date: inv.issue_date || inv.created_at,
      icon: FileText, tone: 'text-blue-500',
      label: `Invoice ${inv.invoice_number} issued`,
      sub: `${money(inv.total, inv.currency)} · ${INVOICE_STATUS_META[inv.status_effective as keyof typeof INVOICE_STATUS_META]?.label ?? inv.status}`,
      href: `/admin/invoices/${inv.id}`,
    });
    for (const p of inv.payments ?? []) {
      if (!p.paid_at) continue;
      activity.push({
        date: p.paid_at, icon: CircleDollarSign, tone: 'text-emerald-600',
        label: 'Payment received',
        sub: `${money(p.amount, inv.currency)} · ${p.method ?? 'payment'} · ${inv.invoice_number}`,
        href: `/admin/invoices/${inv.id}`,
      });
    }
  }
  for (const o of data.orders) {
    activity.push({
      date: o.created_at, icon: Package, tone: 'text-indigo-500',
      label: `Order ${o.order_number} placed`,
      sub: `${money(o.total)} · ${o.status}`,
      href: `/admin/orders/${o.id}`,
    });
  }
  for (const cl of data.clients) {
    const clName = `${cl.first_name ?? ''} ${cl.last_name ?? ''}`.trim() || cl.address;
    activity.push({ date: cl.created_at, icon: Users, tone: 'text-vital', label: 'Ship-to client added', sub: clName });
  }
  if (data.assignment.assignedAt) {
    activity.push({
      date: data.assignment.assignedAt, icon: Handshake, tone: 'text-vital',
      label: `Taken over by ${data.assignment.assignedAdminName ?? 'an admin'}`,
    });
  }
  activity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const recentInvoices = data.invoices.slice(0, 5);

  return (
    <div className="max-w-6xl">
      <Link href="/admin/customers" className="inline-flex items-center gap-2 text-ink-muted hover:text-ink text-sm mb-6">
        <ArrowLeft className="w-4 h-4" /> Back to Customers
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-vital/10 flex items-center justify-center shrink-0">
            <User className="w-6 h-6 text-vital" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-ink truncate">{name}</h1>
              <span
                title={`Quoted in ${primaryCur}`}
                className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide ${
                  c.price_currency === 'USD' ? 'bg-blue-500/10 text-blue-600' : 'bg-surface text-ink-muted border border-line'
                }`}
              >
                {c.price_currency === 'USD' ? 'USD' : 'CAD'}
              </span>
              {c.active === false && (
                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-red-500/10 text-red-500">
                  Inactive
                </span>
              )}
              {takenOver && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-vital/10 text-vital">
                  <UserCheck className="w-3 h-3" />
                  {data.assignment.isMine ? 'Yours' : data.assignment.assignedAdminName || 'Taken over'}
                </span>
              )}
            </div>
            <p className="text-ink-muted text-sm break-all">{c.email}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {mayCreateInvoice && (
            <Link
              href="/admin/invoices/new"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold hover:bg-ink/90 transition-colors"
            >
              <FileText className="w-4 h-4" /> New Invoice
            </Link>
          )}
          <PriceSheetButton type="customer" id={id} defaultEmail={c.email ?? ''} entityName={name} />
          {mayEdit && (
            <>
              <button onClick={() => setPricingOpen(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-vital/20 bg-vital/10 text-vital text-sm font-medium hover:bg-vital/20 transition-colors">
                <Tag className="w-4 h-4" /> Pricing
              </button>
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-white text-ink text-sm font-medium hover:bg-surface transition-colors">
                <Pencil className="w-4 h-4" /> Edit
              </button>
            </>
          )}
          {maySendMagicLink && (
            <button
              onClick={sendMagicLink}
              disabled={magic === 'sending'}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 ${
                magic === 'sent' ? 'border-green-500/20 bg-green-500/10 text-green-600' : 'border-blue-500/20 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20'
              }`}
            >
              {magic === 'sent' ? <Check className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
              {magic === 'sending' ? 'Sending…' : magic === 'sent' ? 'Link sent' : 'Sign-in link'}
            </button>
          )}
          {maySendMagicLink && (
            <button
              onClick={sendPasswordReset}
              disabled={reset === 'sending'}
              title="Email this customer a link to set a new password"
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 ${
                reset === 'sent' ? 'border-green-500/20 bg-green-500/10 text-green-600' : 'border-amber-500/20 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'
              }`}
            >
              {reset === 'sent' ? <Check className="w-4 h-4" /> : <LockKeyhole className="w-4 h-4" />}
              {reset === 'sending' ? 'Sending…' : reset === 'sent' ? 'Reset sent' : 'Reset password'}
            </button>
          )}
          {mayTakeOver && (
            <Link href={`/admin/customers/${id}/takeover`} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-white text-ink-muted text-sm font-medium hover:text-ink hover:bg-surface transition-colors">
              <Handshake className="w-4 h-4" /> Contact
            </Link>
          )}
          {mayDelete && (
            <button onClick={() => setDeleting(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/20 bg-red-500/10 text-red-500 text-sm font-medium hover:bg-red-500/20 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <div className={`rounded-xl border p-4 ${primaryAr.outstanding > 0 ? 'border-amber-500/30 bg-amber-50' : 'border-line bg-white'}`}>
          <div className="flex items-center gap-2 mb-1">
            <ReceiptText className={`w-4 h-4 ${primaryAr.outstanding > 0 ? 'text-amber-500' : 'text-ink-muted'}`} />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Outstanding</span>
          </div>
          <p className="text-lg font-bold text-ink tabular-nums">{money(primaryAr.outstanding, primaryCur)}</p>
          <p className="text-[11px] text-ink-muted">{primaryAr.openCount} open invoice{primaryAr.openCount === 1 ? '' : 's'}</p>
        </div>

        <div className={`rounded-xl border p-4 ${primaryAr.overdue > 0 ? 'border-red-500/30 bg-red-50' : 'border-line bg-white'}`}>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className={`w-4 h-4 ${primaryAr.overdue > 0 ? 'text-red-500' : 'text-ink-muted'}`} />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Overdue</span>
          </div>
          <p className="text-lg font-bold text-ink tabular-nums">{money(primaryAr.overdue, primaryCur)}</p>
          <p className="text-[11px] text-ink-muted">{primaryAr.overdueCount} invoice{primaryAr.overdueCount === 1 ? '' : 's'}</p>
        </div>

        <div className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-ink-muted" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Invoiced</span>
          </div>
          <p className="text-lg font-bold text-ink tabular-nums">{money(primaryAr.invoiced, primaryCur)}</p>
          <p className="text-[11px] text-ink-muted">{money(primaryAr.paid, primaryCur)} paid</p>
        </div>

        <div className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-ink-muted" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Invoices</span>
          </div>
          <p className="text-lg font-bold text-ink tabular-nums">{data.invoices.length}</p>
          <p className="text-[11px] text-ink-muted">{primaryAr.paidCount} paid</p>
        </div>

        <div className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-ink-muted" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Clients</span>
          </div>
          <p className="text-lg font-bold text-ink tabular-nums">{data.clients.length}</p>
          <p className="text-[11px] text-ink-muted">ship-to recipients</p>
        </div>

        <div className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-center gap-2 mb-1">
            <Tag className="w-4 h-4 text-ink-muted" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Custom prices</span>
          </div>
          <p className="text-lg font-bold text-ink tabular-nums">{data.pricing.customPriceCount}</p>
          <p className="text-[11px] text-ink-muted">{data.pricing.appliedPricelistName ? data.pricing.appliedPricelistName : 'catalog default'}</p>
        </div>
      </div>

      {/* Second-currency A/R note */}
      {currencies.length > 1 && (
        <div className="mb-6 -mt-2 flex flex-wrap gap-2">
          {currencies.slice(1).map((cur) => (
            <span key={cur} className="inline-flex items-center gap-2 text-xs text-ink-muted bg-white border border-line rounded-lg px-3 py-1.5">
              <CircleDollarSign className="w-3.5 h-3.5" />
              Also {money(data.ar[cur].outstanding, cur)} outstanding in {cur}
            </span>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-line mb-6 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            const count =
              t.key === 'invoices' ? data.invoices.length
                : t.key === 'clients' ? data.clients.length
                  : t.key === 'orders' ? data.orders.length
                    : null;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  active ? 'border-vital text-ink' : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
                {count != null && count > 0 && (
                  <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${active ? 'bg-vital/15 text-vital' : 'bg-surface text-ink-muted'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- OVERVIEW ---- */}
      {tab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Card title="Contact details" icon={User}>
            <div className="space-y-3">
              <Row icon={Mail}><a href={`mailto:${c.email}`} className="text-vital font-medium break-all hover:underline">{c.email}</a></Row>
              {c.alternate_email && (
                <Row icon={Mail}><span className="break-all">{c.alternate_email} <span className="text-ink-muted text-xs">(alt)</span></span></Row>
              )}
              <Row icon={Phone}>
                {c.phone ? <a href={`tel:${c.phone}`} className="text-vital font-medium hover:underline">{c.phone}</a> : <span className="text-ink-muted">No phone on file</span>}
              </Row>
              <Row icon={MapPin}>{address || <span className="text-ink-muted">No address on file</span>}</Row>
              <Row icon={Calendar}>Registered {dateShort(c.created_at)}{daysSince(c.created_at) != null ? ` · ${daysSince(c.created_at)}d ago` : ''}</Row>
              <Row icon={Clock}>Last login {dateLabel(c.last_login_at)}</Row>
            </div>
          </Card>

          <Card title="Account & preferences" icon={Building2}>
            <div className="space-y-3">
              <Row icon={CircleDollarSign}>Quoted in <span className="font-semibold">{c.price_currency === 'USD' ? 'USD' : 'CAD'}</span></Row>
              <Row icon={Tag}>New invoices default <span className="font-semibold">{c.default_with_labels === false ? 'without' : 'with'} labels</span></Row>
              <Row icon={Truck}>
                <span className="inline-flex items-center gap-2">
                  <span className={c.allow_shipping !== false ? 'text-emerald-600' : 'text-ink-muted'}>Shipping {c.allow_shipping !== false ? 'on' : 'off'}</span>
                  <span className="text-line">·</span>
                  <Store className="w-3.5 h-3.5 text-ink-muted" />
                  <span className={c.allow_pickup !== false ? 'text-emerald-600' : 'text-ink-muted'}>Pickup {c.allow_pickup !== false ? 'on' : 'off'}</span>
                </span>
              </Row>
              <Row icon={Briefcase}>
                {salesTeam.length > 0 ? (
                  <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span>Sales {salesTeam.length > 1 ? 'team' : 'person'}</span>
                    {salesTeam.map((m) => (
                      <span key={m.sales_person_id} className="inline-flex items-center gap-1">
                        <span className="font-semibold">
                          {[m.sales_person?.first_name, m.sales_person?.last_name].filter(Boolean).join(' ') ||
                            m.sales_person?.email ||
                            'Unknown'}
                        </span>
                        <span className="text-ink-muted tabular-nums">· {m.commission_rate}%</span>
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => setTab('sales')}
                      className="text-xs text-vital hover:underline"
                    >
                      Manage
                    </button>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <span className="text-ink-muted">No sales person assigned</span>
                    {mayEdit && (
                      <button
                        type="button"
                        onClick={() => setTab('sales')}
                        className="text-xs text-vital hover:underline"
                      >
                        Assign
                      </button>
                    )}
                  </span>
                )}
              </Row>
              <Row icon={Network}>
                {aff ? <>Referred by affiliate <span className="font-semibold">{aff}</span></> : <span className="text-ink-muted">Direct customer (no affiliate)</span>}
              </Row>
            </div>
          </Card>

          {/* A/R summary */}
          <Card title="Accounts receivable" icon={ReceiptText}>
            <div className="space-y-4">
              {currencies.map((cur) => {
                const b = data.ar[cur];
                return (
                  <div key={cur} className={currencies.length > 1 ? 'pb-3 border-b border-line last:border-0 last:pb-0' : ''}>
                    {currencies.length > 1 && <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-2">{cur}</div>}
                    <div className="grid grid-cols-2 gap-3">
                      <div><div className="text-xs text-ink-muted">Invoiced</div><div className="text-base font-bold text-ink tabular-nums">{money(b.invoiced, cur)}</div></div>
                      <div><div className="text-xs text-ink-muted">Paid</div><div className="text-base font-bold text-emerald-600 tabular-nums">{money(b.paid, cur)}</div></div>
                      <div><div className="text-xs text-ink-muted">Outstanding</div><div className="text-base font-bold text-amber-600 tabular-nums">{money(b.outstanding, cur)}</div></div>
                      <div><div className="text-xs text-ink-muted">Overdue</div><div className={`text-base font-bold tabular-nums ${b.overdue > 0 ? 'text-red-600' : 'text-ink'}`}>{money(b.overdue, cur)}</div></div>
                    </div>
                  </div>
                );
              })}
              {data.invoices.length === 0 && <p className="text-sm text-ink-muted">No invoices yet.</p>}
            </div>
          </Card>

          {/* Recent invoices */}
          <Card
            title="Recent invoices"
            icon={FileText}
            action={data.invoices.length > 5 ? <button onClick={() => setTab('invoices')} className="text-xs text-vital hover:underline">View all</button> : undefined}
          >
            {recentInvoices.length === 0 ? (
              <p className="text-sm text-ink-muted">No invoices yet.</p>
            ) : (
              <div className="space-y-2">
                {recentInvoices.map((inv) => (
                  <Link key={inv.id} href={`/admin/invoices/${inv.id}`} className="flex items-center justify-between gap-3 p-2.5 bg-surface rounded-lg border border-line hover:border-vital/40 transition-colors">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink truncate">{inv.invoice_number}</span>
                        <InvoiceStatusBadge status={inv.status_effective} />
                      </div>
                      <p className="text-[11px] text-ink-muted">{dateShort(inv.issue_date)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-ink tabular-nums">{money(inv.total, inv.currency)}</div>
                      {inv.amount_due > 0 && <div className="text-[11px] text-amber-600 tabular-nums">{money(inv.amount_due, inv.currency)} due</div>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ---- SALES & COMMISSION ----
          Who is assigned to this customer (editable), and where the money they
          bring in actually ends up. */}
      {tab === 'sales' && (
        <div className="space-y-6">
          <SalesTeamCard
            customerId={id}
            team={salesTeam}
            canEdit={mayEdit}
            onSaved={load}
          />
          {/* Commission figures are staff-only; the API withholds them from an
              affiliate, who sees their own earnings on their own dashboard. */}
          {data.salesFlow && (
            <CustomerMoneyFlow flow={data.salesFlow} customerName={name} />
          )}
        </div>
      )}

      {/* ---- INVOICES ---- */}
      {tab === 'invoices' && (
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          {data.invoices.length === 0 ? (
            <div className="text-center py-12 text-ink-muted text-sm">No invoices for this customer yet.</div>
          ) : (
            <>
            {/* Desktop table (≥lg) / mobile cards — ADR 0007. */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr className="border-b border-line">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Invoice</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Issued</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Due</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Total</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-ink-muted uppercase tracking-wider">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/50">
                  {data.invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-surface transition-colors">
                      <td className="px-5 py-3">
                        <Link href={`/admin/invoices/${inv.id}`} className="text-sm font-medium text-ink hover:text-vital">
                          {inv.invoice_number}
                        </Link>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {inv.invoice_type === 'prepaid' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600">Prepaid</span>}
                          {inv.ships_to_client && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-vital/10 text-vital">Ships to client</span>}
                          {inv.is_backorder && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">Backorder</span>}
                          {inv.fulfillment_type === 'pickup' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface text-ink-muted border border-line">Pickup</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm text-ink-muted whitespace-nowrap">{dateShort(inv.issue_date)}</td>
                      <td className="px-5 py-3 text-sm text-ink-muted whitespace-nowrap">{dateShort(inv.due_date)}</td>
                      <td className="px-5 py-3"><InvoiceStatusBadge status={inv.status_effective} /></td>
                      <td className="px-5 py-3 text-right text-sm font-semibold text-ink tabular-nums whitespace-nowrap">{money(inv.total, inv.currency)}</td>
                      <td className="px-5 py-3 text-right text-sm tabular-nums whitespace-nowrap">
                        {inv.non_payable ? <span className="text-ink-muted">—</span>
                          : inv.amount_due > 0 ? <span className="text-amber-600 font-semibold">{money(inv.amount_due, inv.currency)}</span>
                            : <span className="text-emerald-600">Paid</span>}
                      </td>
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
                    <div className="min-w-0">
                      <Link href={`/admin/invoices/${inv.id}`} className="text-sm font-medium text-ink hover:text-vital">
                        {inv.invoice_number}
                      </Link>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {inv.invoice_type === 'prepaid' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600">Prepaid</span>}
                        {inv.ships_to_client && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-vital/10 text-vital">Ships to client</span>}
                        {inv.is_backorder && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">Backorder</span>}
                        {inv.fulfillment_type === 'pickup' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface text-ink-muted border border-line">Pickup</span>}
                      </div>
                    </div>
                    <InvoiceStatusBadge status={inv.status_effective} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                    <span>Issued <span className="text-ink">{dateShort(inv.issue_date)}</span></span>
                    <span>Due <span className="text-ink">{dateShort(inv.due_date)}</span></span>
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

      {/* ---- CLIENTS ---- */}
      {tab === 'clients' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-ink-muted">
              End-recipients this customer ships to. Billed to the customer; the client receives only a packing list.
            </p>
            {mayManageClients && (
              <button onClick={() => setAddingClient(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-ink text-white text-sm font-semibold hover:bg-ink/90 transition-colors shrink-0">
                <Plus className="w-4 h-4" /> Add client
              </button>
            )}
          </div>
          {data.clients.length === 0 ? (
            <div className="bg-white rounded-xl border border-line text-center py-12 text-ink-muted text-sm">
              No saved clients yet.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {data.clients.map((cl) => {
                const clName = `${cl.first_name ?? ''} ${cl.last_name ?? ''}`.trim();
                const clAddr = [cl.address, cl.city, cl.state, cl.postal_code, cl.country].filter(Boolean).join(', ');
                // Shipments to this client — the ship-to-client invoices addressed
                // to them. Surfaced in the client portal only; the admin/assistant
                // view of this tab is unchanged.
                const clientShipments = showClientShipments
                  ? data.invoices.filter((inv) => inv.ships_to_client && inv.client_id === cl.id)
                  : [];
                return (
                  <div key={cl.id} className="bg-white rounded-xl border border-line p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-lg bg-vital/10 flex items-center justify-center shrink-0">
                        <Users className="w-4 h-4 text-vital" />
                      </div>
                      <span className="font-semibold text-ink text-sm truncate">{clName || 'Unnamed client'}</span>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex items-start gap-2"><MapPin className="w-3.5 h-3.5 text-ink-muted mt-0.5 shrink-0" /><span className="text-ink">{clAddr}</span></div>
                      {cl.phone && <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-ink-muted shrink-0" /><span className="text-ink-muted">{cl.phone}</span></div>}
                      {cl.email && <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-ink-muted shrink-0" /><span className="text-ink-muted break-all">{cl.email}</span></div>}
                    </div>

                    {showClientShipments && (
                      <div className="mt-3 pt-3 border-t border-line">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2">
                          Shipments to this client
                        </p>
                        {clientShipments.length === 0 ? (
                          <p className="text-xs text-ink-muted">No shipments yet.</p>
                        ) : (
                          <div className="space-y-1.5">
                            {clientShipments.map((s) => (
                              <Link
                                key={s.id}
                                href={`/admin/invoices/${s.id}`}
                                className="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface border border-line hover:border-vital/40 transition-colors"
                              >
                                <div className="min-w-0">
                                  <span className="block text-xs font-medium text-ink truncate">{s.invoice_number}</span>
                                  <span className="text-[10px] text-ink-muted">{dateShort(s.issue_date || s.created_at)}</span>
                                </div>
                                <FulfillmentBadge status={s.fulfillment_status} />
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ---- ORDERS ---- */}
      {tab === 'orders' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Card title="Storefront orders" icon={Package}>
            {data.orders.length === 0 ? (
              <p className="text-sm text-ink-muted">No storefront orders. Wholesale customers are usually billed directly via invoices.</p>
            ) : (
              <div className="space-y-2">
                {data.orders.map((o) => (
                  <Link key={o.id} href={`/admin/orders/${o.id}`} className="flex items-center justify-between gap-3 p-3 bg-surface rounded-lg border border-line hover:border-vital/40 transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{o.order_number}</p>
                      <p className="text-[11px] text-ink-muted">{dateShort(o.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${orderStatusColors[o.status] || 'bg-gray-500/10 text-ink-muted border-line'}`}>{o.status}</span>
                      <span className="text-sm font-semibold text-ink tabular-nums">{money(o.total)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card
            title="Current cart"
            icon={ShoppingCart}
            action={data.cart.updatedAt ? <span className="text-[11px] text-ink-muted">Updated {dateShort(data.cart.updatedAt)}</span> : undefined}
          >
            {data.cart.items.length === 0 ? (
              <div className="text-center py-6 text-ink-muted text-sm">
                <ShoppingCart className="w-6 h-6 mx-auto mb-2 opacity-40" />
                Nothing in cart
              </div>
            ) : (
              <div className="space-y-2">
                {data.cart.items.map((item: any, i: number) => (
                  <div key={`${item.id ?? 'item'}-${i}`} className="flex items-center justify-between gap-2 p-2.5 bg-surface rounded-lg border border-line">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{item.name || 'Product'}</p>
                      <p className="text-[11px] text-ink-muted">{item.strength ? `${item.strength} · ` : ''}Qty {item.quantity}</p>
                    </div>
                    <span className="text-sm font-semibold text-ink shrink-0 tabular-nums">{money((Number(item.price) || 0) * (Number(item.quantity) || 0))}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ---- PRICING ---- */}
      {tab === 'pricing' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Card
            title="Pricing setup"
            icon={Tag}
            action={mayEdit ? <button onClick={() => setPricingOpen(true)} className="text-xs text-vital hover:underline">Manage</button> : undefined}
          >
            <div className="space-y-3">
              <Row icon={Tag}>
                Applied price list{' '}
                <span className="font-semibold">{data.pricing.appliedPricelistName || 'Catalog default'}</span>
                {data.pricing.appliedPricelistActive === false && <span className="text-ink-muted text-xs"> (inactive list)</span>}
              </Row>
              <Row icon={Percent}><span className="font-semibold">{data.pricing.customPriceCount}</span> custom product price{data.pricing.customPriceCount === 1 ? '' : 's'}</Row>
              <Row icon={X}><span className="font-semibold">{data.pricing.hiddenCount}</span> product{data.pricing.hiddenCount === 1 ? '' : 's'} hidden from this customer</Row>
              <Row icon={CircleDollarSign}>Quoted in <span className="font-semibold">{c.price_currency === 'USD' ? 'USD' : 'CAD'}</span></Row>
              <Row icon={Tag}>Defaults to <span className="font-semibold">{c.default_with_labels === false ? 'unlabeled' : 'labeled'}</span> pricing</Row>
            </div>
            <div className="mt-4 pt-4 border-t border-line flex flex-wrap gap-2">
              <Link href={`/admin/pricing/customer/${id}`} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-line bg-white text-ink text-sm font-medium hover:bg-surface transition-colors">
                <ExternalLink className="w-4 h-4" /> Per-product editor
              </Link>
              {mayEdit && (
                <button onClick={() => setPricingOpen(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-vital/20 bg-vital/10 text-vital text-sm font-medium hover:bg-vital/20 transition-colors">
                  <Tag className="w-4 h-4" /> Apply a price list
                </button>
              )}
            </div>
          </Card>

          <Card title="How pricing resolves" icon={DollarSign}>
            <ol className="space-y-2 text-sm text-ink-muted">
              <li className="flex gap-2"><span className="font-bold text-vital">1.</span> This customer&apos;s custom price (box / unlabeled / vial), if set</li>
              <li className="flex gap-2"><span className="font-bold text-vital">2.</span> The globally active price list</li>
              <li className="flex gap-2"><span className="font-bold text-vital">3.</span> The product catalog price</li>
              <li className="flex gap-2"><span className="font-bold text-vital">4.</span> Per-vial fallback (catalog vial price, or box ÷ vials-per-box)</li>
            </ol>
            <p className="text-xs text-ink-muted mt-4">
              New invoices for {name} auto-apply this. Currency and labeled/unlabeled follow the account preferences above.
            </p>
          </Card>
        </div>
      )}

      {/* ---- ACTIVITY ---- */}
      {tab === 'activity' && (
        <Card title="Activity" icon={Clock}>
          {activity.length === 0 ? (
            <p className="text-sm text-ink-muted">No activity yet.</p>
          ) : (
            <div className="relative pl-6">
              <div className="absolute left-[9px] top-1 bottom-1 w-px bg-line" />
              <div className="space-y-4">
                {activity.slice(0, 40).map((ev, i) => {
                  const Icon = ev.icon;
                  const inner = (
                    <>
                      <div className="absolute -left-6 top-0.5 w-[18px] h-[18px] rounded-full bg-white border border-line flex items-center justify-center">
                        <Icon className={`w-3 h-3 ${ev.tone}`} />
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-ink font-medium">{ev.label}</p>
                          {ev.sub && <p className="text-xs text-ink-muted">{ev.sub}</p>}
                        </div>
                        <span className="text-[11px] text-ink-muted whitespace-nowrap shrink-0">{dateShort(ev.date)}</span>
                      </div>
                    </>
                  );
                  return ev.href ? (
                    <Link key={i} href={ev.href} className="relative block hover:opacity-80 transition-opacity">{inner}</Link>
                  ) : (
                    <div key={i} className="relative">{inner}</div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Modals */}
      {editing && (
        <EditCustomerModal customer={c} onClose={() => setEditing(false)} onUpdated={() => { setEditing(false); load(); }} />
      )}
      {pricingOpen && (
        <CustomerPricingModal customer={c} onClose={() => setPricingOpen(false)} onApplied={() => load()} />
      )}
      {deleting && (
        <DeletionReviewModal
          kind="customer"
          entity={c}
          onClose={() => setDeleting(false)}
          onDeleted={() => router.push('/admin/customers')}
          onDeactivate={() => deleteCustomer(c.id, false)}
        />
      )}
      {addingClient && (
        <AddClientModal customerId={id} onClose={() => setAddingClient(false)} onCreated={() => { setAddingClient(false); load(); }} />
      )}
    </div>
  );
}
