'use client';

import React from 'react';
import { Bitcoin, CreditCard } from 'lucide-react';
import type { InvoicePaymentMethodChoice } from '@/lib/supabase';

/**
 * What the customer picked on the invoice payment page. Shown on the invoices
 * list and the invoice screen. Renders nothing when no choice has been made —
 * an invoice that was never sent a payment request (or whose customer hasn't
 * opened it yet) shouldn't carry an empty badge.
 */
export default function PaymentMethodBadge({
  method,
  size = 'sm',
  title,
}: {
  method: InvoicePaymentMethodChoice | null | undefined;
  size?: 'xs' | 'sm';
  title?: string;
}) {
  if (method !== 'crypto' && method !== 'card') return null;

  const isCrypto = method === 'crypto';
  const Icon = isCrypto ? Bitcoin : CreditCard;
  const label = isCrypto ? 'Crypto' : 'Visa/MC';
  const tone = isCrypto
    ? 'bg-amber-100 text-amber-700'
    : 'bg-indigo-100 text-indigo-700';
  const dims =
    size === 'xs'
      ? 'px-1.5 py-0.5 text-[7px] gap-1'
      : 'px-2 py-0.5 text-[10px] gap-1.5';
  const iconSize = size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3';

  return (
    <span
      title={
        title ??
        (isCrypto
          ? 'Customer chose to pay by crypto'
          : 'Customer chose Visa/Mastercard (Stealth Health hosted checkout)')
      }
      className={`inline-flex items-center rounded font-semibold whitespace-nowrap ${tone} ${dims}`}
    >
      <Icon className={`${iconSize} flex-shrink-0`} />
      {label}
    </span>
  );
}
