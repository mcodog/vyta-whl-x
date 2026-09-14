'use client';

import React from 'react';
import { Receipt } from 'lucide-react';
import { money, formatDate, type PayView } from './types';

/**
 * The customer's order, exactly as it appears on their invoice: line items,
 * the money breakdown, and — the part that matters on a payment page — the
 * balance still due, held apart from the total so a partly-paid invoice reads
 * correctly.
 */
export default function OrderSummary({ invoice }: { invoice: PayView['invoice'] }) {
  const { currency } = invoice;
  const extras: { label: string; value: number }[] = [];
  if (invoice.shipping_cost > 0) extras.push({ label: 'Shipping', value: invoice.shipping_cost });
  if (invoice.processing_fee > 0)
    extras.push({ label: 'Processing fee', value: invoice.processing_fee });
  if (invoice.tax_total > 0) extras.push({ label: 'Tax', value: invoice.tax_total });

  return (
    <section className="bg-white rounded-2xl border border-line overflow-hidden">
      <header className="px-5 sm:px-6 py-4 border-b border-line flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Receipt className="w-4 h-4 text-vital flex-shrink-0" />
          <h2 className="text-sm font-semibold text-ink truncate">
            Invoice {invoice.invoice_number}
          </h2>
        </div>
        <span className="text-xs text-ink-muted whitespace-nowrap">
          Due {formatDate(invoice.due_date)}
        </span>
      </header>

      <div className="divide-y divide-line/60">
        {invoice.items.length === 0 ? (
          <p className="px-5 sm:px-6 py-5 text-sm text-ink-muted">
            No line items on this invoice.
          </p>
        ) : (
          invoice.items.map((item, i) => (
            <div key={i} className="px-5 sm:px-6 py-3.5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-ink leading-snug">{item.description}</p>
                <p className="text-xs text-ink-muted mt-0.5">
                  {item.qty} × {money(item.unit_price, currency)}
                  {item.price_type === 'vial' ? ' · per vial' : ''}
                </p>
              </div>
              <span className="text-sm text-ink tabular-nums whitespace-nowrap">
                {money(item.line_total, currency)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="px-5 sm:px-6 py-4 border-t border-line bg-surface/60 space-y-1.5">
        <Row label="Subtotal" value={money(invoice.subtotal, currency)} />
        {extras.map((e) => (
          <Row key={e.label} label={e.label} value={money(e.value, currency)} />
        ))}
        <Row label="Total" value={money(invoice.total, currency)} strong />
        {invoice.amount_paid > 0 && (
          <Row label="Already paid" value={`− ${money(invoice.amount_paid, currency)}`} />
        )}
      </div>

      <div className="px-5 sm:px-6 py-4 border-t border-line flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium text-ink">Amount due</span>
        <span className="text-2xl font-semibold text-ink tabular-nums">
          {money(invoice.amount_due, currency)}
        </span>
      </div>
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className={strong ? 'text-ink font-medium' : 'text-ink-muted'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'text-ink font-medium' : 'text-ink-muted'}`}>
        {value}
      </span>
    </div>
  );
}
