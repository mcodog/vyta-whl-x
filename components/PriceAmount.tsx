'use client';

import React from 'react';

/**
 * A money amount that holds a shimmer until it is actually knowable.
 *
 * Two things can make a price on screen wrong for a moment: the currency and
 * exchange rate haven't resolved yet (a CAD figure would flash before the USD
 * one), and the cart hasn't been re-priced against the signed-in customer yet
 * (the add-to-cart snapshot would flash before their own price). Both are the
 * same bug from the shopper's side — a number that changes under them — so
 * every cart surface renders amounts through this and passes `ready`.
 */
export default function PriceAmount({
  value,
  ready,
  w = 'w-16',
}: {
  value: number;
  ready: boolean;
  /** Tailwind width of the placeholder, sized to the amount it stands in for. */
  w?: string;
}) {
  if (!ready) {
    return (
      <span
        className={`inline-block h-4 ${w} bg-surface rounded animate-pulse align-middle`}
        aria-label="Loading price"
      />
    );
  }
  return <>{`$${(Number(value) || 0).toFixed(2)}`}</>;
}
