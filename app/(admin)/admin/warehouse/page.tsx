'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  PackageCheck,
  UserPlus,
  Truck,
  Store,
  Boxes,
  Activity,
  Loader2,
  AlertCircle,
  X,
  Eye,
  EyeOff,
  Power,
  CheckCircle2,
  ScanLine,
  ArrowUpRight,
} from 'lucide-react';
import { createUser, toggleUserActive } from '@/lib/admin/api';
import {
  getWarehouseActivity,
  setWarehouseEmailPermission,
  type WarehouseActivity,
} from '@/lib/admin/warehouse-staff';
import { useUserRole } from '@/app/(admin)/admin/layout';

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AdminWarehousePage() {
  const role = useUserRole();
  const readOnly = role === 'assistant';

  const [data, setData] = useState<WarehouseActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getWarehouseActivity());
    } catch (e: any) {
      setError(e?.message ?? 'Could not load warehouse data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (id: string, next: boolean) => {
    setBusyId(id);
    try {
      await toggleUserActive(id, next);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const toggleEmail = async (id: string, next: boolean) => {
    setBusyId(id);
    try {
      await setWarehouseEmailPermission(id, next);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {/* Heading */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center">
            <PackageCheck className="w-5 h-5 text-indigo-500" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-ink">Warehouse</h1>
            <p className="text-xs text-ink-muted">Manage fulfillment accounts and track their activity.</p>
          </div>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {/* Admins can work the live fulfillment queue directly; this jumps
                straight into the /warehouse floor view without hunting for it. */}
            <Link
              href="/warehouse"
              className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-inset ring-white/20 bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 transition-all hover:shadow-lg hover:shadow-violet-500/25 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-violet-400"
            >
              {/* Sheen sweep on hover for the "special" feel */}
              <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <ScanLine className="w-4 h-4" />
              Open fulfillment queue
              <ArrowUpRight className="w-4 h-4 opacity-80 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white text-sm font-semibold rounded-lg px-4 py-2.5"
            >
              <UserPlus className="w-4 h-4" /> Add account
            </button>
          </div>
        )}
      </div>

      {error ? (
        <div className="bg-white rounded-xl border border-line p-8 text-center">
          <AlertCircle className="w-6 h-6 text-red-500 mx-auto mb-2" />
          <p className="text-sm text-ink-muted mb-4">{error}</p>
          <button onClick={() => void load()} className="text-sm text-indigo-600 hover:underline">Try again</button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Performance */}
          <section>
            <h2 className="text-sm font-bold text-ink mb-3 flex items-center gap-2">
              <Boxes className="w-4 h-4 text-indigo-500" /> Performance
            </h2>
            {loading ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="bg-white rounded-xl border border-line h-32 animate-pulse" />
                ))}
              </div>
            ) : data && data.performance.length > 0 ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.performance.map((p) => (
                  <div key={p.id} className="bg-white rounded-xl border border-line p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink truncate">{p.name}</div>
                        <div className="text-xs text-ink-muted truncate">{p.email}</div>
                      </div>
                      {!p.active && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-400/10 text-ink-muted shrink-0">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <Stat label="Completed" value={p.completed} accent="emerald" />
                      <Stat label="Today" value={p.completed_today} accent="indigo" />
                      <Stat label="Packed" value={p.packed} accent="amber" />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-ink-muted">
                      <span className="inline-flex items-center gap-1"><Truck className="w-3 h-3" /> {p.shipped} shipped</span>
                      <span className="inline-flex items-center gap-1"><Store className="w-3 h-3" /> {p.picked_up} pickups</span>
                      <span className="inline-flex items-center gap-1"><Activity className="w-3 h-3" /> {p.actions} actions</span>
                    </div>
                    <div className="mt-1.5 text-[11px] text-ink-muted text-right">
                      Active {timeAgo(p.last_active)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-line p-8 text-center text-sm text-ink-muted">
                No warehouse accounts yet. Add one to get started.
              </div>
            )}
          </section>

          {/* Accounts */}
          <section>
            <h2 className="text-sm font-bold text-ink mb-3 flex items-center gap-2">
              <PackageCheck className="w-4 h-4 text-indigo-500" /> Accounts
            </h2>
            <div className="bg-white rounded-xl border border-line overflow-hidden">
              {loading ? (
                <div className="p-5 space-y-3">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-surface rounded animate-pulse" />)}
                </div>
              ) : data && data.accounts.length > 0 ? (
                <>
                {/* Desktop table (≥lg) / mobile cards — ADR 0007. */}
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full min-w-[560px]">
                    <thead>
                      <tr className="border-b border-line">
                        <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Name</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Email</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Status</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Can email</th>
                        <th className="px-5 py-3 text-left text-xs font-semibold text-ink-muted uppercase tracking-wider">Last login</th>
                        {!readOnly && <th className="px-5 py-3" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/50">
                      {data.accounts.map((a) => (
                        <tr key={a.id} className="hover:bg-surface/50">
                          <td className="px-5 py-3 text-sm font-medium text-ink whitespace-nowrap">
                            {[a.first_name, a.last_name].filter(Boolean).join(' ') || '—'}
                          </td>
                          <td className="px-5 py-3 text-sm text-ink-muted">{a.email}</td>
                          <td className="px-5 py-3">
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                                a.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-gray-400/10 text-ink-muted'
                              }`}
                            >
                              {a.active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            {readOnly ? (
                              <span className={`text-xs font-medium ${a.can_send_fulfillment_emails ? 'text-emerald-600' : 'text-ink-muted'}`}>
                                {a.can_send_fulfillment_emails ? 'Yes' : 'No'}
                              </span>
                            ) : (
                              <button
                                onClick={() => toggleEmail(a.id, !a.can_send_fulfillment_emails)}
                                disabled={busyId === a.id}
                                role="switch"
                                aria-checked={a.can_send_fulfillment_emails}
                                title="Allow this account to send customer fulfillment emails"
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                                  a.can_send_fulfillment_emails ? 'bg-emerald-500' : 'bg-line'
                                }`}
                              >
                                <span
                                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    a.can_send_fulfillment_emails ? 'translate-x-4' : 'translate-x-0.5'
                                  }`}
                                />
                              </button>
                            )}
                          </td>
                          <td className="px-5 py-3 text-sm text-ink-muted whitespace-nowrap">{timeAgo(a.last_login_at)}</td>
                          {!readOnly && (
                            <td className="px-5 py-3 text-right">
                              <button
                                onClick={() => toggleActive(a.id, !a.active)}
                                disabled={busyId === a.id}
                                className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
                              >
                                {busyId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                                {a.active ? 'Deactivate' : 'Activate'}
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards (below lg) */}
                <ul className="lg:hidden divide-y divide-line/50">
                  {data.accounts.map((a) => (
                    <li key={a.id} className="px-4 py-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-ink">
                            {[a.first_name, a.last_name].filter(Boolean).join(' ') || '—'}
                          </div>
                          <div className="text-xs text-ink-muted break-all">{a.email}</div>
                          <div className="mt-1 text-xs text-ink-muted">Last login {timeAgo(a.last_login_at)}</div>
                        </div>
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                            a.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-gray-400/10 text-ink-muted'
                          }`}
                        >
                          {a.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-ink-muted">Can email</span>
                          {readOnly ? (
                            <span className={`text-xs font-medium ${a.can_send_fulfillment_emails ? 'text-emerald-600' : 'text-ink-muted'}`}>
                              {a.can_send_fulfillment_emails ? 'Yes' : 'No'}
                            </span>
                          ) : (
                            <button
                              onClick={() => toggleEmail(a.id, !a.can_send_fulfillment_emails)}
                              disabled={busyId === a.id}
                              role="switch"
                              aria-checked={a.can_send_fulfillment_emails}
                              title="Allow this account to send customer fulfillment emails"
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                                a.can_send_fulfillment_emails ? 'bg-emerald-500' : 'bg-line'
                              }`}
                            >
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${a.can_send_fulfillment_emails ? 'translate-x-4' : 'translate-x-0.5'}`} />
                            </button>
                          )}
                        </div>
                        {!readOnly && (
                          <button
                            onClick={() => toggleActive(a.id, !a.active)}
                            disabled={busyId === a.id}
                            className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
                          >
                            {busyId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                            {a.active ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                </>
              ) : (
                <div className="p-8 text-center text-sm text-ink-muted">No warehouse accounts yet.</div>
              )}
            </div>
          </section>

          {/* Activity log */}
          <section>
            <h2 className="text-sm font-bold text-ink mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-500" /> Activity log
            </h2>
            <div className="bg-white rounded-xl border border-line overflow-hidden">
              {loading ? (
                <div className="p-5 space-y-3">
                  {[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-surface rounded animate-pulse" />)}
                </div>
              ) : data && data.logs.length > 0 ? (
                <ul className="divide-y divide-line/50">
                  {data.logs.map((l, i) => (
                    <li key={i} className="px-5 py-3 flex items-center gap-3 text-sm">
                      <CheckCircle2
                        className={`w-4 h-4 shrink-0 ${
                          l.to === 'shipped' || l.to === 'picked_up' ? 'text-emerald-500' : 'text-ink-muted'
                        }`}
                      />
                      <span className="text-ink">
                        <span className="font-medium">{l.actor_name}</span>
                        {l.actor_role && l.actor_role !== 'warehouse' && (
                          <span className="ml-1 text-[10px] uppercase text-ink-muted">({l.actor_role})</span>
                        )}
                        {' '}— {l.action}{' '}
                        <span className="font-mono text-xs text-ink-muted">
                          {l.order_number || l.invoice_number || ''}
                        </span>
                      </span>
                      <span className="ml-auto text-xs text-ink-muted whitespace-nowrap">{timeAgo(l.at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-8 text-center text-sm text-ink-muted">No activity yet.</div>
              )}
            </div>
          </section>
        </div>
      )}

      {showCreate && (
        <CreateWarehouseModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: 'emerald' | 'indigo' | 'amber' }) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-600',
    indigo: 'text-indigo-600',
    amber: 'text-amber-600',
  };
  return (
    <div className="bg-surface rounded-lg py-2">
      <div className={`text-lg font-bold tabular-nums ${colors[accent]}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-ink-muted">{label}</div>
    </div>
  );
}

function CreateWarehouseModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password) {
      setError('First name, last name, email and password are all required.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    const result = await createUser({
      email: email.trim(),
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      role: 'warehouse',
      password_hash: password,
      active: true,
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error ?? 'Could not create account');
      return;
    }
    onCreated();
  };

  const fld =
    'w-full px-3 py-2 bg-surface border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-indigo-400/40';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-line shadow-xl w-full max-w-md p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-ink flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-indigo-500" /> New warehouse account
          </h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink mb-1">First name *</label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fld} />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Last name *</label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={fld} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Email *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fld} placeholder="warehouse@example.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Password *</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${fld} pr-10 font-mono`}
                placeholder="At least 8 characters"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50">Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 bg-ink hover:bg-ink/90 text-white text-sm font-medium rounded-lg inline-flex items-center gap-2 disabled:opacity-60"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Create account
          </button>
        </div>
      </div>
    </div>
  );
}
