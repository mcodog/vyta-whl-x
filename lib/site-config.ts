/**
 * Storefront site configuration — branding + web tracking — stored on the
 * singleton `site_settings` row and managed from /admin/marketing.
 *
 * These values are PUBLIC by nature: branding is rendered in the header/footer/
 * page metadata, and the tracking IDs are embedded in client-side pixel scripts.
 * No secrets live here. Read server-side (metadata) via {@link readSiteConfigRow}
 * and client-side via {@link fetchSiteConfig} / the public /api/site-config route.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SiteConfig {
  /** Store name shown in the nav, footer and browser title. */
  store_name: string;
  /** Small tagline under the store name (nav/footer). */
  store_tagline: string;
  /** Logo image URL; when null the storefront shows the built-in mark. */
  logo_url: string | null;
  /** Favicon image URL; when null the storefront uses /favicon.png. */
  favicon_url: string | null;
  /** GA4 measurement id (G-XXXXXXXXXX); null/empty disables GA4. */
  ga4_measurement_id: string | null;
  /** Meta (Facebook) Pixel id; null/empty disables the pixel. */
  meta_pixel_id: string | null;
  /** When true, gate pixels behind a cookie-consent banner. */
  tracking_consent_required: boolean;
}

// Built-in fallback — the VYTA Biosciences house brand, so nothing looks
// broken before the migration runs or if a fetch fails.
export const DEFAULT_SITE_CONFIG: SiteConfig = {
  store_name: 'VYTA Biosciences',
  store_tagline: 'Research Peptides',
  logo_url: null,
  favicon_url: null,
  ga4_measurement_id: null,
  meta_pixel_id: null,
  tracking_consent_required: true,
};

export const SITE_CONFIG_COLUMNS =
  'store_name, store_tagline, logo_url, favicon_url, ga4_measurement_id, meta_pixel_id, tracking_consent_required';

const cleanStr = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/** Normalise a raw DB row (or an already-shaped config) into a SiteConfig. */
export function shapeSiteConfig(row: Record<string, unknown> | null | undefined): SiteConfig {
  const r = row ?? {};
  return {
    store_name: cleanStr(r.store_name) ?? DEFAULT_SITE_CONFIG.store_name,
    store_tagline: cleanStr(r.store_tagline) ?? DEFAULT_SITE_CONFIG.store_tagline,
    logo_url: cleanStr(r.logo_url),
    favicon_url: cleanStr(r.favicon_url),
    ga4_measurement_id: cleanStr(r.ga4_measurement_id),
    meta_pixel_id: cleanStr(r.meta_pixel_id),
    // Default to requiring consent (safer); only an explicit false disables it.
    tracking_consent_required: r.tracking_consent_required === false ? false : true,
  };
}

/**
 * Read the site config server-side, degrading gracefully to defaults if the
 * marketing migration hasn't run yet (so the storefront never 500s on an old DB).
 */
export async function readSiteConfigRow(db: SupabaseClient): Promise<SiteConfig> {
  try {
    const { data, error } = await db
      .from('site_settings')
      .select(SITE_CONFIG_COLUMNS)
      .single();
    if (error || !data) return DEFAULT_SITE_CONFIG;
    return shapeSiteConfig(data as Record<string, unknown>);
  } catch {
    return DEFAULT_SITE_CONFIG;
  }
}

/** Fetch the public site config from the client. Never throws. */
export async function fetchSiteConfig(): Promise<SiteConfig> {
  try {
    const res = await fetch('/api/site-config', { cache: 'no-store' });
    if (!res.ok) return DEFAULT_SITE_CONFIG;
    return shapeSiteConfig(await res.json());
  } catch {
    return DEFAULT_SITE_CONFIG;
  }
}
