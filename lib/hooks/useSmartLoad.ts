'use client';

/**
 * Smart data-loading hook.
 *
 * Wraps an async loader and exposes a small state machine that the UI can use
 * to drive skeleton loaders plus two "smart" affordances:
 *   - `slow`  -> the request is still in flight after `slowThresholdMs`, so we
 *               can surface a "This is taking a while" notice with a reload.
 *   - `error` -> the loader rejected, so we can surface a "try again" message.
 *
 * `reload()` re-runs the loader on demand (used by both notices).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_SLOW_THRESHOLD_MS = 8000;

export interface SmartLoadState<T> {
  data: T | undefined;
  loading: boolean;
  /** Still loading after the slow threshold elapsed. */
  slow: boolean;
  /** The loader rejected on the most recent attempt. */
  error: boolean;
  /** Re-run the loader. */
  reload: () => void;
}

export function useSmartLoad<T>(
  loader: () => Promise<T>,
  deps: React.DependencyList = [],
  options?: { slowThresholdMs?: number }
): SmartLoadState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  const slowThreshold = options?.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS;

  // Keep the latest loader without making it a dependency of the effect.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(() => setReloadCount((c) => c + 1), []);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setSlow(false);
    setError(false);

    const slowTimer = setTimeout(() => {
      if (!cancelled) setSlow(true);
    }, slowThreshold);

    loaderRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('useSmartLoad: loader failed', err);
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        clearTimeout(slowTimer);
        setLoading(false);
        setSlow(false);
      });

    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadCount, slowThreshold]);

  return { data, loading, slow, error, reload };
}
