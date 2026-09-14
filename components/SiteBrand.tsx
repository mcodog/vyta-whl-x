'use client';

import React from 'react';
import { VytaMark, VytaWordmark } from './VytaLogo';
import { useSiteConfig } from '@/contexts/SiteConfigContext';
import { DEFAULT_SITE_CONFIG } from '@/lib/site-config';

/**
 * The storefront brand lockup, in one place.
 *
 * Branding stays editable from /admin/marketing, so this resolves three cases:
 *   1. a custom logo has been uploaded  → that image beside the configured name;
 *   2. the store has been renamed       → the VYTA mark beside the custom name;
 *   3. untouched VYTA branding          → the drawn lockup, mark + wordmark.
 *
 * Case 3 is the one the guidelines care about: the wordmark is artwork, never
 * typeset, so it only appears when the brand really is VYTA.
 */
export default function SiteBrand({
  tone = 'dark',
  size = 40,
  className = '',
}: {
  /** `dark` = brand on a light ground; `light` = reversed, for navy/overlay. */
  tone?: 'dark' | 'light';
  size?: number;
  className?: string;
}) {
  const { config } = useSiteConfig();
  const reversed = tone === 'light';
  const isHouseBrand =
    !config.logo_url && config.store_name === DEFAULT_SITE_CONFIG.store_name;

  if (isHouseBrand) {
    return (
      <span
        className={`inline-flex items-center ${className}`}
        style={{ gap: size * 0.3 }}
        role="img"
        aria-label={DEFAULT_SITE_CONFIG.store_name}
      >
        <VytaMark size={size} tone={reversed ? 'light' : 'color'} />
        <VytaWordmark height={size * 0.72} tone={reversed ? 'light' : 'color'} />
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      {config.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={config.logo_url}
          alt={config.store_name}
          className="rounded-xl object-contain"
          style={{ width: size, height: size }}
        />
      ) : (
        <VytaMark size={size} tone={reversed ? 'light' : 'color'} />
      )}
      <span className="flex flex-col">
        <span
          className={`font-display text-lg font-semibold tracking-tight leading-none ${
            reversed ? 'text-white' : 'text-ink'
          }`}
        >
          {config.store_name}
        </span>
        {config.store_tagline && (
          <span
            className={`text-[10px] tracking-[0.22em] font-medium uppercase mt-1 ${
              reversed ? 'text-mist' : 'text-vital'
            }`}
          >
            {config.store_tagline}
          </span>
        )}
      </span>
    </span>
  );
}
