'use client';

import React from 'react';
import { Truck, Check } from 'lucide-react';
import { useCurrency } from '@/contexts/CurrencyContext';
import { usdFromCad } from '@/lib/pricing';
import { useFreeShippingThreshold } from '@/lib/hooks/useFreeShipping';

/**
 * "Spend $X more for free shipping" progress bar. Renders nothing when no
 * threshold is configured. `subtotalCad` is the CAD-base cart subtotal — the
 * same figure checkout compares against — so the bar matches what's actually
 * charged. The remaining amount is shown in the customer's active currency.
 */
export default function FreeShippingBar({ subtotalCad }: { subtotalCad: number }) {
  const threshold = useFreeShippingThreshold();
  const { currency, rate } = useCurrency();

  if (!(threshold > 0) || subtotalCad <= 0) return null;

  const qualified = subtotalCad >= threshold;
  const remainingCad = Math.max(0, threshold - subtotalCad);
  const pct = Math.min(100, Math.round((subtotalCad / threshold) * 100));

  const money = (cad: number) =>
    `$${(currency === 'USD' ? usdFromCad(cad, rate) : cad).toFixed(2)}`;

  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center gap-2 mb-2">
        {qualified ? (
          <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
        ) : (
          <Truck className="w-4 h-4 text-vital flex-shrink-0" />
        )}
        <p className="text-xs text-ink">
          {qualified ? (
            <span className="font-semibold text-emerald-700">
              You&apos;ve unlocked free shipping!
            </span>
          ) : (
            <>
              Add{' '}
              <span className="font-semibold text-ink tabular-nums">
                {money(remainingCad)}
              </span>{' '}
              more for <span className="font-medium">free shipping</span>
            </>
          )}
        </p>
      </div>
      <div className="h-2 w-full rounded-full bg-line overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            qualified ? 'bg-emerald-500' : 'bg-vital'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
