'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Building2, Plus, Search, Edit2, Trash2, Save, X, AlertCircle, Tags,
} from 'lucide-react';
import {
  getAllSuppliers, createSupplier, updateSupplier, deleteSupplier,
} from '@/lib/admin/purchase-orders';
import type { Supplier } from '@/lib/supabase';
import NumberInput from '@/components/admin/NumberInput';

const emptyDraft = {
  name: '', contact_person: '', email: '', phone: '', lead_time_days: 7, notes: '',
};

function SuppliersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  // Seed the search from the URL so it survives refresh/Back and can be shared.
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [search, pathname, router]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<typeof emptyDraft>(emptyDraft);

  const refresh = async () => {
    setSuppliers(await getAllSuppliers());
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return suppliers;
    const q = search.toLowerCase();
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.contact_person ?? '').toLowerCase().includes(q) ||
        (s.email ?? '').toLowerCase().includes(q),
    );
  }, [suppliers, search]);

  const startEdit = (s: Supplier) => {
    setEditingId(s.id);
    setCreating(false);
    setDraft({
      name: s.name,
      contact_person: s.contact_person ?? '',
      email: s.email ?? '',
      phone: s.phone ?? '',
      lead_time_days: s.lead_time_days ?? 7,
      notes: s.notes ?? '',
    });
  };

  const cancel = () => {
    setCreating(false);
    setEditingId(null);
    setDraft(emptyDraft);
    setError(null);
  };

  const save = async () => {
    setError(null);
    if (!draft.name.trim()) return setError('Name is required');
    try {
      if (creating) {
        await createSupplier({
          name: draft.name.trim(),
          contact_person: draft.contact_person || null,
          email: draft.email || null,
          phone: draft.phone || null,
          lead_time_days: draft.lead_time_days,
          notes: draft.notes || null,
        });
      } else if (editingId) {
        await updateSupplier(editingId, {
          name: draft.name.trim(),
          contact_person: draft.contact_person || null,
          email: draft.email || null,
          phone: draft.phone || null,
          lead_time_days: draft.lead_time_days,
          notes: draft.notes || null,
        });
      }
      cancel();
      refresh();
    } catch (e: any) {
      setError(e.message ?? 'Could not save');
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteSupplier(id);
      setConfirmDeleteId(null);
      refresh();
    } catch (e: any) {
      setError(e.message ?? 'Delete failed');
      setConfirmDeleteId(null);
    }
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/purchase-orders"
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-line text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2">
              <Building2 className="w-6 h-6 text-bronze" /> Suppliers
            </h1>
            <p className="text-sm text-ink-muted">{suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/purchase-orders/supplier-pricelists"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-line text-ink-muted hover:text-ink hover:border-ink/20 rounded-lg text-sm transition-colors"
          >
            <Tags className="w-4 h-4" /> Pricelists
          </Link>
          <button
            onClick={() => { setCreating(true); setEditingId(null); setDraft(emptyDraft); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-ink hover:bg-ink/90 text-white rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Add Supplier
          </button>
        </div>
      </div>

      <div className="relative mb-5 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search suppliers..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-line rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40"
        />
      </div>

      {(creating || editingId) && (
        <SupplierForm
          draft={draft}
          setDraft={setDraft}
          onSave={save}
          onCancel={cancel}
          error={error}
          isNew={creating}
        />
      )}

      <div className="bg-white rounded-xl border border-line overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm text-ink-muted">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-muted">
            {suppliers.length === 0 ? 'No suppliers yet. Add your first one.' : 'No suppliers match.'}
          </div>
        ) : (
          <ul className="divide-y divide-line/50">
            {filtered.map((s) => (
              <li key={s.id} className="px-5 py-4 flex items-center gap-4 hover:bg-surface transition-colors">
                <div className="w-10 h-10 rounded-full bg-bronze/10 text-bronze flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink truncate">{s.name}</div>
                  <div className="text-xs text-ink-muted flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {s.contact_person && <span>{s.contact_person}</span>}
                    {s.email && <span>{s.email}</span>}
                    {s.phone && <span>{s.phone}</span>}
                  </div>
                </div>
                {s.lead_time_days != null && (
                  <span className="text-xs px-2 py-1 rounded bg-surface text-ink-muted whitespace-nowrap">
                    {s.lead_time_days}d lead
                  </span>
                )}
                <div className="flex items-center gap-1">
                  {confirmDeleteId === s.id ? (
                    <>
                      <button
                        onClick={() => remove(s.id)}
                        className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                      >
                        Confirm delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs px-2 py-1 text-ink-muted hover:text-ink"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startEdit(s)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(s.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export default function SuppliersPageWrapper() {
  // SuppliersPage reads the URL via useSearchParams, which Next requires to sit
  // inside a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <SuppliersPage />
    </Suspense>
  );
}

function SupplierForm({
  draft, setDraft, onSave, onCancel, error, isNew,
}: {
  draft: typeof emptyDraft;
  setDraft: (d: typeof emptyDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  error: string | null;
  isNew: boolean;
}) {
  const fld = 'w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-bronze/40';
  return (
    <div className="bg-white rounded-xl border border-line p-5 mb-5">
      <h3 className="text-sm font-semibold text-ink mb-4">
        {isNew ? 'Add Supplier' : 'Edit Supplier'}
      </h3>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Company name *</label>
          <input className={fld} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Contact person</label>
          <input className={fld} value={draft.contact_person} onChange={(e) => setDraft({ ...draft, contact_person: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Email</label>
          <input type="email" className={fld} value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Phone</label>
          <input className={fld} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Lead time (days)</label>
          <NumberInput
            min={0}
            placeholder="0"
            className={fld}
            value={draft.lead_time_days}
            onChange={(v) => setDraft({ ...draft, lead_time_days: v ?? 0 })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-ink-muted uppercase tracking-wider mb-1">Notes</label>
          <textarea
            rows={2}
            className={fld}
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </div>
      </div>
      {error && (
        <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
        </div>
      )}
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onSave}
          className="inline-flex items-center gap-2 bg-ink hover:bg-ink/90 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Save className="w-4 h-4" /> {isNew ? 'Create' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-2 text-ink-muted hover:text-ink px-4 py-2 text-sm"
        >
          <X className="w-4 h-4" /> Cancel
        </button>
      </div>
    </div>
  );
}
