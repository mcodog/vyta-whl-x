// Relevance-ranked search shared across admin list views.
//
// A flat substring filter (`field.includes(query)`) ranks an incidental match
// — e.g. a pre-generated email that happens to contain a "d" — exactly the same
// as a real one, e.g. a customer whose first name is literally "D". Instead we
// score each field and sort the strongest matches to the top so typing "d"
// surfaces the people actually named "D" first.

export type SearchAccessor<T> = (item: T) => string | null | undefined;

export interface SearchField<T> {
  /** Pulls the text to match from an item. */
  value: SearchAccessor<T>;
  /** Relative importance of this field. Higher ranks first. Default 1. */
  weight?: number;
}

/**
 * Score a single value against an already-lowercased/trimmed query.
 * Higher tiers always beat lower ones regardless of field weighting.
 */
export function scoreMatch(value: string | null | undefined, query: string): number {
  if (!value) return 0;
  const v = value.toLowerCase();
  if (v === query) return 100; // exact match
  if (v.startsWith(query)) return 70; // starts with the query
  if (v.split(/\s+/).some((w) => w.startsWith(query))) return 50; // a word starts with it
  if (v.includes(query)) return 20; // appears somewhere
  return 0;
}

/**
 * Filter `items` to those matching `rawQuery`, ordered by relevance (best
 * first). Non-matching items are dropped. When the query is blank the list is
 * returned unchanged so callers keep their own default ordering.
 *
 * `tieBreak` orders items with identical scores (e.g. newest-first); ties that
 * it doesn't resolve fall back to the original order, so the sort is stable.
 */
export function rankBySearch<T>(
  items: T[],
  rawQuery: string,
  fields: SearchField<T>[],
  tieBreak?: (a: T, b: T) => number,
): T[] {
  const q = rawQuery.toLowerCase().trim();
  if (!q) return items;

  return items
    .map((item, index) => {
      let best = 0;
      let total = 0;
      for (const field of fields) {
        const s = scoreMatch(field.value(item), q) * (field.weight ?? 1);
        total += s;
        if (s > best) best = s;
      }
      // Emphasize the single strongest field so a focused match (a name that
      // equals the query) beats an item that only matches weakly across many.
      return { item, index, score: best * 2 + total };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (tieBreak) {
        const t = tieBreak(a.item, b.item);
        if (t !== 0) return t;
      }
      return a.index - b.index; // stable: preserve original order on full ties
    })
    .map((x) => x.item);
}

/** Newest-first tie-breaker for records carrying a `created_at` timestamp. */
export function byNewest(
  a: { created_at?: string | null },
  b: { created_at?: string | null },
): number {
  return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
}

// -------------------------------------------------------------------------
// PostgREST server-side ILIKE search helpers
// -------------------------------------------------------------------------
// A "First Last" query must match a person whose name is split across two
// columns (first_name = "First", last_name = "Last"). Matching the whole phrase
// against each column separately (`first_name.ilike.%First Last%`) never hits,
// so a multi-word query — e.g. the full name dropped into the box after picking
// an autocomplete suggestion — silently resolves to nobody. Tokenising the
// query and ANDing a per-token OR-group across the columns fixes that, mirroring
// the client-side autocomplete's own tokenised lookup.

/**
 * Split a free-text search query into normalized tokens. Splits on whitespace
 * and strips the PostgREST filter structural characters ( `(` `)` `,` ) that
 * would otherwise break an `.or()` filter string. Mirrors the customer-name
 * autocomplete so the server resolves the same rows the dropdown shows.
 */
export function searchTokens(query: string): string[] {
  return query
    .split(/\s+/)
    .map((w) => w.replace(/[(),]/g, ""))
    .filter(Boolean);
}

/**
 * Build one PostgREST `.or()` filter string per token, each ORing an ILIKE
 * `%token%` across every column. Chain the returned strings with successive
 * `.or()` calls — PostgREST ANDs separate `.or()` calls together — so every
 * token must match somewhere, but a token may match any column. This turns a
 * "First Last" query into "(first~First OR last~First OR …) AND (first~Last OR
 * last~Last OR …)", which correctly matches a row split across name columns.
 */
export function ilikeOrGroups(tokens: string[], columns: string[]): string[] {
  return tokens.map((tok) => {
    const like = `%${tok}%`;
    return columns.map((col) => `${col}.ilike.${like}`).join(",");
  });
}
