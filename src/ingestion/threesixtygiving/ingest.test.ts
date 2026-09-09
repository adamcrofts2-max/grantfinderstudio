/**
 * One funder, ingested end to end, against the real schema and a fake API.
 *
 * The live API cannot be reached from the build environment, so this covers
 * everything between the HTTP boundary and the database. `connector.test.ts`
 * covers the fetching; `http.test.ts` covers the wire.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ingestFunder, buildDataset, datasetIdFor, type IngestRequest } from './ingest.js';
import { IngestionError, type HttpClient } from './connector.js';
import { readFunderHoldings } from '../../db/awards.js';
import { loadAllFunderAwards } from '../../db/queries.js';
import { createTestDatabase, type TestDatabase } from '../../db/testing/harness.js';
import type { Queryable } from '../../db/client.js';

let harness: TestDatabase;

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
});

afterEach(async () => {
  await harness.close();
});

/** The harness has one connection; run "transactions" straight against it. */
const runInTransaction = async <T>(fn: (tx: Queryable) => Promise<T>): Promise<T> =>
  fn(harness.db as unknown as Queryable);

const request: IngestRequest = {
  orgId: 'GB-CHC-1164883',
  funderName: 'A Community Foundation',
  website: 'https://example.org',
  jurisdiction: 'england',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'Grant data © A Community Foundation, via 360Giving',
  publisher: 'A Community Foundation',
};

function grant(over: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    title: 'A grant',
    currency: 'GBP',
    amountAwarded: 9000,
    awardDate: '2025-06-01T00:00:00+00:00',
    recipientOrganization: [{ id: 'GB-COH-1', name: 'A Recipient CIC' }],
    classifications: [{ title: 'Children and young people' }],
    beneficiaryLocation: [{ name: 'Somerset', countryCode: 'GB' }],
    ...over,
  };
}

/** An API that serves fixed pages and records what was asked for. */
function fakeApi(pages: unknown[]): HttpClient & { urls: string[] } {
  const urls: string[] = [];
  let call = 0;
  return {
    urls,
    async getJson(url: string) {
      urls.push(url);
      const page = pages[call] ?? { count: 0, next: null, results: [] };
      call += 1;
      return page;
    },
  };
}

describe('the dataset', () => {
  it('has a stable id per publisher, so a re-ingest updates one row', () => {
    expect(datasetIdFor('GB-CHC-1')).toBe(datasetIdFor(' GB-CHC-1 '));
  });

  it('carries the licence and attribution it was given', () => {
    const dataset = buildDataset(request, '2026-09-09T00:00:00.000Z');
    expect(dataset.licence).toBe('CC BY 4.0');
    expect(dataset.attribution).toContain('360Giving');
    expect(dataset.retrievedAt).toBe('2026-09-09T00:00:00.000Z');
  });
});

describe('ingesting one funder', () => {
  it('writes the awards where the prospect engine reads them', async () => {
    const api = fakeApi([
      { count: 2, next: null, results: [grant(), grant({ id: 'grant-2', amountAwarded: 15_000 })] },
    ]);
    const outcome = await ingestFunder(api, request, runInTransaction);

    expect(outcome.awardsWritten).toBe(2);
    expect(outcome.rejected).toBe(0);
    const found = (await loadAllFunderAwards(harness.db as unknown as Queryable)).find(
      (f) => f.funderId === outcome.funderId,
    );
    expect(found?.funderName).toBe('A Community Foundation');
    expect(found?.awards).toHaveLength(2);
    expect(found?.awards[0]?.tags).toEqual(['Children and young people']);
  });

  it('asks the API for that funder’s grants', async () => {
    const api = fakeApi([{ count: 0, next: null, results: [] }]);
    await ingestFunder(api, request, runInTransaction);
    expect(api.urls[0]).toContain('org/GB-CHC-1164883/grants_made/');
  });

  it('records the licence against the data', async () => {
    const api = fakeApi([{ count: 1, next: null, results: [grant()] }]);
    const outcome = await ingestFunder(api, request, runInTransaction);
    const holding = (await readFunderHoldings(harness.db as unknown as Queryable)).find(
      (f) => f.id === outcome.funderId,
    );
    expect(holding?.licence).toBe('CC BY 4.0');
    expect(holding?.attribution).toContain('360Giving');
  });

  it('follows pagination', async () => {
    const api = fakeApi([
      { count: 2, next: 'https://api.threesixtygiving.org/api/v1/next-page/', results: [grant()] },
      { count: 2, next: null, results: [grant({ id: 'grant-2' })] },
    ]);
    const outcome = await ingestFunder(api, request, runInTransaction);
    expect(outcome.pagesFetched).toBe(2);
    expect(outcome.awardsWritten).toBe(2);
  });

  it('reports what it rejected, once per reason rather than once per record', async () => {
    // A publisher with two hundred euro grants should say "not GBP" once, not
    // two hundred times. Distinct currencies stay distinct, because that is
    // information; repeats of the same reason collapse, because that is noise.
    const euros = Array.from({ length: 200 }, (_, i) =>
      grant({ id: `eur-${i}`, currency: 'EUR' }),
    );
    const api = fakeApi([
      { count: 202, next: null, results: [grant(), ...euros, grant({ id: 'usd', currency: 'USD' })] },
    ]);
    const outcome = await ingestFunder(api, request, runInTransaction);
    expect(outcome.awardsWritten).toBe(1);
    expect(outcome.rejected).toBe(201);
    expect(outcome.rejectionReasons).toHaveLength(2);
    expect(outcome.rejectionReasons.join(' ')).toContain('EUR');
  });

  it('refuses without a licence, rather than guessing the common one', async () => {
    // Publishers choose their own, and some are share-alike. Assuming CC BY
    // would put the wrong licence on somebody else's data.
    const api = fakeApi([{ count: 0, next: null, results: [] }]);
    await expect(
      ingestFunder(api, { ...request, licence: '  ' }, runInTransaction),
    ).rejects.toThrow(IngestionError);
  });

  it('refuses without an attribution', async () => {
    const api = fakeApi([{ count: 0, next: null, results: [] }]);
    await expect(
      ingestFunder(api, { ...request, attribution: '' }, runInTransaction),
    ).rejects.toThrow(IngestionError);
  });

  it('refuses without an organisation id', async () => {
    const api = fakeApi([{ count: 0, next: null, results: [] }]);
    await expect(ingestFunder(api, { ...request, orgId: ' ' }, runInTransaction)).rejects.toThrow(
      /organisation id/,
    );
  });

  it('leaves the previous awards intact when the fetch fails', async () => {
    // The fetch happens before the transaction opens, so a publisher outage
    // cannot empty a funder we already hold.
    const good = fakeApi([{ count: 1, next: null, results: [grant()] }]);
    const outcome = await ingestFunder(good, request, runInTransaction);
    expect(outcome.awardsWritten).toBe(1);

    const broken: HttpClient = {
      async getJson() {
        throw new IngestionError('the publisher is down');
      },
    };
    await expect(ingestFunder(broken, request, runInTransaction)).rejects.toThrow();

    const found = (await loadAllFunderAwards(harness.db as unknown as Queryable)).find(
      (f) => f.funderId === outcome.funderId,
    );
    expect(found?.awards).toHaveLength(1);
  });

  it('re-ingesting updates in place rather than duplicating the funder', async () => {
    const api1 = fakeApi([{ count: 1, next: null, results: [grant()] }]);
    await ingestFunder(api1, request, runInTransaction);
    const api2 = fakeApi([
      { count: 2, next: null, results: [grant(), grant({ id: 'grant-2' })] },
    ]);
    await ingestFunder(api2, request, runInTransaction);

    const holdings = (await readFunderHoldings(harness.db as unknown as Queryable)).filter((f) =>
      f.id.includes('GB-CHC-1164883'),
    );
    expect(holdings).toHaveLength(1);
    expect(holdings[0]?.awardCount).toBe(2);
  });

  it('says when maxPages stopped it before the data ran out', async () => {
    const api = fakeApi([
      { count: 99, next: 'https://api.threesixtygiving.org/api/v1/p2/', results: [grant()] },
      { count: 99, next: 'https://api.threesixtygiving.org/api/v1/p3/', results: [grant({ id: 'g2' })] },
    ]);
    const outcome = await ingestFunder(api, request, runInTransaction, { maxPages: 2 });
    expect(outcome.truncated).toBe(true);
  });
});
