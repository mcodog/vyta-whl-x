// Relevance ranking for person-style autocomplete results.
//
// A substring search (`%q%`) across first_name / last_name / email matches a
// huge number of rows for short queries — a single letter like "D" appears in
// almost every email — so a fixed `.limit(N)` returns an arbitrary slice and
// the truly relevant person (e.g. first_name = "D") gets buried and never
// shows. Fetch a wider candidate set from the DB, then rank locally with this
// helper so name matches beat email matches and prefix/exact matches beat
// mid-string matches before taking the visible top N.

export interface NameMatchable {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}

// Higher score = better match. Rows that don't match the query at all score 0
// and are dropped.
function matchScore(item: NameMatchable, q: string): number {
  const first = item.first_name?.toLowerCase() ?? '';
  const last = item.last_name?.toLowerCase() ?? '';
  const email = item.email?.toLowerCase() ?? '';
  const full = `${first} ${last}`.trim();
  let best = 0;
  const rank = (field: string, base: number) => {
    if (!field) return;
    if (field === q) best = Math.max(best, base + 4);
    else if (field.startsWith(q)) best = Math.max(best, base + 3);
    else if (field.includes(` ${q}`)) best = Math.max(best, base + 2);
    else if (field.includes(q)) best = Math.max(best, base + 1);
  };
  // Names rank above email; full name catches "first last" queries.
  rank(first, 20);
  rank(last, 20);
  rank(full, 20);
  rank(email, 10);
  return best;
}

export function rankNameMatches<T extends NameMatchable>(list: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list
    .map((item) => ({ item, score: matchScore(item, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const an = `${a.item.first_name ?? ''} ${a.item.last_name ?? ''}`.trim().toLowerCase();
      const bn = `${b.item.first_name ?? ''} ${b.item.last_name ?? ''}`.trim().toLowerCase();
      return an.localeCompare(bn);
    })
    .map((x) => x.item);
}
