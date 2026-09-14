'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { DEFAULT_SITE_CONFIG, fetchSiteConfig, type SiteConfig } from '@/lib/site-config';

interface SiteConfigContextValue {
  config: SiteConfig;
  loading: boolean;
}

const SiteConfigContext = createContext<SiteConfigContextValue>({
  config: DEFAULT_SITE_CONFIG,
  loading: true,
});

/**
 * Fetches the public storefront branding + tracking config once and shares it
 * with the nav, footer, and tracking components. Starts from the built-in
 * defaults so nothing flashes empty while the fetch is in flight.
 */
export function SiteConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<SiteConfig>(DEFAULT_SITE_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchSiteConfig()
      .then((c) => { if (!cancelled) setConfig(c); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <SiteConfigContext.Provider value={{ config, loading }}>
      {children}
    </SiteConfigContext.Provider>
  );
}

export function useSiteConfig(): SiteConfigContextValue {
  return useContext(SiteConfigContext);
}
