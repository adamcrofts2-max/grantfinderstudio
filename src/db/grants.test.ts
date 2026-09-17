/**
 * The local grant search, against the real schema.
 *
 * This is the query an applicant's search runs, and it came back into the
 * database because 360Giving publish no text search over grants — not on the
 * organisation lists, which declare no filter backends, and not on the grant
 * routes, which take an id. A copy held here is the only place grant text can
 * be searched, which is also what 360Giving tell developers to do.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  corpusSize,
  facetsFor,
  funderSummaries,
  recentAwards,
  recipientSummaries,
  searchAwards,
  textSearch,
  type TextSearch,
} from './grants.js';
import { NO_FILTERS, type GrantFilters } from '../domain/grants/facets.js';
import { createTestDatabase, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;
const tx = (): Queryable => harness.db as unknown as Queryable;

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
  await harness.db.exec(`
    INSERT INTO source_datasets (id, name, publisher, licence, attribution, retrieved_at)
    VALUES ('ds_x', '360Giving — Test Trust', 'Test Trust', 'CC BY 4.0',
            'Test Trust, published to the 360Giving Data Standard', now());

    INSERT INTO funders (id, name, website, source_dataset_id)
    VALUES ('funder_360g_GB-CHC-1', 'The Test Trust', 'https://example.org', 'ds_x');

    INSERT INTO funder_awards
      (id, funder_id, recipient_name, amount_gbp, awarded_on, region, tags,
       source_dataset_id, title, description)
    VALUES
      ('aw_1', 'funder_360g_GB-CHC-1', 'Wells Youth Collective', 12000, '2025-05-01',
       'Somerset', ARRAY['Young people'], 'ds_x', 'Youth skills programme',
       'Practical training for young people'),
      ('aw_2', 'funder_360g_GB-CHC-1', 'Leeds Food Project', 8000, '2024-02-10',
       'West Yorkshire', ARRAY['Food poverty'], 'ds_x', 'Food bank running costs',
       'Emergency food parcels'),
      ('aw_3', 'funder_360g_GB-CHC-1', 'St Mary’s PCC', 40000, '2023-09-15',
       'Devon', ARRAY['Heritage'], 'ds_x', 'Chapel roof repair', NULL),
      ('aw_4', 'funder_360g_GB-CHC-1', 'No Date CIC', 5000, NULL,
       'Cornwall', ARRAY['Other'], 'ds_x', 'An old grant', NULL);
  `);
});

afterEach(async () => {
  await harness.close();
});

/**
 * The scope the product builds once per page, built here per call.
 *
 * `searchAwards`, `facetsFor` and `funderSummaries` take a `TextSearch` they
 * cannot construct themselves — it holds what each word is worth, which needs
 * the whole corpus — so a test has to build one too. Throws on an empty word
 * list, because that case is now `textSearch` returning null and is asserted
 * on its own.
 */
const scope = async (words: readonly string[]): Promise<TextSearch> => {
  const text = await textSearch(tx(), words);
  if (text === null) throw new Error(`nothing searchable in ${JSON.stringify(words)}`);
  return text;
};

const ids = (awards: readonly { id: string }[]): string[] => awards.map((a) => a.id).toSorted();

/** Result ids in the order returned, for asserting an order rather than a set. */
const ids2 = (result: { awards: readonly { id: string }[] }): string[] =>
  result.awards.map((a) => a.id);

/** Where an amount band sits on the scale, for asserting the row's order. */
const order = (bandId: string): number =>
  ['under5k', '5k-25k', '25k-100k', '100k-500k', 'over500k'].indexOf(bandId);

describe('searching what is held', () => {
  it('matches a word in the description', async () => {
    const { awards } = await searchAwards(tx(), await scope(['training']));
    expect(ids(awards)).toEqual(['aw_1']);
  });

  it('matches a recipient, a title, a region and a tag', async () => {
    expect(ids((await searchAwards(tx(), await scope(['leeds']))).awards)).toEqual(['aw_2']);
    expect(ids((await searchAwards(tx(), await scope(['chapel']))).awards)).toEqual(['aw_3']);
    expect(ids((await searchAwards(tx(), await scope(['devon']))).awards)).toEqual(['aw_3']);
    expect(ids((await searchAwards(tx(), await scope(['heritage']))).awards)).toEqual(['aw_3']);
  });

  it('matches ANY term, not all of them', async () => {
    // Somebody types "youth skills Somerset" and means "anything like this".
    // A grant described as "young people, employment training" in Wells is
    // exactly what they wanted and shares not one whole word with the query,
    // so requiring every term would return nothing and look like an empty
    // corpus. Ranking is what puts the closest first, elsewhere.
    const { awards } = await searchAwards(tx(), await scope(['chapel', 'leeds']));
    expect(ids(awards)).toEqual(['aw_2', 'aw_3']);
  });

  it('ignores case, because nobody types a funder’s capitals', async () => {
    expect(ids((await searchAwards(tx(), await scope(['SOMERSET']))).awards)).toEqual(['aw_1']);
  });

  it('returns nothing for no terms rather than the whole corpus', async () => {
    // An empty query must not become "select everything": that is a slow
    // request and a screen of noise. There is no scope to build from nothing,
    // so there is no statement to run — the guard is `textSearch` returning
    // null, in one place, rather than repeated in each entry point where it
    // could disagree with the predicate about what "nothing" means.
    expect(await textSearch(tx(), [])).toBeNull();
    expect(await textSearch(tx(), ['   '])).toBeNull();
  });

  it('carries the licence, so attribution travels with the row', async () => {
    const { awards } = await searchAwards(tx(), await scope(['training']));
    expect(awards[0]?.attribution).toContain('360Giving Data Standard');
    expect(awards[0]?.funderName).toBe('The Test Trust');
    expect(awards[0]?.funderWebsite).toBe('https://example.org');
  });

  it('orders newest first', async () => {
    const { awards } = await searchAwards(tx(), await scope(['somerset', 'leeds', 'devon']));
    expect(awards.map((a) => a.id)).toEqual(['aw_1', 'aw_2', 'aw_3']);
  });

  it('says when it capped, rather than quietly showing a slice', async () => {
    const { awards, capped } = await searchAwards(tx(), await scope(['somerset', 'leeds', 'devon']), NO_FILTERS, 2);
    expect(awards).toHaveLength(2);
    expect(capped).toBe(true);
  });

  it('does not treat a percent sign as a wildcard', async () => {
    // `queryTerms` splits on everything that is not a letter or a digit, so a
    // term can never carry one — a whitelist rather than an escape step. This
    // asserts the boundary holds even if something bypasses the tokeniser.
    expect(await textSearch(tx(), ['%'])).toBeNull();
  });

  it('returns nothing from ANY entry point for a term of pure punctuation', async () => {
    // The same case, at all three doors, because getting it right at one is
    // how it went wrong: the guard asked whether a term was non-blank and the
    // predicate asked whether one survived the whitelist, so `%` passed the
    // guard, produced no text clause, and the WHERE fell through to TRUE —
    // every grant in the corpus, presented as a result.
    const junk = ['%', '&', '!', '(', ':*'];
    // There is no scope to build from it, so there is no statement to run.
    // The guard used to be repeated in each of the three entry points and
    // they disagreed with the predicate about what "nothing" meant; now the
    // entry points take a scope they cannot construct, so the one place that
    // can say "nothing searchable" is the only place that has to.
    expect(await textSearch(tx(), junk)).toBeNull();
    expect(await textSearch(tx(), [])).toBeNull();
    expect(await textSearch(tx(), ['   '])).toBeNull();
  });

  it('cannot be made to raise by a tsquery operator', async () => {
    // `&`, `|`, `!` and `<->` are tsquery syntax. Passed through they would
    // not match anything — they would make `to_tsquery` raise, which turns a
    // typed character into a 500 on the search page.
    await expect(searchAwards(tx(), await scope(['youth & !', 'somerset | (devon']))).resolves.toBeTruthy();
  });
});

describe('matching words rather than substrings', () => {
  /**
   * Migration 0015 moved the search from three GIN trigram indexes to one
   * tsvector index, because the trigram indexes were larger than the grants
   * they indexed and the corpus has to fit a free database tier. That changes
   * WHAT MATCHES, so the new behaviour is pinned here rather than left to be
   * discovered by somebody searching.
   */
  it('finds the plural from the singular', async () => {
    const { awards } = await searchAwards(tx(), await scope(['parcel']));
    expect(ids(awards)).toEqual(['aw_2']);
  });

  it('finds the singular from the plural, which trigrams never did', async () => {
    // "Practical training for young people" — a search for "youths" used to
    // match nothing at all, because no substring of the row is "youths".
    // Stemming makes them one word.
    const { awards } = await searchAwards(tx(), await scope(['youths']));
    expect(ids(awards)).toContain('aw_1');
  });

  it('finds a word from its prefix, because people type half a word', async () => {
    // This is what `:*` in `tsqueryFor` is for. Without it "somer" would find
    // nothing, and somebody mid-word would watch the results empty out.
    expect(ids((await searchAwards(tx(), await scope(['somer']))).awards)).toEqual(['aw_1']);
    expect(ids((await searchAwards(tx(), await scope(['yorks']))).awards)).toEqual(['aw_2']);
  });

  it('searches the classification tags, which are often the only "what for"', async () => {
    // "Heritage" appears in no title, description, recipient or region on
    // aw_3 — only in its tag. The tag is in the indexed vector because
    // `array_to_string` is STABLE and so cannot be used in an index
    // expression, which is why 0015 maintains a column with a trigger.
    expect(ids((await searchAwards(tx(), await scope(['heritage']))).awards)).toEqual(['aw_3']);
  });

  it('no longer matches the middle of a word, and that is the trade', async () => {
    // `merset` matched Somerset under trigrams. It does not now. Written down
    // as an expectation rather than left as a surprise: the loss is real, it
    // is not how anybody searches, and it bought the corpus its storage.
    expect((await searchAwards(tx(), await scope(['merset']))).awards).toEqual([]);
  });

  it('keeps the counts and the list on exactly the same predicate', async () => {
    // The whole reason `buildWhere` exists. A facet total that came from a
    // different WHERE than the list is a lie with a number on it — and the
    // text clause is the part that just changed.
    const text = await scope(['youths', 'somer']);
    const { awards } = await searchAwards(tx(), text);
    const facets = await facetsFor(tx(), text, NO_FILTERS);
    expect(facets.total).toBe(awards.length);
  });
});

describe('the index the search is built on', () => {
  /**
   * Proves the predicate can actually USE the index — not merely that both
   * exist. The expression in `buildWhere` and the column the trigger fills
   * are in different files and could drift apart with every test still
   * passing, leaving a corpus of a quarter of a million grants on a
   * sequential scan per facet count.
   *
   * `enable_seqscan = off` is what makes this testable on a four-row fixture:
   * Postgres would never choose an index here on cost, so the question asked
   * is "CAN it", which is the question that matters.
   */
  it('is used by the search, not scanned past', async () => {
    await harness.db.exec('SET enable_seqscan = off;');
    try {
      const { rows } = await harness.db.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT count(*) FROM funder_awards a
          WHERE a.search_vector @@ to_tsquery('english', 'youth:*')`,
      );
      const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
      expect(plan).toContain('funder_awards_search_idx');
    } finally {
      await harness.db.exec('SET enable_seqscan = on;');
    }
  });

  it('fills the vector for a row written by anything at all', async () => {
    // The argument for a trigger over computing this in `replaceFunderAwards`:
    // this row was inserted by a test with plain SQL, exactly as the admin
    // per-funder ingest and every fixture does it. A vector computed in one
    // writer would leave all of them unsearchable, and the tests would have
    // agreed with the code because both skipped the same step.
    const { rows } = await harness.db.query<{ v: string | null }>(
      `SELECT search_vector::text AS v FROM funder_awards WHERE id = 'aw_1'`,
    );
    expect(rows[0]?.v).toContain('youth');
  });

  it('keeps the vector current when a row is updated', async () => {
    await harness.db.exec(
      `UPDATE funder_awards SET description = 'Allotment beds and a polytunnel'
        WHERE id = 'aw_3'`,
    );
    expect(ids((await searchAwards(tx(), await scope(['polytunnel']))).awards)).toEqual(['aw_3']);
  });

  it('holds no trigram indexes any more', async () => {
    // 26 MB per 20,000 grants, which at the corpus's full size was the
    // difference between fitting a free database tier and not.
    const { rows } = await harness.db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'funder_awards' AND indexname LIKE '%trgm'`,
    );
    expect(rows).toEqual([]);
  });
});

describe('a screen nobody has typed into', () => {
  /**
   * Dateless rows are not returned at all now.
   *
   * They used to be, last, and then `toFound` in `search.ts` dropped every one
   * of them before the screen saw it — because a grant with no date cannot be
   * ranked or shown honestly. So asking for the 24 most recent returned 24
   * rows and rendered fewer, and the missing ones were invisible. The filter
   * moved into the query, where the count and the page agree.
   */
  it('shows the most recent awards, and never a dateless one', async () => {
    const awards = await recentAwards(tx(), 10);
    expect(awards.map((a) => a.id)).toEqual(['aw_1', 'aw_2', 'aw_3']);
    expect(awards.every((a) => a.awardedOn !== null)).toBe(true);
  });

  it('counts what is held, so an empty search can say why', async () => {
    const size = await corpusSize(tx());
    expect(size.awards).toBe(4);
    // The harness seeds one fictional funder besides ours.
    expect(size.funders).toBeGreaterThanOrEqual(1);
  });
});

describe('the tenant connection', () => {
  it('can read the corpus, which belongs to nobody', async () => {
    // funder_awards is granted SELECT to app_user and carries no policy: it is
    // published open data, not anybody's own work. So the search needs no
    // tenant scoping — there is nothing organisation-specific in it to leak.
    await harness.db.exec("SET ROLE app_user;");
    const { awards } = await searchAwards(tx(), await scope(['training']));
    expect(awards).toHaveLength(1);
    await harness.db.exec('RESET ROLE;');
  });

  it('cannot write to it', async () => {
    await harness.db.exec("SET ROLE app_user;");
    await expect(
      harness.db.query("DELETE FROM funder_awards WHERE id = 'aw_1'"),
    ).rejects.toThrow();
    await harness.db.exec('RESET ROLE;');
  });
});

const filters = (over: Partial<GrantFilters> = {}): GrantFilters => ({ ...NO_FILTERS, ...over });

describe('narrowing a search', () => {
  it('keeps only the chosen amount bands', async () => {
    // aw_2 is £8,000, aw_1 £12,000, aw_3 £40,000, aw_4 £5,000.
    const { awards } = await searchAwards(
      tx(),
      await scope(['somerset', 'leeds', 'devon', 'cornwall']),
      filters({ bands: ['5k-25k'] }),
    );
    expect(ids(awards)).toEqual(['aw_1', 'aw_2', 'aw_4']);
  });

  it('treats several bands as "any of these"', async () => {
    const { awards } = await searchAwards(
      tx(),
      await scope(['somerset', 'devon']),
      filters({ bands: ['5k-25k', '25k-100k'] }),
    );
    expect(ids(awards)).toEqual(['aw_1', 'aw_3']);
  });

  it('puts a band boundary in exactly one band', async () => {
    // £5,000 is the boundary between "under £5,000" and "£5,000–£25,000".
    // Inclusive lower, exclusive upper, so it belongs to the upper band and to
    // only one — a grant counted twice would make every total wrong.
    const under = await searchAwards(tx(), await scope(['cornwall']), filters({ bands: ['under5k'] }));
    const over = await searchAwards(tx(), await scope(['cornwall']), filters({ bands: ['5k-25k'] }));
    expect(ids(under.awards)).toEqual([]);
    expect(ids(over.awards)).toEqual(['aw_4']);
  });

  it('keeps only grants in the chosen place', async () => {
    const { awards } = await searchAwards(
      tx(),
      await scope(['somerset', 'leeds', 'devon']),
      filters({ places: ['Devon'] }),
    );
    expect(ids(awards)).toEqual(['aw_3']);
  });

  it('matches a place loosely, because publishers write it differently', async () => {
    // "West Yorkshire" should be reachable from "yorkshire".
    const { awards } = await searchAwards(tx(), await scope(['leeds']), filters({ places: ['yorkshire'] }));
    expect(ids(awards)).toEqual(['aw_2']);
  });

  it('matches a topic exactly, because the label came from the facet list', async () => {
    const exact = await searchAwards(tx(), await scope(['somerset']), filters({ topics: ['Young people'] }));
    expect(ids(exact.awards)).toEqual(['aw_1']);
    // Not a substring: merging "Young people" with "Young people, rural"
    // behind somebody's back would make the count they clicked a lie.
    const loose = await searchAwards(tx(), await scope(['somerset']), filters({ topics: ['Young'] }));
    expect(ids(loose.awards)).toEqual([]);
  });

  it('combines dimensions with AND', async () => {
    const { awards } = await searchAwards(
      tx(),
      await scope(['somerset', 'leeds', 'devon']),
      filters({ bands: ['5k-25k'], places: ['Somerset'] }),
    );
    expect(ids(awards)).toEqual(['aw_1']);
  });

  it('cannot be tricked by a wildcard in a place', async () => {
    expect((await searchAwards(tx(), await scope(['somerset']), filters({ places: ['%'] }))).awards).toEqual([]);
  });
});

describe('which matches the page gets', () => {
  /**
   * This ordered by `awarded_on` alone, and the LIMIT is what made that a
   * fault rather than a preference: a search matching 284 grants handed the
   * ranker the NEWEST 120, an arbitrary sample with respect to how well any
   * of them matched. Measured against a real corpus, ten of the forty-nine
   * grants titled "Youth skills programme" never reached the page for a
   * search for youth skills, while seven chapel-roof grants did.
   */
  beforeEach(async () => {
    await harness.db.exec(`
      INSERT INTO funder_awards
        (id, funder_id, recipient_name, amount_gbp, awarded_on, region, tags,
         source_dataset_id, title, description)
      VALUES
        -- The best match, and the OLDEST row, so date ordering buries it.
        ('aw_best', 'funder_360g_GB-CHC-1', 'Moorside CIC', 9000, '2023-10-01',
         'Devon', ARRAY['Young people'], 'ds_x', 'Youth skills training',
         'Practical skills training for young people'),
        -- A recipient-name match only, and the NEWEST row.
        ('aw_name', 'funder_360g_GB-CHC-1', 'Wells Youth Collective', 2500, '2026-06-01',
         'Devon', ARRAY['Heritage'], 'ds_x', 'Chapel roof repair',
         'Urgent repairs to a listed chapel roof'),
        -- In the applicant's county and about nothing they do. A PLACE match
        -- and nothing else, which is the only way to tell whether typing a
        -- county still reaches the county.
        ('aw_place', 'funder_360g_GB-CHC-1', 'St Michael’s PCC', 6500, '2025-02-02',
         'Somerset', ARRAY['Heritage'], 'ds_x', 'Bell tower repair',
         'Repointing and repairs to a bell tower');
    `);
  });

  it('returns the best match first, not the newest', async () => {
    const { awards } = await searchAwards(tx(), await scope(['youth', 'skills']));
    expect(awards[0]?.id).toBe('aw_best');
  });

  it('keeps the best match even when the page holds one row', async () => {
    // The real shape of the bug: the limit decides what the ranker can see.
    const { awards } = await searchAwards(tx(), await scope(['youth', 'skills']), NO_FILTERS, 1);
    expect(awards.map((a) => a.id)).toEqual(['aw_best']);
  });

  it('still prefers the recent one between equally good matches', async () => {
    await harness.db.exec(`
      INSERT INTO funder_awards
        (id, funder_id, recipient_name, amount_gbp, awarded_on, region, tags,
         source_dataset_id, title, description)
      VALUES ('aw_best2', 'funder_360g_GB-CHC-1', 'Moorside CIC', 9000, '2026-01-01',
              'Devon', ARRAY['Young people'], 'ds_x', 'Youth skills training',
              'Practical skills training for young people');
    `);
    const { awards } = await searchAwards(tx(), await scope(['youth', 'skills']), NO_FILTERS, 2);
    expect(awards[0]?.id).toBe('aw_best2');
  });

  it('weights a title above a recipient’s name — and then drops the name', async () => {
    // 0020 put `setweight` on the vector. Without it these two rank equally
    // and the newest wins, which is how a roof grant led a youth search.
    //
    // The floor takes it further than the order: a grant whose only tie to
    // "youth" is that the recipient is called a Youth something is not a
    // match, once anything matched the word properly. `aw_name` is exactly
    // that row, and it is not on the page at all.
    const shown = ids2(await searchAwards(tx(), await scope(['youth'])));
    expect(shown).toContain('aw_best');
    expect(shown).not.toContain('aw_name');
  });

  /**
   * THE COUNT AND THE LIST HAVE TO BE THE SAME QUESTION.
   *
   * The floor is the reason this is worth asserting and not just obviously
   * true. It lives in `buildWhere` alongside the text predicate, so the page
   * query, every facet count, the total and each funder's tally all carry it.
   * Putting it anywhere else — a filter applied to the list after the fact,
   * say — would leave the header saying 284 over a page of 49.
   */
  it('counts what the list shows, everywhere the number appears', async () => {
    const listed = ids2(await searchAwards(tx(), await scope(['youth'])));
    const facets = await facetsFor(tx(), await scope(['youth']), NO_FILTERS);
    const funders = await funderSummaries(tx(), await scope(['youth']), NO_FILTERS);

    expect(facets.total).toBe(listed.length);
    expect(funders.reduce((sum, funder) => sum + funder.matching, 0)).toBe(listed.length);
    // And the excluded row is excluded from the funder's examples too, which
    // is the one place a dropped grant could still surface.
    const examples = funders.flatMap((funder) => funder.examples.map((award) => award.id));
    expect(examples).not.toContain('aw_name');
  });

  it('never drops the best match, whatever the floor works out to', async () => {
    // A floor expressed as a fraction of the best match cannot exclude the
    // best match. Worth pinning: a floor that could empty a search which had
    // results would be worse than no floor.
    for (const term of ['youth', 'chapel', 'devon', 'skills', 'roof']) {
      const { awards } = await searchAwards(tx(), await scope([term]));
      expect(awards.length, `"${term}" matched nothing`).toBeGreaterThan(0);
    }
  });

  /**
   * A PLACE NAME HAS TO REACH THE PLACE.
   *
   * The floor was one floor for the whole query, and this is what that cost.
   * A county appears in the region field and nowhere else, so 0020 weights it
   * D; a work word reaches A in a title. One floor for "youth skills
   * somerset" was therefore set by the best youth-skills title, and every
   * Somerset grant fell under it.
   *
   * Measured on a 468-grant corpus before this was fixed: "youth skills" and
   * "youth skills somerset" returned the SAME thirty rows, and the place chips
   * offered Fife and Birmingham and no Somerset — because the chip counts come
   * from the same predicate. A Somerset CIC typing their own county got an
   * answer with nothing from their county in it and no route back to one.
   *
   * Each term has its own floor now, and a grant counts when it clears any one
   * of them.
   */
  it('reaches the county when a county is one of the words', async () => {
    const withPlace = ids((await searchAwards(tx(), await scope(['youth', 'somerset']))).awards);
    const without = ids((await searchAwards(tx(), await scope(['youth']))).awards);
    // The bell tower is in Somerset and about nothing else in the query.
    expect(without).not.toContain('aw_place');
    expect(withPlace).toContain('aw_place');
    // And adding the county did not cost us the youth grants.
    expect(withPlace).toContain('aw_best');
    // The recipient-name-only match stays out: it is not in Somerset and it
    // still loses on the word "youth".
    expect(withPlace).not.toContain('aw_name');
  });

  it('counts the county grants too, everywhere the number appears', async () => {
    const listed = ids2(await searchAwards(tx(), await scope(['youth', 'somerset'])));
    const facets = await facetsFor(tx(), await scope(['youth', 'somerset']), NO_FILTERS);
    const funders = await funderSummaries(tx(), await scope(['youth', 'somerset']), NO_FILTERS);
    expect(facets.total).toBe(listed.length);
    expect(funders.reduce((sum, funder) => sum + funder.matching, 0)).toBe(listed.length);
    // The chip a person would reach for is offered, which it was not before.
    expect(facets.place.map((option) => option.value)).toContain('Somerset');
  });

  /**
   * A COMMON WORD MUST NOT CARRY THE RESULT.
   *
   * The fault a user reported: "community tree nursery somerset" returned 218
   * of 464 grants — 47% of everything held — and 218 is exactly the number
   * matching `community` on its own. One word, the least informative one,
   * was the entire result, and the thing being looked for was seventh in it.
   *
   * Both rows below have "community" in their title. Only one is about trees.
   * The word `tree` is rare in this fixture and `community` is not, so the
   * tree row scores far higher — and the other falls under the floor.
   */
  it('does not let the commonest word carry the result', async () => {
    await harness.db.exec(`
      INSERT INTO funder_awards
        (id, funder_id, recipient_name, amount_gbp, awarded_on, region, tags,
         source_dataset_id, title, description)
      VALUES
        ('aw_tree', 'funder_360g_GB-CHC-1', 'Parish Trust', 8000, '2025-06-01',
         'Devon', ARRAY['Environment'], 'ds_x', 'Community tree nursery',
         'Growing native trees from seed with volunteers'),
        ('aw_comm1', 'funder_360g_GB-CHC-1', 'Hall Trust', 8000, '2025-06-02',
         'Devon', ARRAY['Community buildings'], 'ds_x', 'Community hall roof',
         'Community use of a village hall');
      -- Enough of them to make "community" A COMMON WORD, which is the whole
      -- premise. Eight more, because inverse document frequency is a fact
      -- about the corpus: with three community grants in nine the word still
      -- narrows something and the row rightly survives. A fixture testing a
      -- common word has to contain a common word.
      INSERT INTO funder_awards
        (id, funder_id, recipient_name, amount_gbp, awarded_on, region, tags,
         source_dataset_id, title, description)
      SELECT 'aw_comm_' || i, 'funder_360g_GB-CHC-1', 'Community Group ' || i, 8000,
             '2025-06-04', 'Devon', ARRAY['Community buildings'], 'ds_x',
             'Community centre project ' || i, 'A community project'
        FROM generate_series(1, 8) AS g(i);
    `);
    const shown = ids2(await searchAwards(tx(), await scope(['community', 'tree', 'nursery'])));
    expect(shown[0]).toBe('aw_tree');
    // And the ten grants whose only tie to the query is the commonest word in
    // it are not counted as matches at all.
    expect(shown.filter((id) => id.startsWith('aw_comm'))).toEqual([]);
  });

  /**
   * The score the ordering uses is the score the count used.
   *
   * It was not: the list came back ordered by `ts_rank` over the whole query
   * while the in-memory ranker re-sorted it by counting fields, so the page's
   * order and the page's number came from two different opinions of relevance.
   * The database computes it once now and hands it out.
   */
  it('reports how well each grant matched, highest first', async () => {
    const { awards } = await searchAwards(tx(), await scope(['youth', 'skills']));
    const scores = awards.map((a) => a.textScore);
    expect(scores.every((s) => typeof s === 'number' && s > 0 && s <= 1)).toBe(true);
    expect(scores).toEqual([...scores].toSorted((a, b) => (b ?? 0) - (a ?? 0)));
  });

  it('says how many grants each word matched, including none at all', async () => {
    const facets = await facetsFor(tx(), await scope(['youth', 'unicorn']), NO_FILTERS);
    expect(facets.terms).toEqual([
      { term: 'youth', matches: expect.any(Number) },
      { term: 'unicorn', matches: 0 },
    ]);
    expect(facets.terms.find((t) => t.term === 'youth')?.matches).toBeGreaterThan(0);
    // A word nobody has used must not empty the search either: it contributes
    // nothing to the score and nothing to the achievable total.
    expect((await searchAwards(tx(), await scope(['youth', 'unicorn']))).awards.length).toBeGreaterThan(0);
  });

  it('keeps a match that is only a region, when nothing beat it', async () => {
    // The case a structural rule would have broken. "Devon" appears in no
    // title and no description — only in the region, which 0020 weights at D
    // alongside the recipient's name. If the floor were a fixed rank, or a
    // rule against counting D matches, this search would return nothing.
    //
    // It is relative to the BEST match for the same words, so when every
    // match is a region match the best one is too and they all clear it.
    const { awards } = await searchAwards(tx(), await scope(['devon']));
    expect(ids(awards)).toEqual(['aw_3', 'aw_best', 'aw_name']);
  });
});

describe('a filter that leaves nothing', () => {
  /**
   * The bug this pins: a chosen option counts zero, `keep` dropped every
   * zero, and so a filter was ACTIVE AND INVISIBLE at the same time. The
   * header went on saying "narrowed by 1 filter — tap a filter again to
   * remove it" over a row with nothing in it to tap, and the empty-result
   * card said "remove one and the counts will show you what is there".
   * The only way out was Clear, which discards every choice rather than the
   * one that emptied the page.
   */
  it('still offers the chosen amount band when it counts zero', async () => {
    // Nothing in the fixture is over £500,000.
    const chosenBand: GrantFilters = { ...NO_FILTERS, bands: ['over500k'] };
    const facets = await facetsFor(tx(), await scope(['youth']), chosenBand);

    expect(facets.total).toBe(0);
    const chosen = facets.amount.find((option) => option.value === 'over500k');
    expect(chosen, 'the band the person picked vanished from the row').toBeDefined();
    expect(chosen?.count).toBe(0);
  });

  it('keeps it in scale order rather than pushing it to the end', async () => {
    // Amount bands read as a scale. A chosen zero belongs where it always was.
    const facets = await facetsFor(tx(), await scope(['youth']), {
      ...NO_FILTERS,
      bands: ['over500k'],
    });
    const shown = facets.amount.map((option) => option.value);
    expect(shown).toEqual([...shown].toSorted((a, b) => order(a) - order(b)));
  });

  it('still offers a chosen PLACE that matches nothing', async () => {
    // Harder than the bands: place options come from a GROUP BY over the
    // matching rows, so a place matching nothing is not in the result at all.
    // There is no zero to preserve — one has to be supplied.
    const facets = await facetsFor(tx(), await scope(['youth']), {
      ...NO_FILTERS,
      places: ['Orkney Islands'],
    });

    expect(facets.total).toBe(0);
    expect(facets.place.map((option) => option.value)).toContain('Orkney Islands');
  });

  it('still offers a chosen TOPIC that matches nothing', async () => {
    const facets = await facetsFor(tx(), await scope(['youth']), {
      ...NO_FILTERS,
      topics: ['Deep sea exploration'],
    });
    expect(facets.topic.map((option) => option.value)).toContain('Deep sea exploration');
  });

  it('still offers the chosen recency when it counts zero', async () => {
    // aw_1 is dated 2025-05-01 and the fixture clock is later, so "the last
    // year" excludes it.
    const facets = await facetsFor(tx(), await scope(['chapel']), { ...NO_FILTERS, since: '1y' });
    expect(facets.since.map((option) => option.value)).toContain('1y');
  });

  it('goes on hiding options nobody picked', async () => {
    // The point of the counts. Exempting the chosen option must not turn into
    // showing every dead end.
    const facets = await facetsFor(tx(), await scope(['chapel']), NO_FILTERS);
    expect(facets.amount.every((option) => option.count > 0)).toBe(true);
    expect(facets.place.every((option) => option.count > 0)).toBe(true);
  });
});

describe('the counts on the filters', () => {
  const words = ['somerset', 'leeds', 'devon', 'cornwall'];

  it('counts the whole match, not the page', async () => {
    const facets = await facetsFor(tx(), await scope(words), NO_FILTERS);
    expect(facets.total).toBe(4);
  });

  it('offers only options that would leave something', async () => {
    // Every chip has to be a real move. An option counted at zero is a trap,
    // so it is not offered at all.
    const facets = await facetsFor(tx(), await scope(words), NO_FILTERS);
    expect(facets.amount.every((option) => option.count > 0)).toBe(true);
    expect(facets.place.every((option) => option.count > 0)).toBe(true);
    expect(facets.topic.every((option) => option.count > 0)).toBe(true);
  });

  it('counts each amount band', async () => {
    const facets = await facetsFor(tx(), await scope(words), NO_FILTERS);
    const byId = new Map(facets.amount.map((option) => [option.value, option.count]));
    expect(byId.get('5k-25k')).toBe(3);
    expect(byId.get('25k-100k')).toBe(1);
    expect(byId.has('under5k')).toBe(false);
  });

  it('keeps the bands in scale order rather than by popularity', async () => {
    // They read as a scale. Sorting them by count would make them harder to
    // use, however "relevant" the ordering.
    const facets = await facetsFor(tx(), await scope(words), NO_FILTERS);
    expect(facets.amount.map((option) => option.value)).toEqual(['5k-25k', '25k-100k']);
  });

  it('counts an option as "what I would get if I picked this"', async () => {
    // THE property that makes facets usable. With a band already chosen, the
    // OTHER bands must still show what they would give — computed with the
    // place filter applied and the amount filter released. Counting with the
    // amount filter still on would show every unpicked band as zero and make
    // a live screen look like a dead end.
    const facets = await facetsFor(tx(), await scope(words), filters({ bands: ['5k-25k'] }));
    const byId = new Map(facets.amount.map((option) => [option.value, option.count]));
    expect(byId.get('5k-25k')).toBe(3);
    expect(byId.get('25k-100k')).toBe(1);
  });

  it('narrows the other dimensions when one is chosen', async () => {
    const facets = await facetsFor(tx(), await scope(words), filters({ places: ['Somerset'] }));
    // Only aw_1 is in Somerset, so the amount counts collapse to it.
    expect(facets.amount.map((option) => option.value)).toEqual(['5k-25k']);
    expect(facets.amount[0]?.count).toBe(1);
    expect(facets.total).toBe(1);
    // …but the places on offer still show what each would give.
    const places = new Map(facets.place.map((option) => [option.value, option.count]));
    expect(places.get('Devon')).toBe(1);
  });

  it('offers the places and topics actually present, with counts', async () => {
    const facets = await facetsFor(tx(), await scope(words), NO_FILTERS);
    expect(facets.place.map((option) => option.value).toSorted()).toEqual([
      'Cornwall',
      'Devon',
      'Somerset',
      'West Yorkshire',
    ]);
    expect(facets.topic.map((option) => option.value)).toContain('Young people');
  });

  it('offers nothing at all when nothing was searched for', async () => {
    // Nothing to build a scope from, so nothing to count. `searchCorpus` is
    // what turns that into the empty shape the page renders — asserted there
    // rather than here, because that is where the decision now lives.
    expect(await textSearch(tx(), [])).toBeNull();
  });
});

describe('grouping the matches by who gave them', () => {
  /**
   * A second funder, added HERE rather than to the shared fixture.
   *
   * Putting these five grants in the fixture broke thirteen existing tests at
   * once, because every facet count in this file is asserted against exactly
   * what the fixture holds. A test that needs more data should add it where it
   * needs it.
   */
  beforeEach(async () => {
    await harness.db.exec(`
    INSERT INTO funders (id, name, source_dataset_id)
    VALUES ('funder_360g_GB-CHC-2', 'The Second Trust', 'ds_x');

    -- Five grants, so this funder passes MIN_AWARDS_TO_CHARACTERISE and the
    -- quartiles mean something: 1k, 2k, 3k, 4k, 5k in Somerset.
    INSERT INTO funder_awards
      (id, funder_id, recipient_name, amount_gbp, awarded_on, region, tags,
       source_dataset_id, title, description)
    VALUES
      ('bw_1', 'funder_360g_GB-CHC-2', 'Somerset Youth A', 1000, '2026-01-05',
       'Somerset', ARRAY['Young people'], 'ds_x', 'Youth club', 'Somerset youth work'),
      ('bw_2', 'funder_360g_GB-CHC-2', 'Somerset Youth B', 2000, '2026-02-05',
       'Somerset', ARRAY['Young people'], 'ds_x', 'Youth club', 'Somerset youth work'),
      ('bw_3', 'funder_360g_GB-CHC-2', 'Somerset Youth C', 3000, '2026-03-05',
       'Somerset', ARRAY['Young people'], 'ds_x', 'Youth club', 'Somerset youth work'),
      ('bw_4', 'funder_360g_GB-CHC-2', 'Somerset Youth D', 4000, '2026-04-05',
       'Somerset', ARRAY['Young people'], 'ds_x', 'Youth club', 'Somerset youth work'),
      ('bw_5', 'funder_360g_GB-CHC-2', 'Somerset Youth E', 5000, '2026-05-05',
       'Somerset', ARRAY['Young people'], 'ds_x', 'Youth club', 'Somerset youth work');
    `);
  });

  it('summarises each funder over the MATCHING grants, not their whole history', async () => {
    // The Second Trust has five Somerset grants; one search term reaches only
    // some of them, and the figures must describe those.
    const summaries = await funderSummaries(tx(), await scope(['somerset']), NO_FILTERS);
    const second = summaries.find((s) => s.funderId === 'funder_360g_GB-CHC-2');
    expect(second?.matching).toBe(5);
    expect(second?.amounts.min).toBe(1000);
    expect(second?.amounts.max).toBe(5000);
    expect(second?.amounts.median).toBe(3000);
    // Interpolated quartiles, the same rule funder/behaviour.ts uses, so a
    // small sample does not report an actual award as a typical one.
    expect(second?.amounts.lowerQuartile).toBe(2000);
    expect(second?.amounts.upperQuartile).toBe(4000);
  });

  it('narrows the figures when the search narrows', async () => {
    // "wells" reaches only aw_1 of the first funder. Its median must then be
    // that grant, not the funder's usual.
    const summaries = await funderSummaries(tx(), await scope(['wells']), NO_FILTERS);
    const first = summaries.find((s) => s.funderId === 'funder_360g_GB-CHC-1');
    expect(first?.matching).toBe(1);
    expect(first?.amounts.median).toBe(12000);
  });

  it('reports when the funder last gave, and when they started', async () => {
    const summaries = await funderSummaries(tx(), await scope(['somerset']), NO_FILTERS);
    const second = summaries.find((s) => s.funderId === 'funder_360g_GB-CHC-2');
    expect(second?.lastAwardedOn).toBe('2026-05-05');
    expect(second?.firstAwardedOn).toBe('2026-01-05');
  });

  it('counts how many went to the applicant’s own area', async () => {
    const summaries = await funderSummaries(tx(), await scope(['somerset', 'devon']), NO_FILTERS, {
      region: 'Somerset',
    });
    const second = summaries.find((s) => s.funderId === 'funder_360g_GB-CHC-2');
    expect(second?.inYourRegion).toBe(5);
  });

  it('counts ZERO in your area when the applicant has no area', async () => {
    // The trap: an empty region becomes ILIKE '%%', which matches every row —
    // and would have told every applicant that every funder works where they
    // are.
    const summaries = await funderSummaries(tx(), await scope(['somerset']), NO_FILTERS, { region: '' });
    expect(summaries.every((s) => s.inYourRegion === 0)).toBe(true);
    const none = await funderSummaries(tx(), await scope(['somerset']), NO_FILTERS, { region: null });
    expect(none.every((s) => s.inYourRegion === 0)).toBe(true);
  });

  it('respects the filters, so a narrowed search groups the narrowed set', async () => {
    const summaries = await funderSummaries(tx(), await scope(['somerset']), {
      ...NO_FILTERS,
      bands: ['under5k'],
    });
    const second = summaries.find((s) => s.funderId === 'funder_360g_GB-CHC-2');
    // 1k–4k are under £5,000; the £5,000 grant is not.
    expect(second?.matching).toBe(4);
    expect(second?.amounts.max).toBe(4000);
  });

  it('carries a few of the matching grants for the funder’s own row', async () => {
    const summaries = await funderSummaries(tx(), await scope(['somerset']), NO_FILTERS);
    const second = summaries.find((s) => s.funderId === 'funder_360g_GB-CHC-2');
    expect(second?.examples).toHaveLength(3);
    // Most recent first: a funder's newest grants are the ones worth reading.
    expect(second?.examples.map((e) => e.id)).toEqual(['bw_5', 'bw_4', 'bw_3']);
  });

  /**
   * One word, not three, and the reason is worth writing down.
   *
   * This searched "somerset leeds devon" and asserted the second funder led,
   * because it had five matching grants to the first funder's three. Then the
   * scoring became idf-weighted, and on a nine-row fixture `somerset` matches
   * six of nine rows — so it is genuinely uninformative HERE, its idf is low,
   * and the second funder's five Somerset grants fell under the floor while
   * the first funder's lone Leeds and Devon rows (one match each, so rare and
   * highly weighted) sailed through. The ordering flipped, correctly for that
   * corpus.
   *
   * A fixture of nine rows cannot exercise inverse document frequency: every
   * word in it is common. So this asserts the thing it was always about —
   * repeated giving orders funders — with one word both funders match, and
   * leaves the idf behaviour to be measured where there is a corpus to measure
   * it against (`search-quality.probe.test.ts`).
   */
  it('puts repeated giving first, then recency', async () => {
    const summaries = await funderSummaries(tx(), await scope(['somerset']), NO_FILTERS);
    expect(summaries[0]?.funderId).toBe('funder_360g_GB-CHC-2');
    expect(summaries[0]?.matching).toBeGreaterThan(summaries[1]?.matching ?? 99);
  });

  it('names the label a funder uses most often', async () => {
    const summaries = await funderSummaries(tx(), await scope(['somerset']), NO_FILTERS);
    expect(summaries.find((s) => s.funderId === 'funder_360g_GB-CHC-2')?.commonTag).toBe(
      'Young people',
    );
  });

  it('returns nothing for an empty search rather than the whole corpus', async () => {
    expect(await textSearch(tx(), [])).toBeNull();
  });
});

describe('grouping the matches by who received them', () => {
  /**
   * Asked for: "search via similar CICs and see the past grants they've been
   * awarded." A peer's funder list is a template in a way a funder's grant
   * list is not.
   */
  beforeEach(async () => {
    await harness.db.exec(`
      -- Both, in this block. The second funder is created by the by-funder
      -- block's own setup, which does not run for this one: a test that needs
      -- more data adds it where it needs it.
      INSERT INTO funders (id, name, source_dataset_id)
      VALUES ('funder_360g_GB-CHC-2', 'The Second Trust', 'ds_x'),
             ('funder_360g_GB-CHC-3', 'The Third Trust', 'ds_x');

      INSERT INTO funder_awards
        (id, funder_id, recipient_name, amount_gbp, awarded_on, region, tags,
         source_dataset_id, title, description)
      VALUES
        -- One body, three spellings, three different funders. Grouping on the
        -- raw name would split it three ways and third every figure.
        ('rc_1', 'funder_360g_GB-CHC-1', 'Bridgetown Food Partnership', 10000,
         '2025-01-10', 'Somerset', ARRAY['Food poverty'], 'ds_x',
         'Food pantry', 'A weekly food pantry'),
        ('rc_2', 'funder_360g_GB-CHC-2', 'Bridgetown Food Partnership Ltd', 20000,
         '2025-06-10', 'Somerset', ARRAY['Food poverty'], 'ds_x',
         'Food pantry expansion', 'A weekly food pantry'),
        ('rc_3', 'funder_360g_GB-CHC-3', 'Bridgetown Food Partnership C.I.C.', 30000,
         '2026-02-10', 'Somerset', ARRAY['Homelessness'], 'ds_x',
         'Food pantry staffing', 'A weekly food pantry'),
        -- A smaller body, so the ordering has something to order.
        ('rc_4', 'funder_360g_GB-CHC-1', 'Moorside Larder', 4000,
         '2025-03-10', 'Devon', ARRAY['Food poverty'], 'ds_x',
         'Food pantry pilot', 'A weekly food pantry');
    `);
  });

  it('gathers one organisation’s grants under one row, however it is spelt', async () => {
    const rows = await recipientSummaries(tx(), await scope(['pantry']), NO_FILTERS);
    const bridgetown = rows.find((r) => r.name.startsWith('Bridgetown'));
    expect(bridgetown?.matching).toBe(3);
    expect(bridgetown?.totalGbp).toBe(60_000);
    // Three funders, which is the number a peer's history is actually worth
    // reading for.
    expect(bridgetown?.funders).toBe(3);
    expect(bridgetown?.funderNames.toSorted()).toEqual([
      'The Second Trust', 'The Test Trust', 'The Third Trust',
    ]);
  });

  it('shows the spelling they use, not the normalised key', async () => {
    const rows = await recipientSummaries(tx(), await scope(['pantry']), NO_FILTERS);
    const bridgetown = rows.find((r) => r.key.includes('bridgetown'));
    expect(bridgetown?.key).toBe('bridgetown food partnership');
    expect(bridgetown?.name).toMatch(/^Bridgetown Food Partnership/u);
  });

  it('reports what they raised, their largest and their typical grant', async () => {
    const rows = await recipientSummaries(tx(), await scope(['pantry']), NO_FILTERS);
    const bridgetown = rows.find((r) => r.name.startsWith('Bridgetown'));
    expect(bridgetown?.largestGbp).toBe(30_000);
    expect(bridgetown?.medianGbp).toBe(20_000);
    expect(bridgetown?.firstAwardedOn).toBe('2025-01-10');
    expect(bridgetown?.lastAwardedOn).toBe('2026-02-10');
    expect(bridgetown?.regions).toEqual(['Somerset']);
    expect(bridgetown?.commonTag).toBe('Food poverty');
  });

  it('puts the organisation that raised the most first', async () => {
    const rows = await recipientSummaries(tx(), await scope(['pantry']), NO_FILTERS);
    expect(rows[0]?.name).toMatch(/^Bridgetown/u);
    expect(rows.at(-1)?.name).toBe('Moorside Larder');
  });

  it('describes the MATCHING grants, not their whole history', async () => {
    // "Food pantry staffing" is the only one mentioning staffing, so this
    // organisation's row must describe that grant alone — the same rule the
    // by-funder view follows, and the reason both say "matching".
    const rows = await recipientSummaries(tx(), await scope(['staffing']), NO_FILTERS);
    const bridgetown = rows.find((r) => r.name.startsWith('Bridgetown'));
    expect(bridgetown?.matching).toBe(1);
    expect(bridgetown?.totalGbp).toBe(30_000);
    expect(bridgetown?.funders).toBe(1);
  });

  it('respects the filters, so a narrowed search groups the narrowed set', async () => {
    const rows = await recipientSummaries(
      tx(),
      await scope(['pantry']),
      filters({ places: ['Somerset'] }),
    );
    expect(rows.map((r) => r.name.slice(0, 10))).toEqual(['Bridgetown']);
  });

  it('leaves out a grant with no recipient named', async () => {
    await harness.db.exec(`
      INSERT INTO funder_awards
        (id, funder_id, recipient_name, amount_gbp, awarded_on, region, tags,
         source_dataset_id, title, description)
      VALUES ('rc_anon', 'funder_360g_GB-CHC-1', NULL, 9000, '2025-04-10',
              'Kent', ARRAY['Food poverty'], 'ds_x', 'Food pantry grant',
              'A weekly food pantry');
    `);
    const rows = await recipientSummaries(tx(), await scope(['pantry']), NO_FILTERS);
    // A row headed by nothing is not an organisation anybody can look up.
    expect(rows.every((r) => r.name.trim() !== '')).toBe(true);
    expect(rows.reduce((n, r) => n + r.matching, 0)).toBe(4);
  });
});

describe('ordering the peers by fit rather than by size', () => {
  /**
   * A walk found this on a screen headed "organisations like yours": a
   * Somerset CIC asking for £18,000 was led by a body that had raised
   * £2,861,780, "typically £487,710". Ordering by total raised orders by SIZE,
   * which is the opposite of the question — and the figure beside the name
   * was forty times their ask, presented as the typical grant of an
   * organisation like them.
   */
  beforeEach(async () => {
    await harness.db.exec(`
      INSERT INTO funders (id, name, source_dataset_id)
      VALUES ('funder_360g_GB-CHC-9', 'The Ninth Trust', 'ds_x');

      INSERT INTO funder_awards
        (id, funder_id, recipient_name, amount_gbp, awarded_on, region, tags,
         source_dataset_id, title, description)
      VALUES
        -- Raised far the most, and nothing like this applicant's size.
        ('big_1', 'funder_360g_GB-CHC-9', 'National Woodland Trust', 900000,
         '2025-05-01', 'Highland', ARRAY['Environment'], 'ds_x',
         'Tree nursery programme', 'Growing native trees'),
        ('big_2', 'funder_360g_GB-CHC-9', 'National Woodland Trust', 800000,
         '2026-05-01', 'Highland', ARRAY['Environment'], 'ds_x',
         'Tree nursery programme', 'Growing native trees'),
        -- Their size, and on their doorstep.
        ('peer_1', 'funder_360g_GB-CHC-9', 'Wells Tree Group', 18500,
         '2025-06-01', 'Somerset', ARRAY['Environment'], 'ds_x',
         'Tree nursery', 'Growing native trees'),
        -- Their size, elsewhere.
        ('peer_2', 'funder_360g_GB-CHC-9', 'Kendal Tree Group', 17500,
         '2025-07-01', 'Cumbria', ARRAY['Environment'], 'ds_x',
         'Tree nursery', 'Growing native trees');
    `);
  });

  const ASK = { amountSoughtGbp: 18_000, region: 'Somerset' };

  it('puts an organisation of the applicant’s size above one that raised more', async () => {
    const rows = await recipientSummaries(tx(), await scope(['tree', 'nursery']), NO_FILTERS, ASK);
    const names = rows.map((r) => r.name);
    expect(names.indexOf('Wells Tree Group')).toBeLessThan(
      names.indexOf('National Woodland Trust'),
    );
    // And the big one is still there, last, rather than hidden.
    expect(names).toContain('National Woodland Trust');
  });

  it('prefers their own area between two of the same size', async () => {
    const rows = await recipientSummaries(tx(), await scope(['tree', 'nursery']), NO_FILTERS, ASK);
    const names = rows.map((r) => r.name);
    expect(names.indexOf('Wells Tree Group')).toBeLessThan(names.indexOf('Kendal Tree Group'));
  });

  it('says which band each one is in, so the ordering can be checked', async () => {
    const rows = await recipientSummaries(tx(), await scope(['tree', 'nursery']), NO_FILTERS, ASK);
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get('Wells Tree Group')?.sizeBand).toBe(0);
    expect(byName.get('National Woodland Trust')?.sizeBand).toBe(2);
    expect(byName.get('Wells Tree Group')?.inYourRegion).toBe(1);
    expect(byName.get('Kendal Tree Group')?.inYourRegion).toBe(0);
  });

  it('falls back to repeat funding when the applicant has named no ask', async () => {
    // No ask means no bands, so there is nothing to be close to: the most
    // repeatedly funded comes first, which is the next best evidence.
    const rows = await recipientSummaries(tx(), await scope(['tree', 'nursery']), NO_FILTERS, {
      region: 'Somerset',
    });
    expect(rows[0]?.name).toBe('National Woodland Trust');
    expect(rows[0]?.sizeBand).toBeNull();
    expect(rows[0]?.matching).toBe(2);
  });

  it('counts nobody as local when the applicant has no area', async () => {
    // `ILIKE '%%'` matches every row, which would tell every applicant that
    // every peer is on their doorstep.
    const rows = await recipientSummaries(tx(), await scope(['tree', 'nursery']), NO_FILTERS, {
      amountSoughtGbp: 18_000,
    });
    expect(rows.every((r) => r.inYourRegion === 0)).toBe(true);
  });
});
