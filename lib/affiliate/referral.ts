/**
 * Client-side referral attribution.
 *
 * When a visitor lands with `?ref=CODE` we persist the code (first-touch:
 * we never overwrite an existing one) so it can be bound to their account at
 * signup or to their first order. Attribution persists indefinitely via both a
 * long-lived cookie and localStorage.
 */

const REF_KEY = 'aminocan_ref';
// "Forever" — a 10-year cookie.
const REF_MAX_AGE = 60 * 60 * 24 * 365 * 10;
const REF_FORMAT = /^[A-Z0-9]{8}$/;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Capture `?ref=` from the current URL into storage (first-touch).
 * Safe to call repeatedly; only sets if nothing is stored yet.
 */
export function captureReferralFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const param = new URLSearchParams(window.location.search).get('ref');
    if (!param) return;
    const code = param.toUpperCase();
    if (!REF_FORMAT.test(code)) return;
    if (getStoredReferral()) return; // first-touch: don't overwrite
    localStorage.setItem(REF_KEY, code);
    document.cookie = `${REF_KEY}=${encodeURIComponent(code)}; path=/; max-age=${REF_MAX_AGE}; SameSite=Lax`;
  } catch {
    /* ignore storage errors */
  }
}

export function getStoredReferral(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(REF_KEY) || readCookie(REF_KEY);
  } catch {
    return readCookie(REF_KEY);
  }
}

export function clearStoredReferral(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(REF_KEY);
  } catch {
    /* ignore */
  }
  document.cookie = `${REF_KEY}=; path=/; max-age=0; SameSite=Lax`;
}
