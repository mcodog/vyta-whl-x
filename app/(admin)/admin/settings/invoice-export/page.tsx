'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Plus, Trash2, Save, Loader2, AlertCircle, Check,
  ExternalLink, KeyRound, Power, Pencil,
} from 'lucide-react';
import { useUserRole } from '../../layout';
import {
  listDestinations, createDestination, updateDestination, deleteDestination,
  type ExportDestinationView,
} from '@/lib/admin/invoice-export-client';

interface DraftState {
  label: string;
  edge_function_url: string;
  secret: string;
  notes: string;
}

const EMPTY_DRAFT: DraftState = { label: '', edge_function_url: '', secret: '', notes: '' };

/**
 * Manage the external sites an admin can push invoices to. Each destination
 * points at a receiving site's `import-invoice` Edge Function and holds the
 * shared secret used to authenticate. Secrets are write-only — the list shows
 * only whether one is set.
 */
export default function InvoiceExportSettingsPage() {
  const userRole = useUserRole();
  const isReadOnly = userRole !== 'admin';

  const [items, setItems] = useState<ExportDestinationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  // id currently being edited → its editable draft (secret blank = keep current)
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftState>(EMPTY_DRAFT);

  const load = async () => {
    try {
      setItems(await listDestinations());
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load destinations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const flash = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(''), 2500);
  };

  const submitNew = async () => {
    setError('');
    if (!draft.label.trim() || !draft.edge_function_url.trim() || !draft.secret.trim()) {
      setError('Label, Edge Function URL and secret are all required.');
      return;
    }
    setSaving(true);
    try {
      await createDestination({
        label: draft.label.trim(),
        edge_function_url: draft.edge_function_url.trim(),
        secret: draft.secret.trim(),
        notes: draft.notes.trim() || undefined,
      });
      setDraft(EMPTY_DRAFT);
      setAdding(false);
      await load();
      flash('Destination added');
    } catch (e: any) {
      setError(e?.message ?? 'Could not add destination');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (d: ExportDestinationView) => {
    setEditId(d.id);
    setEditDraft({ label: d.label, edge_function_url: d.edge_function_url, secret: '', notes: d.notes ?? '' });
  };

  const submitEdit = async () => {
    if (!editId) return;
    setError('');
    setSaving(true);
    try {
      await updateDestination(editId, {
        label: editDraft.label.trim(),
        edge_function_url: editDraft.edge_function_url.trim(),
        notes: editDraft.notes.trim() || null,
        // Only send secret when the admin typed a new one.
        ...(editDraft.secret.trim() ? { secret: editDraft.secret.trim() } : {}),
      });
      setEditId(null);
      await load();
      flash('Destination updated');
    } catch (e: any) {
      setError(e?.message ?? 'Could not update destination');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (d: ExportDestinationView) => {
    setError('');
    try {
      await updateDestination(d.id, { enabled: !d.enabled });
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Could not update destination');
    }
  };

  const remove = async (d: ExportDestinationView) => {
    if (!confirm(`Delete destination "${d.label}"? This cannot be undone.`)) return;
    setError('');
    try {
      await deleteDestination(d.id);
      await load();
      flash('Destination deleted');
    } catch (e: any) {
      setError(e?.message ?? 'Could not delete destination');
    }
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/admin/settings"
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-line text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink">Invoice export destinations</h1>
          <p className="text-sm text-ink-muted">
            Other websites you can push invoices to. Each points at that site&apos;s
            <span className="font-mono text-xs"> import-invoice</span> Edge Function.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-red-700 text-sm">{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span className="text-emerald-700 text-sm">{success}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-ink-muted text-sm py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-3">
          {items.length === 0 && !adding && (
            <div className="bg-white rounded-xl border border-line p-8 text-center text-sm text-ink-muted">
              No destinations configured yet. Add one to start exporting invoices.
            </div>
          )}

          {items.map((d) =>
            editId === d.id ? (
              <div key={d.id} className="bg-white rounded-xl border border-vital/40 p-5 space-y-3">
                <DestinationFields draft={editDraft} setDraft={setEditDraft} secretPlaceholder="Leave blank to keep current secret" />
                <div className="flex items-center gap-2 justify-end">
                  <button onClick={() => setEditId(null)} disabled={saving} className="px-3 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50">Cancel</button>
                  <button onClick={submitEdit} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-lg text-sm font-medium disabled:opacity-50">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <div key={d.id} className="bg-white rounded-xl border border-line p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ExternalLink className="w-4 h-4 text-vital flex-shrink-0" />
                      <h3 className="font-semibold text-ink truncate">{d.label}</h3>
                      {!d.enabled && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface border border-line text-ink-muted">Disabled</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-muted font-mono break-all">{d.edge_function_url}</p>
                    <p className="mt-1 text-xs text-ink-muted flex items-center gap-1">
                      <KeyRound className="w-3 h-3" />
                      {d.secret_set ? 'Shared secret set' : 'No secret set'}
                    </p>
                    {d.notes && <p className="mt-1 text-xs text-ink-muted">{d.notes}</p>}
                  </div>
                  {!isReadOnly && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => toggleEnabled(d)} title={d.enabled ? 'Disable' : 'Enable'} className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface">
                        <Power className={`w-4 h-4 ${d.enabled ? 'text-emerald-600' : ''}`} />
                      </button>
                      <button onClick={() => startEdit(d)} title="Edit" className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => remove(d)} title="Delete" className="w-8 h-8 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ),
          )}

          {adding ? (
            <div className="bg-white rounded-xl border border-vital/40 p-5 space-y-3">
              <h3 className="font-semibold text-ink text-sm">New destination</h3>
              <DestinationFields draft={draft} setDraft={setDraft} secretPlaceholder="Shared secret (matches the EF's IMPORT_INVOICE_SECRET)" />
              <div className="flex items-center gap-2 justify-end">
                <button onClick={() => { setAdding(false); setDraft(EMPTY_DRAFT); setError(''); }} disabled={saving} className="px-3 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50">Cancel</button>
                <button onClick={submitNew} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-vital text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add destination
                </button>
              </div>
            </div>
          ) : (
            !isReadOnly && (
              <button
                onClick={() => { setAdding(true); setError(''); }}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-dashed border-line hover:border-vital/40 text-ink rounded-xl text-sm font-medium w-full justify-center"
              >
                <Plus className="w-4 h-4" /> Add a destination
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

function DestinationFields({
  draft, setDraft, secretPlaceholder,
}: {
  draft: DraftState;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
  secretPlaceholder: string;
}) {
  return (
    <>
      <div>
        <label className="block text-xs font-medium text-ink-muted mb-1">Label</label>
        <input
          value={draft.label}
          onChange={(e) => setDraft((s) => ({ ...s, label: e.target.value }))}
          placeholder="e.g. EU store"
          className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vital/40"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-ink-muted mb-1">Edge Function URL</label>
        <input
          value={draft.edge_function_url}
          onChange={(e) => setDraft((s) => ({ ...s, edge_function_url: e.target.value }))}
          placeholder="https://<project>.supabase.co/functions/v1/import-invoice"
          className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-vital/40"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-ink-muted mb-1">Shared secret</label>
        <input
          type="password"
          value={draft.secret}
          onChange={(e) => setDraft((s) => ({ ...s, secret: e.target.value }))}
          placeholder={secretPlaceholder}
          autoComplete="new-password"
          className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vital/40"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-ink-muted mb-1">Notes (optional)</label>
        <input
          value={draft.notes}
          onChange={(e) => setDraft((s) => ({ ...s, notes: e.target.value }))}
          placeholder="Anything worth remembering about this site"
          className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vital/40"
        />
      </div>
    </>
  );
}
