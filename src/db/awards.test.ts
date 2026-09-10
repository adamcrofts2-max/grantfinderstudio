/**
 * Ingesting awards, against the real schema.
 *
 * The behaviour worth guarding hardest is the re-ingest: it has to be able to
 * REMOVE an award, and it must never touch another funder's history.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deleteFunder,
  funderIdFor360Giving,
  readFunderHoldings,
  replaceFunderAwards,
  upsertFunder,
  upsertSourceDataset,
} from './awards.js';
import { loadAllFunderAwards } from './queries.js';
import { createTestDatabase, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';
import type { IngestedAward } from '../ingestion/threesixtygiving/normalise.js';
import type { SourceDataset } from '../ingestion/threesixtygiving/types.js';

let harness: TestDatabase;
const tx = (): Queryable => harness.db as unknown as Queryable;

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
});

afterEach(async () => {
  await harness.close();
});

const dataset: SourceDataset = {
  id: 'ds_360g_test',
  name: '360Giving — a publisher',
  publisher: 'A Publisher',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'Grant data © A Publisher, via 360Giving',
  retrievedAt: '2026-09-09T00:00:00.000Z',
};

const award = (over: Partial<IngestedAward> = {}): IngestedAward => ({
  id: 'g1',
  amountGbp: 9000,
  awardedOn: '2025-06-01',
  recipientName: 'A Recipient CIC',
  jurisdiction: 'england',
  region: 'Somerset',
  tags: ['Children and young people'],
  title: 'Green Skills Programme',
  description: 'Practical environmental skills for young people.',
  ...over,
});

async function seedFunder(id: string, name: string): Promise<void> {
  await upsertSourceDataset(tx(), dataset);
  await upsertFunder(tx(), {
    id,
    name,
    website: null,
    jurisdiction: 'england',
    sourceDatasetId: dataset.id,
  });
}

describe('the funder id', () => {
  it('is derived from the 360Giving org id, so a re-ingest updates one row', () => {
    // A generated id would create a second copy on every run and split the
    // award history in two — quietly halving every median.
    expect(funderIdFor360Giving('GB-CHC-1164883')).toBe(
      funderIdFor360Giving(' GB-CHC-1164883 '),
    );
  });
});

describe('writing a funder’s awards', () => {
  it('stores them where the prospect engine reads them', async () => {
    const id = funderIdFor360Giving('GB-CHC-1');
    await seedFunder(id, 'A Trust');
    const written = await replaceFunderAwards(
      tx(),
      id,
      [award({ id: 'g1' }), award({ id: 'g2', amountGbp: 15_000 })],
      dataset.id,
    );
    expect(written).toBe(2);

    const loaded = await loadAllFunderAwards(tx());
    const found = loaded.find((f) => f.funderId === id);
    expect(found?.awards).toHaveLength(2);
    expect(found?.awards.map((a) => a.amountGbp).toSorted((a, b) => a - b)).toEqual([
      9000, 15_000,
    ]);
    expect(found?.awards[0]?.tags).toEqual(['Children and young people']);
  });

  it('removes an award the publisher has withdrawn', async () => {
    // Upserting by id would leave the old row behind forever, still counting
    // towards the funder's median.
    const id = funderIdFor360Giving('GB-CHC-2');
    await seedFunder(id, 'A Trust');
    await replaceFunderAwards(tx(), id, [award({ id: 'g1' }), award({ id: 'g2' })], dataset.id);
    await replaceFunderAwards(tx(), id, [award({ id: 'g1' })], dataset.id);

    const found = (await loadAllFunderAwards(tx())).find((f) => f.funderId === id);
    expect(found?.awards).toHaveLength(1);
  });

  it('does not touch another funder while re-ingesting one', async () => {
    const a = funderIdFor360Giving('GB-CHC-A');
    const b = funderIdFor360Giving('GB-CHC-B');
    await seedFunder(a, 'Trust A');
    await seedFunder(b, 'Trust B');
    await replaceFunderAwards(tx(), a, [award({ id: 'a1' })], dataset.id);
    await replaceFunderAwards(tx(), b, [award({ id: 'b1' }), award({ id: 'b2' })], dataset.id);

    await replaceFunderAwards(tx(), a, [], dataset.id);

    const loaded = await loadAllFunderAwards(tx());
    expect(loaded.find((f) => f.funderId === a)?.awards).toHaveLength(0);
    expect(loaded.find((f) => f.funderId === b)?.awards).toHaveLength(2);
  });

  it('keeps two publishers apart when they reuse a grant identifier', async () => {
    // 360Giving ids are only unique within a publisher. An unnamespaced key
    // would silently drop one of the two.
    const a = funderIdFor360Giving('GB-CHC-A');
    const b = funderIdFor360Giving('GB-CHC-B');
    await seedFunder(a, 'Trust A');
    await seedFunder(b, 'Trust B');
    await replaceFunderAwards(tx(), a, [award({ id: 'shared-id' })], dataset.id);
    await replaceFunderAwards(tx(), b, [award({ id: 'shared-id' })], dataset.id);

    const loaded = await loadAllFunderAwards(tx());
    expect(loaded.find((f) => f.funderId === a)?.awards).toHaveLength(1);
    expect(loaded.find((f) => f.funderId === b)?.awards).toHaveLength(1);
  });

  it('is idempotent: the same ingest twice leaves the same rows', async () => {
    const id = funderIdFor360Giving('GB-CHC-3');
    await seedFunder(id, 'A Trust');
    const awards = [award({ id: 'g1' }), award({ id: 'g2' })];
    await replaceFunderAwards(tx(), id, awards, dataset.id);
    await replaceFunderAwards(tx(), id, awards, dataset.id);
    const found = (await loadAllFunderAwards(tx())).find((f) => f.funderId === id);
    expect(found?.awards).toHaveLength(2);
  });
});

describe('the funder row', () => {
  it('updates rather than duplicating on a second ingest', async () => {
    const id = funderIdFor360Giving('GB-CHC-4');
    await seedFunder(id, 'Old Name');
    await upsertFunder(tx(), {
      id,
      name: 'New Name',
      website: 'https://example.org',
      jurisdiction: null,
      sourceDatasetId: dataset.id,
    });
    const { rows } = await harness.db.query<{ name: string; website: string; jurisdiction: string }>(
      'SELECT name, website, jurisdiction FROM funders WHERE id = $1',
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('New Name');
    expect(rows[0]?.website).toBe('https://example.org');
    // Not overwritten with the null that arrived second.
    expect(rows[0]?.jurisdiction).toBe('england');
  });
});

describe('what has been ingested', () => {
  it('reports counts, recency and the licence it came under', async () => {
    const id = funderIdFor360Giving('GB-CHC-5');
    await seedFunder(id, 'A Trust');
    await replaceFunderAwards(
      tx(),
      id,
      [award({ id: 'g1', awardedOn: '2024-01-01' }), award({ id: 'g2', awardedOn: '2025-06-01' })],
      dataset.id,
    );
    const holding = (await readFunderHoldings(tx())).find((f) => f.id === id);
    expect(holding?.awardCount).toBe(2);
    expect(holding?.mostRecentAward).toBe('2025-06-01');
    expect(holding?.licence).toBe('CC BY 4.0');
    expect(holding?.attribution).toContain('360Giving');
  });

  it('includes a funder with no awards rather than hiding it', async () => {
    // A funder whose ingest returned nothing is a thing the operator needs to
    // see, not a row that quietly vanishes.
    const id = funderIdFor360Giving('GB-CHC-6');
    await seedFunder(id, 'An Empty Trust');
    const holding = (await readFunderHoldings(tx())).find((f) => f.id === id);
    expect(holding?.awardCount).toBe(0);
  });
});

describe('removing a funder', () => {
  it('takes their awards with them', async () => {
    const id = funderIdFor360Giving('GB-CHC-7');
    await seedFunder(id, 'A Trust');
    await replaceFunderAwards(tx(), id, [award()], dataset.id);
    expect(await deleteFunder(tx(), id)).toBe(true);
    const { rows } = await harness.db.query('SELECT id FROM funder_awards WHERE funder_id = $1', [id]);
    expect(rows).toEqual([]);
  });

  it('says so when there was nothing to remove', async () => {
    expect(await deleteFunder(tx(), 'funder_360g_nope')).toBe(false);
  });
});
