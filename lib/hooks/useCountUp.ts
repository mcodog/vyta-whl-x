'use client';

/**
 * Count-up animation hook.
 *
 * Steps the displayed value up toward `target` one increment at a time so the
 * number visibly ticks (…7, 8, 9). The delay between ticks starts fast
 * (~0.2s) and slows down toward ~1s as the value approaches 95% of the target,
 * so it decelerates into place.
 *
 * Large targets (e.g. a 99.2% purity) would take a minute to tick one-by-one,
 * so the whole run is capped at `maxDurationMs`: past that point the ticks are
 * compressed to fit while still incrementing by 1. Small counters finish well
 * under the cap and get the exact 0.2s→1s feel.
 */

import { useEffect, useRef, useState } from 'react';

const FAST_MS = 200; // delay between the first ticks
const SLOW_MS = 1000; // delay once we're near the target
const KNEE = 0.95; // progress at which the delay reaches SLOW_MS

export function useCountUp(
  target: number,
  {
    start = true,
    maxDurationMs = 3000,
  }: { start?: boolean; maxDurationMs?: number } = {}
): number {
  const [value, setValue] = useState(start ? 0 : target);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!start) return;

    if (target <= 0) {
      setValue(target);
      return;
    }

    // Build the sequence of values to land on: 1, 2, … up to the integer part,
    // then the exact target (so a decimal like 99.2 settles precisely).
    const ceil = Math.floor(target);
    const values: number[] = [];
    for (let v = 1; v <= ceil; v++) values.push(v);
    if (target > ceil) values.push(target);

    // Delay before showing each value, based on how far along it is.
    const delayFor = (v: number) => {
      const t = Math.min(v / target / KNEE, 1);
      return FAST_MS + (SLOW_MS - FAST_MS) * t;
    };
    const delays = values.map(delayFor);

    // Compress the whole run if ticking one-by-one would run past the cap.
    const total = delays.reduce((a, b) => a + b, 0);
    const scale = total > maxDurationMs ? maxDurationMs / total : 1;

    setValue(0);
    let i = 0;
    const run = () => {
      timerRef.current = setTimeout(() => {
        setValue(values[i]);
        i += 1;
        if (i < values.length) run();
      }, delays[i] * scale);
    };
    run();

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [target, start, maxDurationMs]);

  return value;
}
