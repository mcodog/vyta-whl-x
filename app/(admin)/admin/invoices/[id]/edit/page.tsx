'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { getInvoice } from '@/lib/admin/invoices';
import type { Invoice } from '@/lib/supabase';
import InvoiceForm from '@/components/admin/InvoiceForm';

export default function EditInvoicePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getInvoice(id).then((inv) => {
      setInvoice(inv);
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-ink-muted text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading invoice…
      </div>
    );
  }
  if (!invoice) {
    return (
      <div className="text-center py-20">
        <p className="text-ink-muted text-sm">Invoice not found.</p>
        <Link href="/admin/invoices" className="mt-3 inline-block text-vital">Back to invoices</Link>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/admin/invoices/${id}`}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-line text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-ink font-mono">{invoice.invoice_number}</h1>
          <p className="text-sm text-ink-muted">Edit invoice</p>
        </div>
      </div>
      <InvoiceForm mode="edit" invoiceId={id} initial={invoice} />
    </>
  );
}
