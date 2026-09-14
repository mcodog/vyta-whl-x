import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

/**
 * Address autocomplete proxy backed by Photon (OpenStreetMap) — free, no API
 * key. Results are restricted to Canada and normalized to the fields the
 * checkout form uses. Proxied server-side so we can bias/clean results
 * consistently.
 */

const PHOTON_URL = 'https://photon.komoot.io/api/';
// Rough bounding box for Canada: minLon,minLat,maxLon,maxLat
const CANADA_BBOX = '-141.0,41.6,-52.6,83.2';
const REQUEST_TIMEOUT_MS = 6000;

const PROVINCE_CODES: Record<string, string> = {
  alberta: 'AB',
  'british columbia': 'BC',
  manitoba: 'MB',
  'new brunswick': 'NB',
  'newfoundland and labrador': 'NL',
  'northwest territories': 'NT',
  'nova scotia': 'NS',
  nunavut: 'NU',
  ontario: 'ON',
  'prince edward island': 'PE',
  quebec: 'QC',
  québec: 'QC',
  saskatchewan: 'SK',
  yukon: 'YT',
};

function provinceCode(state: string): string {
  if (!state) return '';
  if (state.length === 2) return state.toUpperCase();
  return PROVINCE_CODES[state.toLowerCase()] || state;
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`address-ac:${ip}`, RATE_LIMITS.general);
  if (!rl.allowed) {
    return NextResponse.json({ results: [] }, { status: 429 });
  }

  const q = req.nextUrl.searchParams.get('q')?.trim() || '';
  if (q.length < 3) return NextResponse.json({ results: [] });

  const url = `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=6&lang=en&bbox=${CANADA_BBOX}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return NextResponse.json({ results: [] });

    const data = await res.json();
    const features: any[] = Array.isArray(data?.features) ? data.features : [];

    const seen = new Set<string>();
    const results = features
      .map((f) => {
        const p = f?.properties || {};
        if ((p.countrycode || '').toUpperCase() !== 'CA') return null;

        const street = p.street || p.name || '';
        const line1 = [p.housenumber, street].filter(Boolean).join(' ').trim();
        const city = p.city || p.town || p.village || p.municipality || p.county || '';
        const state = provinceCode(p.state || '');
        const postalCode = p.postcode || '';
        if (!line1 && !city) return null;

        const label = [line1, city, state, postalCode].filter(Boolean).join(', ');
        return { label, line1, city, state, postalCode, country: 'CA' };
      })
      .filter((r): r is NonNullable<typeof r> => {
        if (!r) return false;
        if (seen.has(r.label)) return false;
        seen.add(r.label);
        return true;
      });

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  } finally {
    clearTimeout(timeout);
  }
}
