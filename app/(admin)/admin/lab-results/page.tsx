'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import FadeInImage from '@/components/FadeInImage';
import {
  FlaskConical,
  Plus,
  Search,
  Pencil,
  Trash2,
  ExternalLink,
  Eye,
  EyeOff,
  X,
  Loader2,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSmartLoad } from '@/lib/hooks/useSmartLoad';
import { SlowLoadingNotice, LoadingError } from '@/components/LoadingFeedback';
import { useUserRole } from '@/app/(admin)/admin/layout';
import { canEdit } from '@/lib/permissions';

interface CoveredProduct {
  id: string;
  name: string;
  slug: string | null;
  strength: string | null;
  image_url: string | null;
  box_image_url: string | null;
}

interface LabResult {
  id: string;
  report_url: string;
  product_name: string;
  lab: string;
  sample_id: string | null;
  compound: string | null;
  cas_number: string | null;
  purity_pct: number | null;
  method: string;
  matrix: string | null;
  receiving_date: string | null;
  registration_date: string | null;
  report_date: string | null;
  active: boolean;
  products: CoveredProduct[];
}

// Empty template for the "add new" form.
const BLANK: Partial<LabResult> = {
  product_name: '',
  report_url: '',
  lab: 'PPB Analytical Inc.',
  compound: '',
  cas_number: '',
  sample_id: '',
  purity_pct: null,
  method: 'HPLC-UV',
  matrix: 'Other',
  report_date: '',
  receiving_date: '',
  registration_date: '',
  active: true,
};

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

export default function AdminLabResultsPage() {
  const role = useUserRole();
  const readOnly = !canEdit(role);

  const { data, loading, slow, error, reload } = useSmartLoad<LabResult[]>(async () => {
    const res = await fetch('/api/admin/lab-results', { headers: await authHeaders() });
    if (!res.ok) throw new Error(`Failed to load lab results (${res.status})`);
    const { labResults } = await res.json();
    return labResults || [];
  }, []);

  const [items, setItems] = useState<LabResult[]>([]);
  useEffect(() => {
    if (data) setItems(data);
  }, [data]);

  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<LabResult | 'new' | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const flash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(
      (r) =>
        r.product_name?.toLowerCase().includes(q) ||
        r.compound?.toLowerCase().includes(q) ||
        r.sample_id?.toLowerCase().includes(q) ||
        r.lab?.toLowerCase().includes(q)
    );
  }, [items, query]);

  const stats = useMemo(() => {
    const visible = items.filter((r) => r.active).length;
    const purities = items.map((r) => r.purity_pct).filter((p): p is number => p != null);
    const avg = purities.length ? purities.reduce((a, b) => a + b, 0) / purities.length : null;
    return { total: items.length, visible, hidden: items.length - visible, avg };
  }, [items]);

  const toggleActive = async (r: LabResult) => {
    if (readOnly) return;
    setBusyId(r.id);
    // Optimistic flip.
    setItems((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)));
    try {
      const res = await fetch(`/api/admin/lab-results/${r.id}`, {
        method: 'PATCH',
        headers: await authHeaders(),
        body: JSON.stringify({ active: !r.active }),
      });
      if (!res.ok) throw new Error();
      flash('ok', !r.active ? 'Now visible on the site' : 'Hidden from the site');
    } catch {
      setItems((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: r.active } : x)));
      flash('err', 'Could not update visibility');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (r: LabResult) => {
    if (readOnly) return;
    if (!confirm(`Delete the lab result for “${r.product_name}”? This cannot be undone.`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/admin/lab-results/${r.id}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.filter((x) => x.id !== r.id));
      flash('ok', 'Lab result deleted');
    } catch {
      flash('err', 'Could not delete lab result');
    } finally {
      setBusyId(null);
    }
  };

  const onSaved = (saved: LabResult, isNew: boolean) => {
    setItems((prev) => (isNew ? [saved, ...prev] : prev.map((x) => (x.id === saved.id ? { ...x, ...saved } : x))));
    setEditing(null);
    flash('ok', isNew ? 'Lab result created' : 'Changes saved');
    // Refresh to re-derive covered products after a report_url change.
    reload();
  };

  return (
    <>
      {/* Header */}
      <div className="mb-6 sm:mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FlaskConical className="w-5 h-5 text-vital" />
            <h1 className="text-xl sm:text-2xl font-bold text-ink">Lab Results</h1>
          </div>
          <p className="text-sm text-ink-muted max-w-2xl">
            Manage the certificates of analysis shown on the public Lab Results page.
            Edit report details or toggle whether each one is visible to customers.
          </p>
        </div>
        {!readOnly && (
          <button
            onClick={() => setEditing('new')}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink hover:bg-ink/90 text-white text-sm font-semibold rounded-lg transition-all"
          >
            <Plus className="w-4 h-4" />
            Add lab result
          </button>
        )}
      </div>

      {/* Stats */}
      {!loading && !error && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <StatCard label="Total reports" value={stats.total} />
          <StatCard label="Visible" value={stats.visible} tone="emerald" />
          <StatCard label="Hidden" value={stats.hidden} tone="muted" />
          <StatCard label="Avg. purity" value={stats.avg != null ? `${stats.avg.toFixed(1)}%` : '—'} tone="vital" />
        </div>
      )}

      {/* Search */}
      <div className="relative w-full sm:w-96 mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
        <input
          type="text"
          placeholder="Search by product, compound, sample ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-11 pr-4 py-2.5 bg-white rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 text-ink placeholder-ink-muted text-sm"
        />
      </div>

      {/* List */}
      {error ? (
        <LoadingError onRetry={reload} />
      ) : loading ? (
        <div>
          {slow && <SlowLoadingNotice onReload={reload} />}
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-line p-4 flex items-center gap-4 animate-pulse">
                <div className="w-16 h-16 rounded-lg bg-surface shrink-0" />
                <div className="flex-1 space-y-2.5">
                  <div className="h-4 bg-surface rounded w-1/3" />
                  <div className="h-3 bg-surface rounded w-1/2" />
                  <div className="h-3 bg-surface rounded w-2/3" />
                </div>
                <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                  <div className="w-9 h-9 rounded-lg bg-surface" />
                  <div className="w-20 h-9 rounded-lg bg-surface" />
                  <div className="w-9 h-9 rounded-lg bg-surface" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-line px-5 py-16 text-center">
          <div className="w-12 h-12 bg-surface rounded-full flex items-center justify-center mx-auto mb-4">
            <FlaskConical className="w-6 h-6 text-ink-muted" />
          </div>
          <h3 className="text-base font-semibold text-ink mb-1">
            {items.length === 0 ? 'No lab results yet' : 'No matches'}
          </h3>
          <p className="text-sm text-ink-muted">
            {items.length === 0 ? 'Add a lab result to get started.' : 'Try a different search term.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <LabResultRow
              key={r.id}
              r={r}
              busy={busyId === r.id}
              readOnly={readOnly}
              onToggle={() => toggleActive(r)}
              onEdit={() => setEditing(r)}
              onDelete={() => remove(r)}
            />
          ))}
        </div>
      )}

      {/* Editor modal */}
      {editing && (
        <LabResultModal
          initial={editing === 'new' ? BLANK : editing}
          isNew={editing === 'new'}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
          onError={(m) => flash('err', m)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-[120] flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
            toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {toast.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}
    </>
  );
}

function StatCard({ label, value, tone = 'ink' }: { label: string; value: string | number; tone?: 'ink' | 'emerald' | 'muted' | 'vital' }) {
  const toneClass =
    tone === 'emerald' ? 'text-emerald-600' : tone === 'vital' ? 'text-vital' : tone === 'muted' ? 'text-ink-muted' : 'text-ink';
  return (
    <div className="bg-white rounded-xl p-4 sm:p-5 border border-line">
      <p className={`text-2xl md:text-3xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      <p className="text-xs text-ink-muted mt-1">{label}</p>
    </div>
  );
}

function LabResultRow({
  r,
  busy,
  readOnly,
  onToggle,
  onEdit,
  onDelete,
}: {
  r: LabResult;
  busy: boolean;
  readOnly: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const img = r.products[0]?.box_image_url ?? r.products[0]?.image_url ?? null;
  return (
    <div
      className={`bg-white rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center gap-4 transition-colors ${
        r.active ? 'border-line' : 'border-dashed border-line bg-surface/40'
      }`}
    >
      {/* Thumb */}
      <div className="relative w-16 h-16 rounded-lg bg-surface flex items-center justify-center overflow-hidden shrink-0">
        {img ? (
          <FadeInImage src={img} alt={r.product_name} fill sizes="64px" className="object-cover" />
        ) : (
          <FlaskConical className="w-6 h-6 text-line" />
        )}
      </div>

      {/* Main */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-ink truncate">{r.product_name}</h3>
          {!r.active && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted bg-surface border border-line px-2 py-0.5 rounded-full">
              <EyeOff className="w-3 h-3" /> Hidden
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-muted mt-0.5">
          <ShieldCheck className="w-3.5 h-3.5 text-vital" />
          {r.lab}
          {r.compound && <span className="truncate">· {r.compound}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-ink-muted">
          <span>
            Purity <span className="font-semibold text-ink tabular-nums">{r.purity_pct != null ? `${r.purity_pct}%` : '—'}</span>
          </span>
          <span>Sample <span className="font-medium text-ink tabular-nums">{r.sample_id ?? '—'}</span></span>
          <span>Result <span className="font-medium text-ink">{formatDate(r.report_date)}</span></span>
          {r.products.length > 0 && (
            <span>Covers <span className="font-medium text-ink tabular-nums">{r.products.length}</span> product{r.products.length === 1 ? '' : 's'}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-center">
        <a
          href={r.report_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
          title="Open report"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
        {!readOnly && (
          <>
            <button
              onClick={onToggle}
              disabled={busy}
              title={r.active ? 'Hide from site' : 'Show on site'}
              className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                r.active
                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-surface text-ink-muted hover:text-ink border border-line'
              }`}
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : r.active ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
              <span className="hidden md:inline">{r.active ? 'Visible' : 'Hidden'}</span>
            </button>
            <button
              onClick={onEdit}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-ink-muted hover:text-ink hover:bg-surface transition-colors"
              title="Edit"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={onDelete}
              disabled={busy}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-ink-muted hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function LabResultModal({
  initial,
  isNew,
  onClose,
  onSaved,
  onError,
}: {
  initial: Partial<LabResult>;
  isNew: boolean;
  onClose: () => void;
  onSaved: (saved: LabResult, isNew: boolean) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<Partial<LabResult>>({ ...initial });
  const [saving, setSaving] = useState(false);

  const set = (key: keyof LabResult, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.product_name?.trim() || !form.report_url?.trim()) {
      onError('Product name and report URL are required');
      return;
    }
    setSaving(true);
    try {
      const url = isNew ? '/api/admin/lab-results' : `/api/admin/lab-results/${initial.id}`;
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        headers: await authHeaders(),
        body: JSON.stringify({
          product_name: form.product_name,
          report_url: form.report_url,
          lab: form.lab,
          compound: form.compound,
          cas_number: form.cas_number,
          sample_id: form.sample_id,
          purity_pct: form.purity_pct === null || form.purity_pct === undefined || (form.purity_pct as unknown) === '' ? null : form.purity_pct,
          method: form.method,
          matrix: form.matrix,
          report_date: form.report_date || null,
          receiving_date: form.receiving_date || null,
          registration_date: form.registration_date || null,
          active: form.active ?? true,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        onError(json.error || 'Could not save');
        setSaving(false);
        return;
      }
      onSaved(json.labResult, isNew);
    } catch {
      onError('Could not save');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/40 backdrop-blur-sm">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl border border-line shadow-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-line">
          <h2 className="text-lg font-bold text-ink">{isNew ? 'Add lab result' : 'Edit lab result'}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={submit} className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Product name" required>
              <input className={inputCls} value={form.product_name ?? ''} onChange={(e) => set('product_name', e.target.value)} placeholder="KLOW 80MG" />
            </Field>
            <Field label="Testing lab">
              <input className={inputCls} value={form.lab ?? ''} onChange={(e) => set('lab', e.target.value)} placeholder="PPB Analytical Inc." />
            </Field>
          </div>

          <Field label="Report URL" required>
            <input className={inputCls} value={form.report_url ?? ''} onChange={(e) => set('report_url', e.target.value)} placeholder="https://…/certificates/klow-80mg.pdf" />
            <p className="text-[11px] text-ink-muted mt-1">Must match a URL in the product’s COA list so the right products are linked.</p>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Compound(s)">
              <input className={inputCls} value={form.compound ?? ''} onChange={(e) => set('compound', e.target.value)} placeholder="BPC-157; TB-500; GHK-Cu" />
            </Field>
            <Field label="CAS number(s)">
              <input className={inputCls} value={form.cas_number ?? ''} onChange={(e) => set('cas_number', e.target.value)} placeholder="137525-51-0; …" />
            </Field>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Purity %">
              <input type="number" step="0.01" min="0" max="100" className={inputCls} value={form.purity_pct ?? ''} onChange={(e) => set('purity_pct', e.target.value === '' ? null : parseFloat(e.target.value))} placeholder="97.65" />
            </Field>
            <Field label="Method">
              <input className={inputCls} value={form.method ?? ''} onChange={(e) => set('method', e.target.value)} placeholder="HPLC-UV" />
            </Field>
            <Field label="Sample ID">
              <input className={inputCls} value={form.sample_id ?? ''} onChange={(e) => set('sample_id', e.target.value)} placeholder="5026_0266" />
            </Field>
            <Field label="Matrix">
              <input className={inputCls} value={form.matrix ?? ''} onChange={(e) => set('matrix', e.target.value)} placeholder="Other" />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Result date">
              <input type="date" className={inputCls} value={form.report_date ?? ''} onChange={(e) => set('report_date', e.target.value)} />
            </Field>
            <Field label="Receiving date">
              <input type="date" className={inputCls} value={form.receiving_date ?? ''} onChange={(e) => set('receiving_date', e.target.value)} />
            </Field>
            <Field label="Registration date">
              <input type="date" className={inputCls} value={form.registration_date ?? ''} onChange={(e) => set('registration_date', e.target.value)} />
            </Field>
          </div>

          {/* Visibility */}
          <label className="flex items-center justify-between gap-4 p-4 rounded-xl bg-surface border border-line cursor-pointer">
            <span className="flex items-center gap-2 text-sm">
              {form.active ?? true ? <Eye className="w-4 h-4 text-emerald-600" /> : <EyeOff className="w-4 h-4 text-ink-muted" />}
              <span className="font-medium text-ink">Visible on the public site</span>
            </span>
            <button
              type="button"
              onClick={() => set('active', !(form.active ?? true))}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.active ?? true ? 'bg-emerald-500' : 'bg-line'}`}
              aria-pressed={form.active ?? true}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.active ?? true ? 'translate-x-5' : ''}`} />
            </button>
          </label>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-line">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-ink-muted hover:text-ink transition-colors">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink hover:bg-ink/90 text-white text-sm font-semibold rounded-lg transition-all disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {isNew ? 'Create' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2.5 bg-white rounded-lg border border-line focus:outline-none focus:ring-2 focus:ring-vital/40 text-sm text-ink placeholder-ink-muted';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
