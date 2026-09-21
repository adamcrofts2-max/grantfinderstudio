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
  over: Partial<{
    region: string | null;
    amountSoughtGbp: number | null;
    terms: readonly string[];
  }> = {},
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

  /**
   * A county somebody TYPED, which is a different thing from the county they
   * are in — and was worth nothing here until it was measured.
   *
   * The search vector does carry `region`, so a typed county earns some text
   * score, but at weight `D`: the lowest, because for every other purpose a
   * region mention is the weakest kind of hit. Measured on a 587-grant
   * corpus, "bristol green space" put a DEVON grant first, above every
   * Bristol one, on a better word match.
   */
  describe('a place they named in the search', () => {
    const named = (over: Partial<typeof grant>, terms: string[]) =>
      relevance({ ...grant, ...over }, ctx({ terms }));

    it('lifts the county they asked for above a moderately better match', () => {
      // Half the words in Bristol beats 70% of them in Devon.
      const asked = named({ textScore: 0.5, region: 'Bristol' }, ['bristol', 'green']);
      const elsewhere = named({ textScore: 0.7, region: 'Devon' }, ['bristol', 'green']);
      expect(asked).toBeGreaterThan(elsewhere);
    });

    it('does not lift it above a much better one', () => {
      // Because a county in a search is not always a constraint: "Dorset
      // Coast Volunteers" is a recipient who works elsewhere. The place
      // chips beside the results are the filter, and they say what they
      // would leave.
      const asked = named({ textScore: 0.5, region: 'Bristol' }, ['bristol', 'green']);
      const muchBetter = named({ textScore: 0.85, region: 'Devon' }, ['bristol', 'green']);
      expect(muchBetter).toBeGreaterThan(asked);
    });

    it('matches whole words, so a term cannot match half a place name', () => {
      // `art` must not match Dartmoor, nor `ton` Taunton — this test is the
      // reason the check is not the substring one the applicant's own region
      // uses.
      expect(named({ textScore: 0, region: 'Dartmoor' }, ['art'])).toBe(0);
      expect(named({ textScore: 0, region: 'Taunton' }, ['ton'])).toBe(0);
      expect(named({ textScore: 0, region: 'Dartmoor' }, ['dartmoor'])).toBe(5);
    });

    it('reads a multi-word region a word at a time', () => {
      expect(named({ textScore: 0, region: 'North Somerset' }, ['somerset'])).toBe(5);
      expect(named({ textScore: 0, region: 'Somerset County Council' }, ['county'])).toBe(5);
    });

    it('is nothing at all when they typed no place', () => {
      expect(named({ textScore: 0, region: 'Bristol' }, ['green', 'space'])).toBe(0);
      expect(named({ textScore: 0, region: null }, ['bristol'])).toBe(0);
    });

    it('stacks with their own area, because they are different claims', () => {
      // Somebody in Somerset searching "somerset trees" gets both: the grant
      // is where they are AND where they asked about.
      const both = relevance(
        { ...grant, textScore: 0, region: 'Somerset' },
        ctx({ region: 'Somerset', terms: ['somerset', 'trees'] }),
      );
      expect(both).toBe(8);
    });

    it('is ignored by a caller that has no search', () => {
      // The funder screen and the recent-grants list rank without terms.
      expect(relevance({ ...grant, textScore: 0, region: 'Bristol' }, ctx())).toBe(0);
    });
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
