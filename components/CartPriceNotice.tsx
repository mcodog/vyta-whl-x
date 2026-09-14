'use client';

import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useCart } from '@/contexts/CartContext';

/**
 * Tells the shopper when re-pricing the cart against their account dropped a
 * line — the product was delisted, or is hidden/zero-priced for them. Items
 * leaving the cart on their own would otherwise look like a bug, and they'd
 * find out at the total rather than at the line.
 */
export default function CartPriceNotice({ className = '' }: { className?: string }) {
  const { removedNames, dismissRemoved } = useCart();
  if (removedNames.length === 0) return null;

  return (
    <div
      role="status"
      className={`flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 ${className}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p className="flex-1">
        {removedNames.length === 1 ? 'This item is' : 'These items are'} no longer
        available on your account and {removedNames.length === 1 ? 'was' : 'were'}{' '}
        removed from your cart: <span className="font-semibold">{removedNames.join(', ')}</span>.
      </p>
      <button
        onClick={dismissRemoved}
        aria-label="Dismiss"
        className="flex-shrink-0 rounded p-0.5 text-amber-700 transition-colors hover:text-amber-900"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
