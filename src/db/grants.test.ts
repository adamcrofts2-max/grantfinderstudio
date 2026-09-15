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

import { corpusSize, facetsFor, recentAwards, searchAwards } from './grants.js';
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

const ids = (awards: readonly { id: string }[]): string[] => awards.map((a) => a.id).toSorted();

describe('searching what is held', () => {
  it('matches a word in the description', async () => {
    const { awards } = await searchAwards(tx(), ['training']);
    expect(ids(awards)).toEqual(['aw_1']);
  });

  it('matches a recipient, a title, a region and a tag', async () => {
    expect(ids((await searchAwards(tx(), ['leeds'])).awards)).toEqual(['aw_2']);
    expect(ids((await searchAwards(tx(), ['chapel'])).awards)).toEqual(['aw_3']);
    expect(ids((await searchAwards(tx(), ['devon'])).awards)).toEqual(['aw_3']);
    expect(ids((await searchAwards(tx(), ['heritage'])).awards)).toEqual(['aw_3']);
  });

  it('matches ANY term, not all of them', async () => {
    // Somebody types "youth skills Somerset" and means "anything like this".
    // A grant described as "young people, employment training" in Wells is
    // exactly what they wanted and shares not one whole word with the query,
    // so requiring every term would return nothing and look like an empty
    // corpus. Ranking is what puts the closest first, elsewhere.
    const { awards } = await searchAwards(tx(), ['chapel', 'leeds']);
    expect(ids(awards)).toEqual(['aw_2', 'aw_3']);
  });

  it('ignores case, because nobody types a funder’s capitals', async () => {
    expect(ids((await searchAwards(tx(), ['SOMERSET'])).awards)).toEqual(['aw_1']);
  });

  it('returns nothing for no terms rather than the whole corpus', async () => {
    // An empty query must not become "select everything": that is a slow
    // request and a screen of noise.
    expect((await searchAwards(tx(), [])).awards).toEqual([]);
    expect((await searchAwards(tx(), ['   '])).awards).toEqual([]);
  });

  it('carries the licence, so attribution travels with the row', async () => {
    const { awards } = await searchAwards(tx(), ['training']);
    expect(awards[0]?.attribution).toContain('360Giving Data Standard');
    expect(awards[0]?.funderName).toBe('The Test Trust');
    expect(awards[0]?.funderWebsite).toBe('https://example.org');
  });

  it('orders newest first', async () => {
    const { awards } = await searchAwards(tx(), ['somerset', 'leeds', 'devon']);
    expect(awards.map((a) => a.id)).toEqual(['aw_1', 'aw_2', 'aw_3']);
  });

  it('says when it capped, rather than quietly showing a slice', async () => {
    const { awards, capped } = await searchAwards(tx(), ['somerset', 'leeds', 'devon'], NO_FILTERS, 2);
    expect(awards).toHaveLength(2);
    expect(capped).toBe(true);
  });

  it('does not treat a percent sign as a wildcard', async () => {
    // `queryTerms` splits on everything that is not a letter or a digit, so a
    // term can never carry one — a whitelist rather than an escape step. This
    // asserts the boundary holds even if something bypasses the tokeniser.
    expect((await searchAwards(tx(), ['%'])).awards).toEqual([]);
  });
});

describe('a screen nobody has typed into', () => {
  it('shows the most recent awards, dateless ones last', async () => {
    const recent = await recentAwards(tx(), 10);
    expect(recent.map((a) => a.id)).toEqual(['aw_1', 'aw_2', 'aw_3', 'aw_4']);
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
    const { awards } = await searchAwards(tx(), ['training']);
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
      ['somerset', 'leeds', 'devon', 'cornwall'],
      filters({ bands: ['5k-25k'] }),
    );
    expect(ids(awards)).toEqual(['aw_1', 'aw_2', 'aw_4']);
  });

  it('treats several bands as "any of these"', async () => {
    const { awards } = await searchAwards(
      tx(),
      ['somerset', 'devon'],
      filters({ bands: ['5k-25k', '25k-100k'] }),
    );
    expect(ids(awards)).toEqual(['aw_1', 'aw_3']);
  });

  it('puts a band boundary in exactly one band', async () => {
    // £5,000 is the boundary between "under £5,000" and "£5,000–£25,000".
    // Inclusive lower, exclusive upper, so it belongs to the upper band and to
    // only one — a grant counted twice would make every total wrong.
    const under = await searchAwards(tx(), ['cornwall'], filters({ bands: ['under5k'] }));
    const over = await searchAwards(tx(), ['cornwall'], filters({ bands: ['5k-25k'] }));
    expect(ids(under.awards)).toEqual([]);
    expect(ids(over.awards)).toEqual(['aw_4']);
  });

  it('keeps only grants in the chosen place', async () => {
    const { awards } = await searchAwards(
      tx(),
      ['somerset', 'leeds', 'devon'],
      filters({ places: ['Devon'] }),
    );
    expect(ids(awards)).toEqual(['aw_3']);
  });

  it('matches a place loosely, because publishers write it differently', async () => {
    // "West Yorkshire" should be reachable from "yorkshire".
    const { awards } = await searchAwards(tx(), ['leeds'], filters({ places: ['yorkshire'] }));
    expect(ids(awards)).toEqual(['aw_2']);
  });

  it('matches a topic exactly, because the label came from the facet list', async () => {
    const exact = await searchAwards(tx(), ['somerset'], filters({ topics: ['Young people'] }));
    expect(ids(exact.awards)).toEqual(['aw_1']);
    // Not a substring: merging "Young people" with "Young people, rural"
    // behind somebody's back would make the count they clicked a lie.
    const loose = await searchAwards(tx(), ['somerset'], filters({ topics: ['Young'] }));
    expect(ids(loose.awards)).toEqual([]);
  });

  it('combines dimensions with AND', async () => {
    const { awards } = await searchAwards(
      tx(),
      ['somerset', 'leeds', 'devon'],
      filters({ bands: ['5k-25k'], places: ['Somerset'] }),
    );
    expect(ids(awards)).toEqual(['aw_1']);
  });

  it('cannot be tricked by a wildcard in a place', async () => {
    expect((await searchAwards(tx(), ['somerset'], filters({ places: ['%'] }))).awards).toEqual([]);
  });
});

describe('the counts on the filters', () => {
  const terms = ['somerset', 'leeds', 'devon', 'cornwall'];

  it('counts the whole match, not the page', async () => {
    const facets = await facetsFor(tx(), terms, NO_FILTERS);
    expect(facets.total).toBe(4);
  });

  it('offers only options that would leave something', async () => {
    // Every chip has to be a real move. An option counted at zero is a trap,
    // so it is not offered at all.
    const facets = await facetsFor(tx(), terms, NO_FILTERS);
    expect(facets.amount.every((option) => option.count > 0)).toBe(true);
    expect(facets.place.every((option) => option.count > 0)).toBe(true);
    expect(facets.topic.every((option) => option.count > 0)).toBe(true);
  });

  it('counts each amount band', async () => {
    const facets = await facetsFor(tx(), terms, NO_FILTERS);
    const byId = new Map(facets.amount.map((option) => [option.value, option.count]));
    expect(byId.get('5k-25k')).toBe(3);
    expect(byId.get('25k-100k')).toBe(1);
    expect(byId.has('under5k')).toBe(false);
  });

  it('keeps the bands in scale order rather than by popularity', async () => {
    // They read as a scale. Sorting them by count would make them harder to
    // use, however "relevant" the ordering.
    const facets = await facetsFor(tx(), terms, NO_FILTERS);
    expect(facets.amount.map((option) => option.value)).toEqual(['5k-25k', '25k-100k']);
  });

  it('counts an option as "what I would get if I picked this"', async () => {
    // THE property that makes facets usable. With a band already chosen, the
    // OTHER bands must still show what they would give — computed with the
    // place filter applied and the amount filter released. Counting with the
    // amount filter still on would show every unpicked band as zero and make
    // a live screen look like a dead end.
    const facets = await facetsFor(tx(), terms, filters({ bands: ['5k-25k'] }));
    const byId = new Map(facets.amount.map((option) => [option.value, option.count]));
    expect(byId.get('5k-25k')).toBe(3);
    expect(byId.get('25k-100k')).toBe(1);
  });

  it('narrows the other dimensions when one is chosen', async () => {
    const facets = await facetsFor(tx(), terms, filters({ places: ['Somerset'] }));
    // Only aw_1 is in Somerset, so the amount counts collapse to it.
    expect(facets.amount.map((option) => option.value)).toEqual(['5k-25k']);
    expect(facets.amount[0]?.count).toBe(1);
    expect(facets.total).toBe(1);
    // …but the places on offer still show what each would give.
    const places = new Map(facets.place.map((option) => [option.value, option.count]));
    expect(places.get('Devon')).toBe(1);
  });

  it('offers the places and topics actually present, with counts', async () => {
    const facets = await facetsFor(tx(), terms, NO_FILTERS);
    expect(facets.place.map((option) => option.value).toSorted()).toEqual([
      'Cornwall',
      'Devon',
      'Somerset',
      'West Yorkshire',
    ]);
    expect(facets.topic.map((option) => option.value)).toContain('Young people');
  });

  it('offers nothing at all when nothing was searched for', async () => {
    const facets = await facetsFor(tx(), [], NO_FILTERS);
    expect(facets).toEqual({ amount: [], since: [], place: [], topic: [], total: 0 });
  });
});
