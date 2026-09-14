'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { UserPlus, Check, X, Loader2, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface AffiliateRequest {
  id: string;
  customer_id: string;
  status: string;
  wallet_address: string | null;
  message: string | null;
  created_at: string;
  customer: { first_name: string | null; last_name: string | null; email: string } | null;
}

export default function PendingAffiliateRequests({
  canReview,
  onApproved,
}: {
  canReview: boolean;
  onApproved: () => void;
}) {
  const [requests, setRequests] = useState<AffiliateRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch('/api/admin/affiliate-requests?status=pending', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const review = async (id: string, action: 'approve' | 'deny') => {
    setActing(id);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch(`/api/admin/affiliate-requests/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        await load();
        if (action === 'approve') onApproved();
      }
    } finally {
      setActing(null);
    }
  };

  // Hide the section entirely when there's nothing pending.
  if (!loading && requests.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-vital/30 overflow-hidden mb-6">
      <div className="p-5 border-b border-line flex items-center gap-2 bg-vital/5">
        <UserPlus className="w-5 h-5 text-vital" />
        <h2 className="text-lg font-bold text-ink">Affiliate Requests</h2>
        {!loading && (
          <span className="ml-1 inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 rounded-full bg-vital text-white text-xs font-semibold">
            {requests.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="p-8 flex justify-center">
          <Loader2 className="w-5 h-5 text-ink-muted animate-spin" />
        </div>
      ) : (
        <div className="divide-y divide-line/60">
          {requests.map((r) => {
            const name = `${r.customer?.first_name ?? ''} ${r.customer?.last_name ?? ''}`.trim();
            return (
              <div key={r.id} className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-ink text-sm">{name || 'Customer'}</div>
                  <div className="text-xs text-ink-muted">{r.customer?.email}</div>
                  {r.wallet_address && (
                    <div className="flex items-center gap-1 text-xs text-ink-muted mt-1 break-all">
                      <Wallet className="w-3 h-3" /> {r.wallet_address}
                    </div>
                  )}
                  {r.message && (
                    <p className="text-xs text-ink mt-2 bg-surface rounded-lg p-2 whitespace-pre-wrap">{r.message}</p>
                  )}
                  <div className="text-[11px] text-ink-muted mt-1">
                    Requested {new Date(r.created_at).toLocaleDateString()}
                  </div>
                </div>
                {canReview ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => review(r.id, 'approve')}
                      disabled={acting === r.id}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-500 text-white text-sm font-medium rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-60"
                    >
                      {acting === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Approve
                    </button>
                    <button
                      onClick={() => review(r.id, 'deny')}
                      disabled={acting === r.id}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-white text-ink border border-line text-sm font-medium rounded-lg hover:border-red-300 hover:text-red-600 transition-colors disabled:opacity-60"
                    >
                      <X className="w-4 h-4" />
                      Deny
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-ink-muted shrink-0">Admin approval required</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
