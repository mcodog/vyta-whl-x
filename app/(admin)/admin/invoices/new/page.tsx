'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Package } from 'lucide-react';
import InvoiceForm from '@/components/admin/InvoiceForm';

function NewInvoiceInner() {
  const isPrepaid = useSearchParams().get('type') === 'prepaid';

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/admin/invoices"
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-line text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-ink">
              {isPrepaid ? 'New Prepaid Invoice' : 'New Invoice'}
            </h1>
            {isPrepaid && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-vital/10 text-vital">
                <Package className="w-3 h-3" /> Prepaid
              </span>
            )}
          </div>
          <p className="text-sm text-ink-muted">
            {isPrepaid
              ? 'A client-prepaid order — after saving, generate supplier purchase orders from the invoice page.'
              : 'Pick a customer and add line items.'}
          </p>
        </div>
      </div>
      <InvoiceForm mode="create" prepaid={isPrepaid} />
    </>
  );
}

export default function NewInvoicePage() {
  return (
    <Suspense fallback={null}>
      <NewInvoiceInner />
    </Suspense>
  );
}
