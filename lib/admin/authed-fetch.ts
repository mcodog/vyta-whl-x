import { supabase } from "@/lib/supabase";

/**
 * GET a server route with the current Supabase session bearer token attached.
 * Used by admin dashboard widgets that read service-role endpoints. Always
 * bypasses the browser cache so the numbers are fresh on each load/poll.
 */
export async function authedGet<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}
