import { describe, expect, it } from 'vitest';

import { MAX_TERMS, queryTerms, rankGrants, relevance, searchPattern } from './query.js';

describe('reading what somebody typed', () => {
  it('keeps the significant words, in order', () => {
    expect(queryTerms('Youth skills in Somerset')).toEqual(['youth', 'skills', 'somerset']);
  });

  it('drops words that narrow nothing', () => {
    // "grants for our project" is every grant in the corpus.
    expect(queryTerms('grants for our project')).toEqual([]);
  });

  it('drops words too short to mean anything', () => {
    expect(queryTerms('to be or not')).toEqual([]);
  });

  it('de-duplicates', () => {
    expect(queryTerms('youth youth YOUTH')).toEqual(['youth']);
  });

  it('caps how many terms it will send', () => {
    const many = Array.from({ length: 20 }, (_, i) => `term${i}`).join(' ');
    expect(queryTerms(many)).toHaveLength(MAX_TERMS);
  });
});

describe('the pattern sent to 360Giving', () => {
  it('joins terms with alternation, because a phrase never matches', () => {
    // The search is a regex over the whole grant JSON; those words are never
    // adjacent in it.
    expect(searchPattern('youth skills')).toBe('youth|skills');
  });

  it('cannot let a regex metacharacter through, whatever is typed', () => {
    // The pattern runs on somebody else's server, so the guarantee is by
    // construction: the tokeniser keeps only letters and digits, which leaves
    // nothing to escape. A sanitiser can be wrong about one character; a
    // whitelist cannot.
    expect(searchPattern('skills a+b (c)* ^$')).toBe('skills');
    for (const typed of ['(((', '.*.*.*', 'a{1,99999}', '[a-z]+$', '\\d\\w\\s']) {
      const built = searchPattern(typed);
      if (built !== null) expect(built, typed).toMatch(/^[\p{L}\p{N}|]+$/u);
    }
  });

  it('refuses to search for nothing', () => {
    // An empty regex matches every grant in the corpus — a million-row request
    // dressed as a search.
    expect(searchPattern('')).toBeNull();
    expect(searchPattern('  the and  ')).toBeNull();
  });
});

const ctx = (
  over: Partial<{ region: string | null; amountSoughtGbp: number | null }> = {},
) => ({ region: null, amountSoughtGbp: null, ...over });

describe('ranking what comes back', () => {
  const grant = {
    title: 'Green Skills Programme',
    region: 'Somerset',
    amountGbp: 24_000,
    textScore: null as number | null,
  };

  /**
   * THE TEXT PART IS THE DATABASE'S NOW.
   *
   * This function used to hold field weights and count, per word, the best
   * field it appeared in. Those numbers were themselves a fix for an earlier
   * version — and they could not be right, because counting fields cannot
   * know how much a word narrows. `community` and `nursery` both appear in
   * titles; one matched 47% of a 464-grant corpus and the other 4%.
   *
   * `textScore` arrives as a fraction of the best score those words could
   * get, computed where the corpus statistics are.
   */
  it('scores the text match far above either applicant bonus', () => {
    expect(relevance({ ...grant, textScore: 1 }, ctx())).toBe(20);
    expect(relevance({ ...grant, textScore: 0.5 }, ctx())).toBe(10);
    expect(relevance({ ...grant, textScore: 0 }, ctx())).toBe(0);
    // Null, for a screen with no search behind it, is not an error.
    expect(relevance(grant, ctx())).toBe(0);
  });

  it('scores the applicant’s own area, well below the words they typed', () => {
    expect(relevance(grant, ctx({ region: 'Somerset' }))).toBe(3);
    expect(relevance(grant, ctx({ region: 'Gwynedd' }))).toBe(0);
  });

  it('scores a grant around the size they are asking for', () => {
    expect(relevance(grant, ctx({ amountSoughtGbp: 30_000 }))).toBe(2);
    expect(relevance(grant, ctx({ amountSoughtGbp: 500_000 }))).toBe(0);
  });

  /**
   * The judgement the scale exists to make.
   *
   * Somebody who typed words wants grants matching those words. Their county
   * is how to order the ones that do, not a reason to lift the ones that do
   * not — so a better match elsewhere still comes first.
   */
  it('puts a better match elsewhere above a weaker one on their doorstep', () => {
    const better = relevance({ ...grant, textScore: 0.7, region: 'Powys' },
      ctx({ region: 'Somerset', amountSoughtGbp: 30_000 }));
    const closer = relevance({ ...grant, textScore: 0.3, region: 'Somerset' },
      ctx({ region: 'Somerset', amountSoughtGbp: 30_000 }));
    expect(better).toBeGreaterThan(closer);
  });

  it('and between two equally good matches, prefers theirs', () => {
    const here = relevance({ ...grant, textScore: 0.6, region: 'Somerset' },
      ctx({ region: 'Somerset' }));
    const away = relevance({ ...grant, textScore: 0.6, region: 'Powys' },
      ctx({ region: 'Somerset' }));
    expect(here).toBeGreaterThan(away);
  });

  it('orders by score and keeps the query’s order as the tie-break', () => {
    const a = { ...grant, title: 'A', textScore: 0.2 };
    const b = { ...grant, title: 'B', textScore: 0.9 };
    const c = { ...grant, title: 'C', textScore: 0.2 };
    expect(rankGrants([a, b, c], ctx()).map((g) => g.title)).toEqual(['B', 'A', 'C']);
  });

  it('does not reorder the caller’s array', () => {
    // The array is the fetched page; mutating it would make a second render of
    // the same data order differently.
    const page = [
      { ...grant, title: 'A', textScore: 0.1 },
      { ...grant, title: 'B', textScore: 0.9 },
    ];
    rankGrants(page, ctx());
    expect(page.map((g) => g.title)).toEqual(['A', 'B']);
  });
});
