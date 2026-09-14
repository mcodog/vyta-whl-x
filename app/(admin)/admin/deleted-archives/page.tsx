'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Archive,
  FileText,
  Package,
  Users,
  DollarSign,
  Download,
  Eye,
  X,
  Loader2,
  UserCheck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';

type Kind = 'customer' | 'sales_person' | 'user';

interface SnapshotRow {
  id: string;
  entity_type: Kind;
  entity_id: string | null;
  entity_label: string | null;
  counts: {
    invoices?: number;
    orders?: number;
    clients?: number;
    commissions?: number;
    payments?: number;
  } | null;
  disposition: Record<string, unknown> | null;
  guest_customer_id: string | null;
  created_at: string;
}

const KIND_LABEL: Record<Kind, string> = {
  customer: 'Customer',
  sales_person: 'Sales Person',
  user: 'User',
};

const KIND_BADGE: Record<Kind, string> = {
  customer: 'bg-blue-500/10 text-blue-600',
  sales_person: 'bg-vital/10 text-vital-dark',
  user: 'bg-purple-500/10 text-purple-600',
};

function downloadJson(obj: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function authHeaders(): Promise<Record<string, string> | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

export default function DeletedArchivesPage() {
  const toast = useToast();
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<any | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const headers = await authHeaders();
    if (!headers) {
      setLoading(false);
      return;
    }
    const res = await fetch('/api/admin/deletion-snapshots', { headers });
    const json = await res.json();
    if (res.ok) setRows(json.snapshots ?? []);
    else toast.error(json.error || 'Failed to load archives');
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openSnapshot = async (id: string) => {
    setViewLoading(true);
    setViewing(null);
    const headers = await authHeaders();
    if (!headers) {
      setViewLoading(false);
      return;
    }
    const res = await fetch(`/api/admin/deletion-snapshots?id=${encodeURIComponent(id)}`, {
      headers,
    });
    const json = await res.json();
    if (res.ok) setViewing(json.snapshot);
    else toast.error(json.error || 'Failed to load snapshot');
    setViewLoading(false);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-ink-muted">
            <Archive className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink">Deleted Archives</h1>
            <p className="text-sm text-ink-muted">
              Snapshots captured when a customer, sales person, or user was deleted.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-muted border-b border-line">
                <th className="px-5 py-3 font-medium">Record</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Contents</th>
                <th className="px-5 py-3 font-medium">Kept</th>
                <th className="px-5 py-3 font-medium">Deleted</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-ink-muted">
                    <Loader2 className="inline w-4 h-4 animate-spin mr-2" /> Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-ink-muted text-sm">
                    No deletion snapshots yet.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const c = r.counts ?? {};
                  return (
                    <tr key={r.id} className="border-b border-line/60 hover:bg-surface/50">
                      <td className="px-5 py-3.5 font-medium text-ink">
                        {r.entity_label || r.entity_id?.slice(0, 8) || '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_BADGE[r.entity_type]}`}
                        >
                          {KIND_LABEL[r.entity_type]}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                          {!!c.invoices && (
                            <span className="inline-flex items-center gap-1">
                              <FileText className="w-3.5 h-3.5" />
                              {c.invoices}
                            </span>
                          )}
                          {!!c.orders && (
                            <span className="inline-flex items-center gap-1">
                              <Package className="w-3.5 h-3.5" />
                              {c.orders}
                            </span>
                          )}
                          {!!c.clients && (
                            <span className="inline-flex items-center gap-1">
                              <Users className="w-3.5 h-3.5" />
                              {c.clients}
                            </span>
                          )}
                          {!!c.commissions && (
                            <span className="inline-flex items-center gap-1">
                              <DollarSign className="w-3.5 h-3.5" />
                              {c.commissions}
                            </span>
                          )}
                          {!c.invoices && !c.orders && !c.clients && !c.commissions && '—'}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs">
                        {r.guest_customer_id ? (
                          <span className="inline-flex items-center gap-1 text-green-600">
                            <UserCheck className="w-3.5 h-3.5" /> Guest record
                          </span>
                        ) : (
                          <span className="text-ink-light">Detached</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-ink-muted whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openSnapshot(r.id)}
                            title="View snapshot"
                            className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line bg-white text-ink-muted hover:text-ink hover:bg-surface transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Snapshot viewer */}
      {(viewLoading || viewing) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-3xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-line">
              <h2 className="text-base font-bold text-ink truncate">
                {viewing?.entity_label || 'Snapshot'}
              </h2>
              <button
                onClick={() => setViewing(null)}
                className="text-ink-muted hover:text-ink transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4">
              {viewLoading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-ink-muted text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading snapshot…
                </div>
              ) : (
                <pre className="text-xs bg-surface rounded-lg p-4 overflow-x-auto text-ink whitespace-pre-wrap break-words">
                  {JSON.stringify(viewing?.snapshot ?? viewing, null, 2)}
                </pre>
              )}
            </div>
            {viewing && (
              <div className="border-t border-line px-6 py-4 flex justify-end">
                <button
                  onClick={() =>
                    downloadJson(
                      viewing.snapshot ?? viewing,
                      `deletion-snapshot-${viewing.entity_type}-${viewing.id}.json`,
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90 transition-colors"
                >
                  <Download className="w-4 h-4" /> Download JSON
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
