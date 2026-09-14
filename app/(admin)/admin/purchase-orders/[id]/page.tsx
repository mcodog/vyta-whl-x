'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText, Lock, Loader2 } from 'lucide-react';
import { supabase, type PurchaseOrder } from '@/lib/supabase';
import { getPurchaseOrder } from '@/lib/admin/purchase-orders';
import { PO_STATUS_META, isPoLocked } from '@/lib/admin/po-status';
import PurchaseOrderForm from '../PurchaseOrderForm';
import PurchaseOrderReceiving from '../PurchaseOrderReceiving';

export default function PurchaseOrderDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);

  const load = React.useCallback(() => {
    if (!id) return;
    getPurchaseOrder(id).then((data) => {
      setPo(data);
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const openPdf = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/purchase-orders/${id}/pdf`, {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
    if (!res.ok) return alert('Could not open PDF');
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-ink-muted text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading purchase order…
      </div>
    );
  }
  if (!po) {
    return (
      <div className="text-center py-20">
        <p className="text-ink-muted text-sm">Purchase order not found.</p>
        <Link href="/admin/purchase-orders" className="mt-3 inline-block text-bronze">Back to list</Link>
      </div>
    );
  }

  const meta = PO_STATUS_META[po.status];
  const locked = isPoLocked(po.status);

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
            <h1 className="text-xl sm:text-2xl font-bold text-ink font-mono break-all">{po.po_number}</h1>
            <p className="text-sm text-ink-muted flex flex-wrap items-center gap-x-3 gap-y-1">
              {po.order_date && <span>Ordered {new Date(po.order_date).toLocaleDateString()}</span>}
              <span>Created {new Date(po.created_at).toLocaleString()}</span>
              <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${meta.badge}`}>
                {meta.label}
              </span>
            </p>
          </div>
        </div>
        <button
          onClick={openPdf}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-line text-ink-muted hover:text-ink hover:border-ink/20 rounded-lg text-sm transition-colors"
        >
          <FileText className="w-4 h-4" /> View PDF
        </button>
      </div>

      {locked && (
        <div className="mb-5 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <Lock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700">
            This purchase order is <strong>{meta.label.toLowerCase()}</strong> and cannot be edited.
            You can still update the payment status below.
          </p>
        </div>
      )}

      <PurchaseOrderReceiving po={po} onChanged={load} />

      <PurchaseOrderForm mode="edit" initial={po} />
    </>
  );
}
