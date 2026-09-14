/**
 * Authenticated `fetch` for admin client components.
 *
 * Attaches the signed-in user's Supabase access token, sends/expects JSON,
 * aborts on a timeout, and turns a non-2xx response into a thrown `Error`
 * carrying the API's own `error` string — so callers can surface the server's
 * message verbatim instead of inventing one.
 */

import { supabase } from '@/lib/supabase';

/** Default request timeout. Admin writes run history + audit hooks server-side. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ApiFetchInit extends RequestInit {
  /** Abort the request after this many milliseconds. Defaults to 10s. */
  timeoutMs?: number;
}

export async function apiFetch<T>(url: string, init: ApiFetchInit = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers, signal, ...rest } = init;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Honour a caller-supplied signal alongside our own timeout.
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort);

  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    const res = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...((headers as Record<string, string> | undefined) ?? {}),
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message =
        body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : `Request failed: ${res.status}`;
      throw new Error(message);
    }

    return (await res.json()) as T;
  } catch (err) {
    // An abort is either our timeout or the caller's cancellation; neither
    // reads well as "AbortError" in a per-row error list.
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(signal?.aborted ? 'Request cancelled' : 'Request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
