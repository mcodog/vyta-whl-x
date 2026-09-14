import { describe, it, expect } from 'vitest';
import { scoreMatch, rankBySearch, byNewest, searchTokens, ilikeOrGroups } from './search';

describe('scoreMatch', () => {
  it('ranks exact > prefix > word-prefix > substring > none', () => {
    expect(scoreMatch('d', 'd')).toBeGreaterThan(scoreMatch('donald', 'd'));
    expect(scoreMatch('donald', 'd')).toBeGreaterThan(scoreMatch('mc donald', 'd'));
    expect(scoreMatch('mc donald', 'd')).toBeGreaterThan(scoreMatch('maddox', 'd'));
    expect(scoreMatch('maddox', 'd')).toBeGreaterThan(scoreMatch('bob', 'd'));
    expect(scoreMatch(null, 'd')).toBe(0);
  });
});

describe('rankBySearch', () => {
  const customers = [
    { first_name: 'Sarah', last_name: null, email: 'donald-gen@x.com' },
    { first_name: 'D', last_name: null, email: 'gen-abc-d@x.com' },
    { first_name: 'Bob', last_name: null, email: 'maddox@x.com' },
  ];
  const fields = [
    { value: (c: (typeof customers)[number]) => c.first_name, weight: 3 },
    { value: (c: (typeof customers)[number]) => c.email, weight: 1 },
  ];

  it('puts a name that equals the query above mere email matches', () => {
    const ranked = rankBySearch(customers, 'd', fields);
    expect(ranked[0].first_name).toBe('D'); // exact name match wins
    expect(ranked.map((c) => c.first_name)).toEqual(['D', 'Sarah', 'Bob']);
  });

  it('drops non-matching items', () => {
    const ranked = rankBySearch(customers, 'zzz', fields);
    expect(ranked).toEqual([]);
  });

  it('returns the list unchanged for a blank query', () => {
    expect(rankBySearch(customers, '   ', fields)).toBe(customers);
  });

  it('ranks a name prefix above products that only match in the description', () => {
    // Regression: searching "reta" surfaced Hexarelin/Ipamorelin (which merely
    // mention Retatrutide in their description) above Retatrutide itself.
    const catalog = [
      { name: 'Hexarelin Acetate 5mg', category: 'Healing / Recovery', description: 'A growth hormone secretagogue often compared to Retatrutide.' },
      { name: 'Ipamorelin 10mg', category: 'Healing / Recovery', description: 'Selective secretagogue; unlike Retatrutide, it is not a GLP agonist.' },
      { name: 'Retatrutide 10mg', category: 'Weight Loss / Metabolic', description: 'Triple agonist for metabolic research.' },
    ];
    const productFields = [
      { value: (p: (typeof catalog)[number]) => p.name, weight: 3 },
      { value: (p: (typeof catalog)[number]) => p.category, weight: 1 },
      { value: (p: (typeof catalog)[number]) => p.description, weight: 1 },
    ];
    const ranked = rankBySearch(catalog, 'reta', productFields);
    expect(ranked[0].name).toBe('Retatrutide 10mg');
  });

  it('uses the tie-breaker for equal scores', () => {
    const items = [
      { first_name: 'D', created_at: '2020-01-01' },
      { first_name: 'D', created_at: '2024-01-01' },
    ];
    const ranked = rankBySearch(
      items,
      'd',
      [{ value: (c: (typeof items)[number]) => c.first_name }],
      byNewest,
    );
    expect(ranked[0].created_at).toBe('2024-01-01'); // newest first
  });
});

describe('searchTokens', () => {
  it('splits a multi-word query into tokens', () => {
    expect(searchTokens('Sample User')).toEqual(['Sample', 'User']);
  });

  it('collapses extra whitespace', () => {
    expect(searchTokens('  Sample   User  ')).toEqual(['Sample', 'User']);
  });

  it('strips PostgREST filter structural characters', () => {
    // Parens and commas would break an `.or()` filter string.
    expect(searchTokens('Doe, John (VIP)')).toEqual(['Doe', 'John', 'VIP']);
  });

  it('returns an empty list for a blank or punctuation-only query', () => {
    expect(searchTokens('   ')).toEqual([]);
    expect(searchTokens('(),')).toEqual([]);
  });
});

describe('ilikeOrGroups', () => {
  it('builds one OR-group per token across all columns', () => {
    // Regression: selecting a customer drops "First Last" into the search box.
    // A single whole-phrase ILIKE matched no column (first_name = "Sample",
    // last_name = "User"); tokenising resolves the customer. Chaining these
    // groups with successive `.or()` calls ANDs the tokens together.
    expect(
      ilikeOrGroups(['Sample', 'User'], ['first_name', 'last_name', 'email']),
    ).toEqual([
      'first_name.ilike.%Sample%,last_name.ilike.%Sample%,email.ilike.%Sample%',
      'first_name.ilike.%User%,last_name.ilike.%User%,email.ilike.%User%',
    ]);
  });

  it('handles a single-token query', () => {
    expect(ilikeOrGroups(['Sample'], ['first_name', 'last_name'])).toEqual([
      'first_name.ilike.%Sample%,last_name.ilike.%Sample%',
    ]);
  });

  it('returns no groups for no tokens', () => {
    expect(ilikeOrGroups([], ['first_name'])).toEqual([]);
  });
});
