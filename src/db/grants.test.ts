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

import { corpusSize, recentAwards, searchAwards } from './grants.js';
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
    const { awards, capped } = await searchAwards(tx(), ['somerset', 'leeds', 'devon'], 2);
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
