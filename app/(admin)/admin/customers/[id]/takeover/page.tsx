'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, User, Mail, Phone, MapPin, Calendar, ShoppingCart, Package,
  CheckCircle2, XCircle, UserCheck, UserPlus, Loader2, AlertCircle, Clock,
  DollarSign, Handshake, RotateCcw,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useUserRole } from '@/app/(admin)/admin/layout';

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  total: number;
  created_at: string;
}

interface CartItem {
  id: string;
  name: string;
  strength: string;
  price: number;
  packSize: number;
  quantity: number;
}

interface TakeoverData {
  customer: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    phone: string | null;
    active: boolean;
    created_at: string;
    last_login_at: string | null;
    shipping_address: string | null;
    shipping_city: string | null;
    shipping_state: string | null;
    shipping_postal_code: string | null;
    shipping_country: string | null;
  };
  orders: OrderRow[];
  summary: {
    hasOrdered: boolean;
    orderCount: number;
    totalSpent: number;
    hasCartItems: boolean;
    cartItemCount: number;
    cartUpdatedAt: string | null;
    referredBy: string | null;
  };
  cart: { items: CartItem[]; updatedAt: string | null };
  assignment: {
    assignedAdminId: string | null;
    assignedAdminName: string | null;
    assignedAdminEmail: string | null;
    assignedAt: string | null;
    isMine: boolean;
  };
  caller: { id: string; name: string; email: string };
}

const statusColors: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  received: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
  confirmed: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  processing: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  shipped: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
  delivered: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  cancelled: 'bg-red-500/10 text-red-500 border-red-500/20',
  expired: 'bg-gray-500/10 text-ink-muted border-line',
};

function money(n: number) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function dateLabel(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

export default function CustomerTakeoverPage() {
  const { id } = useParams();
  const userRole = useUserRole();
  const canTakeOver = userRole === 'admin';

  const [data, setData] = useState<TakeoverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Not authenticated');
        setLoading(false);
        return;
      }
      const res = await fetch(`/api/admin/customers/${id}/takeover`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load customer');
      }
      setData(await res.json());
    } catch (err: any) {
      setError(err.message || 'Failed to load customer');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (method: 'POST' | 'DELETE', force = false) => {
    setActing(true);
    setActionError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch(`/api/admin/customers/${id}/takeover`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: method === 'POST' ? JSON.stringify({ force }) : undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Action failed');
      }
      await load();
    } catch (err: any) {
      setActionError(err.message || 'Action failed');
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />
      </div>
    );
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

  const { customer, orders, summary, cart, assignment } = data;
  const name = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || customer.email;
  const takenOver = Boolean(assignment.assignedAdminId);
  const registeredDays = daysSince(customer.created_at);
  const address = [
    customer.shipping_address,
    customer.shipping_city,
    customer.shipping_state,
    customer.shipping_postal_code,
    customer.shipping_country,
  ].filter(Boolean).join(', ');

  return (
    <div className="max-w-4xl">
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
            <h1 className="text-2xl font-bold text-ink truncate">{name}</h1>
            <p className="text-ink-muted text-sm break-all">{customer.email}</p>
          </div>
        </div>
        {takenOver ? (
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-vital/10 text-vital border border-vital/20">
            <UserCheck className="w-4 h-4" />
            {assignment.isMine ? 'Taken over by you' : `Taken over by ${assignment.assignedAdminName || 'an admin'}`}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
            <UserPlus className="w-4 h-4" />
            Available for takeover
          </span>
        )}
      </div>

      {/* Quick status tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className={`rounded-xl border p-4 ${summary.hasOrdered ? 'border-emerald-500/30 bg-emerald-50' : 'border-line bg-white'}`}>
          <div className="flex items-center gap-2 mb-1">
            {summary.hasOrdered
              ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              : <XCircle className="w-4 h-4 text-ink-muted" />}
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Ordered</span>
          </div>
          <p className="text-lg font-bold text-ink">{summary.hasOrdered ? 'Yes' : 'No'}</p>
          <p className="text-[11px] text-ink-muted">{summary.orderCount} order{summary.orderCount === 1 ? '' : 's'}</p>
        </div>

        <div className={`rounded-xl border p-4 ${summary.hasCartItems ? 'border-amber-500/30 bg-amber-50' : 'border-line bg-white'}`}>
          <div className="flex items-center gap-2 mb-1">
            <ShoppingCart className={`w-4 h-4 ${summary.hasCartItems ? 'text-amber-500' : 'text-ink-muted'}`} />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">In cart</span>
          </div>
          <p className="text-lg font-bold text-ink">{summary.hasCartItems ? 'Yes' : 'No'}</p>
          <p className="text-[11px] text-ink-muted">{summary.cartItemCount} item{summary.cartItemCount === 1 ? '' : 's'}</p>
        </div>

        <div className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-ink-muted" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Spent</span>
          </div>
          <p className="text-lg font-bold text-ink">{money(summary.totalSpent)}</p>
          <p className="text-[11px] text-ink-muted">lifetime</p>
        </div>

        <div className="rounded-xl border border-line bg-white p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-ink-muted" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Registered</span>
          </div>
          <p className="text-lg font-bold text-ink">{registeredDays != null ? `${registeredDays}d` : '—'}</p>
          <p className="text-[11px] text-ink-muted">ago</p>
        </div>
      </div>

      {/* Takeover action card */}
      <div className="bg-white rounded-xl border border-line p-5 sm:p-6 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Handshake className="w-5 h-5 text-ink" />
          <h2 className="text-lg font-semibold text-ink">Customer takeover</h2>
        </div>

        {takenOver ? (
          <div className="mb-4 p-3 bg-surface rounded-lg border border-line">
            <p className="text-sm text-ink">
              <span className="font-semibold">{assignment.assignedAdminName || 'An admin'}</span>
              {assignment.assignedAdminEmail ? (
                <span className="text-ink-muted"> ({assignment.assignedAdminEmail})</span>
              ) : null}
              {' '}is handling this customer.
            </p>
            <p className="text-xs text-ink-muted mt-1">Since {dateLabel(assignment.assignedAt)}</p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted mb-4">
            No one is handling this customer yet. Take them over to mark that you&apos;re the one contacting them.
          </p>
        )}

        {actionError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <span className="text-red-700 text-xs">{actionError}</span>
          </div>
        )}

        {!canTakeOver ? (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block">
            Only administrators can take over customers.
          </p>
        ) : !takenOver ? (
          <button
            onClick={() => act('POST')}
            disabled={acting}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
            Take over this customer
          </button>
        ) : assignment.isMine ? (
          <button
            onClick={() => act('DELETE')}
            disabled={acting}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-surface border border-line text-ink rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Release (make available)
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => act('POST', true)}
              disabled={acting}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {acting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
              Take over from {assignment.assignedAdminName || 'them'}
            </button>
            <button
              onClick={() => act('DELETE')}
              disabled={acting}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-surface border border-line text-ink rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4" /> Release
            </button>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Contact & details */}
        <div className="bg-white rounded-xl border border-line p-5 sm:p-6">
          <h2 className="text-sm font-semibold text-ink mb-4 uppercase tracking-wider">Contact details</h2>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <Mail className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" />
              <a href={`mailto:${customer.email}`} className="text-vital font-medium break-all hover:underline">{customer.email}</a>
            </div>
            <div className="flex items-start gap-3">
              <Phone className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" />
              {customer.phone
                ? <a href={`tel:${customer.phone}`} className="text-vital font-medium hover:underline">{customer.phone}</a>
                : <span className="text-ink-muted">No phone on file</span>}
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" />
              <span className="text-ink">{address || <span className="text-ink-muted">No address on file</span>}</span>
            </div>
            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" />
              <span className="text-ink">Registered {dateLabel(customer.created_at)}</span>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" />
              <span className="text-ink">Last login {dateLabel(customer.last_login_at)}</span>
            </div>
            {summary.referredBy && (
              <div className="flex items-start gap-3">
                <User className="w-4 h-4 text-ink-muted mt-0.5 shrink-0" />
                <span className="text-ink">Referred by {summary.referredBy}</span>
              </div>
            )}
          </div>
        </div>

        {/* Current cart */}
        <div className="bg-white rounded-xl border border-line p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink uppercase tracking-wider">Current cart</h2>
            {cart.updatedAt && (
              <span className="text-[11px] text-ink-muted">Updated {dateLabel(cart.updatedAt)}</span>
            )}
          </div>
          {cart.items.length === 0 ? (
            <div className="text-center py-6 text-ink-muted text-sm">
              <ShoppingCart className="w-6 h-6 mx-auto mb-2 opacity-40" />
              Nothing in cart
            </div>
          ) : (
            <div className="space-y-2">
              {cart.items.map((item, i) => (
                <div key={`${item.id}-${i}`} className="flex items-center justify-between gap-2 p-2.5 bg-surface rounded-lg border border-line">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{item.name || 'Product'}</p>
                    <p className="text-[11px] text-ink-muted">
                      {item.strength ? `${item.strength} · ` : ''}Qty {item.quantity}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-ink shrink-0">{money(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Orders */}
      <div className="bg-white rounded-xl border border-line p-5 sm:p-6 mt-6">
        <div className="flex items-center gap-2 mb-4">
          <Package className="w-5 h-5 text-ink" />
          <h2 className="text-lg font-semibold text-ink">Orders</h2>
        </div>
        {orders.length === 0 ? (
          <div className="text-center py-8 text-ink-muted text-sm">
            This customer hasn&apos;t placed any orders yet.
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <Link
                key={o.id}
                href={`/admin/orders/${o.id}`}
                className="flex items-center justify-between gap-3 p-3 bg-surface rounded-lg border border-line hover:border-vital/40 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{o.order_number}</p>
                  <p className="text-[11px] text-ink-muted">{dateLabel(o.created_at)}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${statusColors[o.status] || 'bg-gray-500/10 text-ink-muted border-line'}`}>
                    {o.status}
                  </span>
                  <span className="text-sm font-semibold text-ink">{money(o.total)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
