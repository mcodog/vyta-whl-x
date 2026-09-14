'use client';

import { useEffect, useState } from 'react';

/**
 * The admin-configured free-shipping threshold (CAD-base subtotal). 0 means the
 * feature is disabled. Fetched once from the public `/api/settings/shipping`
 * endpoint and cached at module scope so every mount (drawer, cart page) shares
 * a single request. Best-effort — falls back to 0 (off) on any failure.
 */
let cached: number | null = null;
let inflight: Promise<number> | null = null;

async function loadThreshold(): Promise<number> {
  if (cached !== null) return cached;
  if (!inflight) {
    inflight = fetch('/api/settings/shipping')
      .then((res) => (res.ok ? res.json() : { free_shipping_threshold: 0 }))
      .then((data) => {
        const n = Number(data?.free_shipping_threshold);
        cached = Number.isFinite(n) && n > 0 ? n : 0;
        return cached;
      })
      .catch(() => {
        cached = 0;
        return 0;
      });
  }
  return inflight;
}

export function useFreeShippingThreshold(): number {
  const [threshold, setThreshold] = useState<number>(cached ?? 0);

  useEffect(() => {
    let active = true;
    loadThreshold().then((t) => {
      if (active) setThreshold(t);
    });
    return () => {
      active = false;
    };
  }, []);

  return threshold;
}
