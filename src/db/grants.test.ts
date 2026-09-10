/**
 * Award search against the real schema.
 *
 * The filters are the product's answer to "who like us has been given money",
 * so each one is asserted separately: a filter that silently matched
 * everything would look like a working search and mislead every applicant who
 * used it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { awardRegions, awardTags, countAwards, searchAwards } from './grants.js';
import { NO_CRITERIA } from '../domain/grants/search.js';
import { createTestDatabase, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;
const tx = (): Queryable => harness.db as unknown as Queryable;

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
  await harness.db.exec(`
    INSERT INTO source_datasets (id, name, publisher, licence, licence_url, attribution, retrieved_at)
    VALUES ('ds', 'Test awards', 'A Funder', 'CC-BY-4.0',
            'https://creativecommons.org/licenses/by/4.0/',
            'Grant data © A Funder, via 360Giving', now());
    INSERT INTO funders (id, name, website, source_dataset_id)
    VALUES ('f1', 'The Somerset Trust', 'https://example.org/somerset', 'ds'),
           ('f2', 'The Gwynedd Fund', NULL, 'ds');
    INSERT INTO funder_awards
      (id, funder_id, recipient_name, amount_gbp, awarded_on, title, description, region, tags, source_dataset_id)
    VALUES
      ('a1', 'f1', 'Wells Youth Collective', 24000, '2025-06-01',
       'Green Skills Programme', 'Practical skills for young people', 'Somerset',
       ARRAY['Children and young people'], 'ds'),
      ('a2', 'f1', 'Mendip Repair Cafe', 6000, '2025-03-01',
       'Repair Cafe', 'Community repair workshops', 'Somerset', ARRAY['Environment'], 'ds'),
      ('a3', 'f2', 'Bangor Heritage Group', 180000, '2024-11-01',
       'Chapel Roof Appeal', 'Chapel roof restoration', 'Gwynedd', ARRAY['Heritage'], 'ds');
  `);
});

afterEach(async () => {
  await harness.close();
});

describe('searching awarded grants', () => {
  it('returns everything when nothing is filtered, newest first', async () => {
    const { awards, capped } = await searchAwards(tx(), NO_CRITERIA);
    expect(awards.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    expect(capped).toBe(false);
  });

  it('carries the funder and the licence line with every grant', async () => {
    // Attribution must travel with anything derived from an open dataset.
    const { awards } = await searchAwards(tx(), NO_CRITERIA);
    expect(awards[0]?.funderName).toBe('The Somerset Trust');
    expect(awards[0]?.funderWebsite).toBe('https://example.org/somerset');
    expect(awards[0]?.attribution).toContain('360Giving');
  });

  it('searches the recipient name', async () => {
    const { awards } = await searchAwards(tx(), { ...NO_CRITERIA, text: 'wells' });
    expect(awards.map((a) => a.id)).toEqual(['a1']);
  });

  it('searches the description, which is where the purpose lives', async () => {
    const { awards } = await searchAwards(tx(), { ...NO_CRITERIA, text: 'roof' });
    expect(awards.map((a) => a.id)).toEqual(['a3']);
  });

  it('searches the title, which is the publisher’s own label', async () => {
    // Neither title nor description was ever written by the real ingest, so
    // every text search against ingested data matched nothing and looked like
    // a working search.
    const { awards } = await searchAwards(tx(), { ...NO_CRITERIA, text: 'green skills' });
    expect(awards.map((a) => a.id)).toEqual(['a1']);
  });

  it('returns the title so a grant can be named, not just priced', async () => {
    const { awards } = await searchAwards(tx(), { ...NO_CRITERIA, text: 'repair' });
    expect(awards[0]?.title).toBe('Repair Cafe');
  });

  it('filters by region, case-insensitively', async () => {
    const { awards } = await searchAwards(tx(), { ...NO_CRITERIA, region: 'somerset' });
    expect(awards.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('filters by classification', async () => {
    const { awards } = await searchAwards(tx(), { ...NO_CRITERIA, tag: 'young people' });
    expect(awards.map((a) => a.id)).toEqual(['a1']);
  });

  it('filters by an amount band', async () => {
    const { awards } = await searchAwards(tx(), {
      ...NO_CRITERIA,
      minAmountGbp: 12_000,
      maxAmountGbp: 48_000,
    });
    expect(awards.map((a) => a.id)).toEqual(['a1']);
  });

  it('combines filters rather than widening on each one', async () => {
    const { awards } = await searchAwards(tx(), {
      ...NO_CRITERIA,
      region: 'Somerset',
      tag: 'Environment',
    });
    expect(awards.map((a) => a.id)).toEqual(['a2']);
  });

  it('says when the result was capped, rather than showing a silent slice', async () => {
    const { awards, capped } = await searchAwards(tx(), NO_CRITERIA, 2);
    expect(awards).toHaveLength(2);
    expect(capped).toBe(true);
  });

  it('counts what is held, so an empty result can say why it is empty', async () => {
    // "Nothing loaded on this deployment" and "your filters excluded
    // everything" look identical without this, and need opposite advice.
    expect(await countAwards(tx())).toBe(3);
  });

  it('offers the tags and regions actually present', async () => {
    expect(await awardTags(tx())).toEqual([
      'Children and young people',
      'Environment',
      'Heritage',
    ]);
    expect(await awardRegions(tx())).toEqual(['Gwynedd', 'Somerset']);
  });
});

describe('the tenant role', () => {
  it('can read awards, because they are open data and nobody’s own work', async () => {
    await harness.db.exec('SET ROLE app_user;');
    const { awards } = await searchAwards(tx(), NO_CRITERIA);
    expect(awards).toHaveLength(3);
  });
});
