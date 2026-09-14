'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Frame-based count-up. Eases from 0 up to `target` over `durationMs`,
 * decelerating into place. Unlike a tick-by-tick counter this stays smooth for
 * large values (e.g. a five-figure revenue) — one update per animation frame,
 * not one per unit — so it never schedules thousands of timers.
 *
 * Mount the consumer only once the real value is known (e.g. after a loading
 * skeleton) so the animation runs a single time from 0 to the final number.
 */
export function useCountUpSmooth(target: number, durationMs = 1400): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(target) || target <= 0) {
      setValue(target > 0 ? target : 0);
      return;
    }
    let startTs: number | null = null;
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (ts: number) => {
      if (startTs === null) startTs = ts;
      const p = Math.min((ts - startTs) / durationMs, 1);
      setValue(target * easeOutCubic(p));
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else setValue(target);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [target, durationMs]);

  return value;
}
