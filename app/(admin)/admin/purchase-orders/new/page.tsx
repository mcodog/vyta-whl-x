'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, PackageX, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import PurchaseOrderForm from '../PurchaseOrderForm';

interface DraftItem {
  id: string | null;
  product_id: string | null;
  description: string;
  sku_snapshot: string | null;
  qty: number;
  unit_price: number;
  price_type: 'box' | 'vial';
  qty_received: number;
}

function NewPurchaseOrderContent() {
  const searchParams = useSearchParams();
  const backorderId = searchParams.get('backorder');

  const [loading, setLoading] = useState(!!backorderId);
  const [prefill, setPrefill] = useState<DraftItem[] | undefined>(undefined);
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!backorderId) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/admin/backorders/${backorderId}`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (!res.ok) throw new Error('Could not load the backorder');
        const { backorder } = await res.json();
        const items: DraftItem[] = (backorder.items ?? []).map((i: any) => ({
          id: null,
          product_id: i.product_id,
          description: i.description,
          sku_snapshot: null,
          // The shortfall is what needs purchasing; cost is filled in by staff.
          qty: Number(i.qty_backordered),
          unit_price: 0,
          price_type: 'box',
          qty_received: 0,
        }));
        setPrefill(items);
        setInvoiceNumber(backorder.invoice?.invoice_number ?? null);
      } catch (e: any) {
        setError(e?.message ?? 'Could not load the backorder');
      } finally {
        setLoading(false);
      }
    })();
  }, [backorderId]);

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={backorderId ? '/admin/backorders' : '/admin/purchase-orders'}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-line text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink">New Purchase Order</h1>
          <p className="text-sm text-ink-muted">Pick a supplier and add line items.</p>
        </div>
      </div>

      {backorderId && invoiceNumber && (
        <div className="mb-5 flex items-start gap-2 p-3 bg-vital/10 border border-vital/30 rounded-lg text-sm text-ink">
          <PackageX className="w-4 h-4 text-vital flex-shrink-0 mt-0.5" />
          <span>
            Fulfilling the backorder for invoice{' '}
            <span className="font-mono font-medium">{invoiceNumber}</span>. The backordered
            quantities are prefilled below — pick a supplier, set costs, and create the PO to
            clear the backorder.
          </span>
        </div>
      )}

      {error && (
        <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-ink-muted text-sm py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading backorder…
        </div>
      ) : (
        <PurchaseOrderForm mode="create" prefillItems={prefill} backorderId={backorderId} />
      )}
    </>
  );
}

export default function NewPurchaseOrderPage() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-ink-muted text-sm">Loading…</div>}>
      <NewPurchaseOrderContent />
    </Suspense>
  );
}
