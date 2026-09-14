'use client';

import { useEffect, useState } from 'react';

/**
 * True only on devices that actually support hover with a fine pointer (i.e. a
 * mouse). Touch devices return false, so hover-only affordances — like the
 * packaging image that swaps in on hover — can be skipped entirely and never
 * downloaded on phones, where they'd be pure wasted bandwidth.
 *
 * Starts false (matching SSR) and flips to true after mount on hover-capable
 * devices, so it never triggers a hydration mismatch.
 */
export function useHoverCapable(): boolean {
  const [hoverCapable, setHoverCapable] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    setHoverCapable(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setHoverCapable(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return hoverCapable;
}
