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

describe('ranking what comes back', () => {
  const grant = {
    title: 'Green Skills Programme',
    description: 'Practical skills for young people',
    recipientName: 'Wells Youth Collective',
    region: 'Somerset',
    amountGbp: 24_000,
  };

  it('scores a term in the title highest, being the strongest statement of purpose', () => {
    expect(relevance(grant, { terms: ['skills'], region: null, amountSoughtGbp: null })).toBe(4);
  });

  it('scores the applicant’s own area, but below a word in the title', () => {
    // This comment used to say the area was "the strongest signal", and the
    // numbers agreed: region 3 against 2 for any term anywhere. Measured
    // against a real corpus that put five "Chapel roof repair" grants above
    // thirty-nine titled "Youth skills programme", because the chapel grants
    // went to Wells Youth Collective in Somerset.
    expect(relevance(grant, { terms: [], region: 'Somerset', amountSoughtGbp: null })).toBe(3);
  });

  it('scores a grant around the size they are asking for', () => {
    expect(relevance(grant, { terms: [], region: null, amountSoughtGbp: 30_000 })).toBe(2);
  });

  it('scores nothing when nothing matches', () => {
    expect(
      relevance(grant, { terms: ['heritage'], region: 'Gwynedd', amountSoughtGbp: 500_000 }),
    ).toBe(0);
  });

  it('orders by score and keeps the API’s order as the tie-break', () => {
    const a = { ...grant, title: 'A', description: null, recipientName: null };
    const b = { ...grant, title: 'skills', description: null, recipientName: null };
    const c = { ...grant, title: 'B', description: null, recipientName: null };
    const ranked = rankGrants([a, b, c], {
      terms: ['skills'],
      region: null,
      amountSoughtGbp: null,
    });
    expect(ranked.map((g) => g.title)).toEqual(['skills', 'A', 'B']);
  });

  it('does not reorder the caller’s array', () => {
    // The array is the fetched page; mutating it would make a second render of
    // the same data order differently.
    const page = [
      { ...grant, title: 'A' },
      { ...grant, title: 'skills' },
    ];
    rankGrants(page, { terms: ['skills'], region: null, amountSoughtGbp: null });
    expect(page.map((g) => g.title)).toEqual(['A', 'skills']);
  });
});

describe('ranking a row the database matched by its stem', () => {
  /**
   * The database search is full text now (migration 0015), so Postgres stems:
   * a search for "youths" MATCHES a grant that says "youth". The ranking is a
   * plain substring check, and a plain substring check scored that row zero —
   * below rows that matched nothing at all. A row the query returned and the
   * ranking cannot see is worse than one that was never returned, because it
   * makes the ordering look random.
   */
  const grant = {
    title: 'Youth skills programme',
    description: 'Practical training for young people',
    recipientName: 'Wells Youth Collective',
    region: 'Somerset',
    amountGbp: 12_000,
  };

  const score = (terms: string[]): number =>
    relevance(grant, { terms, region: null, amountSoughtGbp: null });

  it('scores the plural term against the singular text', () => {
    expect(score(['youths'])).toBe(score(['youth']));
  });

  it('already scored the singular term against plural text', () => {
    // Free, and always was: "skills" contains "skill". Four rather than two
    // because it is in the title.
    expect(score(['skill'])).toBe(4);
  });

  it('does not match a different word that merely ends in s', () => {
    // "was" must not be read as "wa", nor "its" as "it" — hence the length
    // floor. This is one rule about English plurals, not a stemmer.
    expect(score(['ass'])).toBe(0);
  });

  it('still scores an unrelated term zero', () => {
    expect(score(['heritages'])).toBe(0);
  });
});

const context = (terms: string[]) => ({ terms, region: null, amountSoughtGbp: null });

describe('where a term was found decides what it is worth', () => {
  /**
   * The search that forced this. "youth skills somerset", measured against a
   * loaded corpus, returned five **Chapel roof repair** grants above all
   * thirty-nine grants titled "Youth skills programme" — because the chapel
   * grants went to "Wells Youth Collective" in Somerset, so one incidental
   * word in a recipient's NAME plus the right county beat two deliberate
   * words in a TITLE. The whole page of 120 results held three scores.
   */
  const bare = { region: null, amountGbp: 0 };

  it('is worth most in the title', () => {
    const grant = { ...bare, title: 'Youth skills programme', description: null, recipientName: null };
    expect(relevance(grant, context(['youth']))).toBe(4);
  });

  it('then in the publisher’s own classification', () => {
    const grant = {
      ...bare,
      title: 'Programme',
      description: null,
      recipientName: null,
      tags: ['Children and young people'],
    };
    expect(relevance(grant, context(['young']))).toBe(3);
  });

  it('then in the description', () => {
    const grant = { ...bare, title: 'Programme', description: 'For young people', recipientName: null };
    expect(relevance(grant, context(['young']))).toBe(2);
  });

  it('and least in the recipient’s name, which is not what the money bought', () => {
    const grant = { ...bare, title: 'Chapel roof repair', description: null, recipientName: 'Wells Youth Collective' };
    expect(relevance(grant, context(['youth']))).toBe(1);
  });

  it('puts the youth-skills grant above the chapel roof, which is the whole point', () => {
    const terms = ['youth', 'skills', 'somerset'];
    const ctx = { terms, region: 'Somerset', amountSoughtGbp: 30_000 };
    const chapel = {
      title: 'Chapel roof repair',
      description: 'Urgent repairs to the roof of a listed chapel.',
      recipientName: 'Wells Youth Collective',
      region: 'Somerset',
      amountGbp: 2536,
    };
    const youth = {
      title: 'Youth skills programme',
      description: 'Practical training for young people.',
      recipientName: 'Moorside CIC',
      region: 'Devon',
      amountGbp: 18_000,
    };
    expect(relevance(youth, ctx)).toBeGreaterThan(relevance(chapel, ctx));
  });

  it('scores a term once, at the best place it appears', () => {
    // A word in both the title and the description is one piece of evidence
    // stated twice. Adding both would reward a publisher for repeating
    // themselves.
    const grant = {
      ...bare,
      title: 'Youth work',
      description: 'Youth work for youth groups, run by youth workers',
      recipientName: 'Youth Trust',
    };
    expect(relevance(grant, context(['youth']))).toBe(4);
  });

  it('has room to tell results apart', () => {
    // The measured page held three distinct scores across 120 results, so the
    // order inside each band was whatever SQL happened to return.
    const terms = ['youth', 'skills', 'training'];
    const ctx = { terms, region: 'Somerset', amountSoughtGbp: 30_000 };
    const scores = new Set(
      [
        { title: 'Youth skills training', description: null, recipientName: null, region: 'Somerset', amountGbp: 30_000 },
        { title: 'Youth skills', description: 'training', recipientName: null, region: 'Somerset', amountGbp: 30_000 },
        { title: 'Youth', description: 'skills and training', recipientName: null, region: 'Devon', amountGbp: 30_000 },
        { title: 'Roof repair', description: null, recipientName: 'Youth Trust', region: 'Devon', amountGbp: 900 },
      ].map((g) => relevance(g, ctx)),
    );
    expect(scores.size).toBe(4);
  });
});
