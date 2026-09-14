/**
 * Assembling the corpus, against the real schema and a fake API.
 *
 * The properties tested here are the ones that decide whether an unattended
 * load is safe to leave running: it must stop at its deadline rather than at a
 * guessed funder count, it must not store data whose licence nobody stated, it
 * must survive one publisher failing, and it must never go round the same
 * funder for ever.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { advanceCorpus } from './corpus.js';
import type { HttpClient } from './connector.js';
import { readCorpusProgress, startCorpusLoad } from '../../db/corpus.js';
import { searchAwards } from '../../db/grants.js';
import { createTestDatabase, type TestDatabase } from '../../db/testing/harness.js';
import type { Queryable } from '../../db/client.js';

let harness: TestDatabase;

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
  await runInTransaction((tx) => startCorpusLoad(tx));
});

afterEach(async () => {
  await harness.close();
});

/** The harness has one connection; run "transactions" straight against it. */
const runInTransaction = async <T>(fn: (tx: Queryable) => Promise<T>): Promise<T> =>
  fn(harness.db as unknown as Queryable);

/**
 * What the LOAD put there, not what the harness seeded.
 *
 * The harness seeds a fictional funder and dataset so other tests can prove a
 * tenant cannot claim shared reference data. Counting everything made the
 * first version of these tests assert 4 where 3 was right, and read a seeded
 * licence as though the loader had written it — a test passing or failing for
 * a reason that has nothing to do with the thing under test.
 */
const loaded = async (): Promise<{ funders: number; awards: number }> => {
  const { rows } = await harness.db.query<{ funders: number; awards: number }>(
    `SELECT (SELECT count(*)::int FROM funders WHERE id LIKE 'funder_360g_%') AS funders,
            (SELECT count(*)::int FROM funder_awards
              WHERE funder_id LIKE 'funder_360g_%')                          AS awards`,
  );
  return { funders: rows[0]?.funders ?? 0, awards: rows[0]?.awards ?? 0 };
};

const LICENCE = {
  url: 'https://creativecommons.org/licenses/by/4.0/',
  name: 'Creative Commons Attribution 4.0',
};

const grantRow = (id: string, funderOrgId: string, over: Record<string, unknown> = {}) => ({
  grant_id: id,
  data: {
    id,
    title: 'Youth skills programme',
    description: 'Practical training for young people in Somerset',
    currency: 'GBP',
    amountAwarded: 12_000,
    awardDate: '2025-05-01',
    fundingOrganization: [{ id: funderOrgId, name: `Trust ${funderOrgId}` }],
    recipientOrganization: [{ id: 'GB-COH-1', name: 'Wells Youth Collective' }],
    beneficiaryLocation: [{ name: 'Somerset' }, { name: 'England' }],
    classifications: [{ title: 'Young people' }],
  },
  data_license: LICENCE,
  funders: [{ org_id: funderOrgId }],
  ...over,
});

interface FakeOptions {
  /** Funder ids the list serves, in order. */
  funders: string[];
  /** Funders whose grants state no licence. */
  unlicensed?: string[];
  /** Funders whose grant fetch throws. */
  broken?: string[];
  /** Report a `count`, or null to leave it out and force an empty page. */
  total?: number | null;
}

/** A 360Giving that serves exactly what a test needs, and records the asks. */
function fakeApi(options: FakeOptions): { http: HttpClient; asked: string[] } {
  const asked: string[] = [];
  const http: HttpClient = {
    async getJson(url: string): Promise<unknown> {
      asked.push(url);
      const parsed = new URL(url);

      if (parsed.pathname.endsWith('/org/funder/')) {
        const offset = Number(parsed.searchParams.get('offset') ?? '0');
        const limit = Number(parsed.searchParams.get('limit') ?? '50');
        const slice = options.funders.slice(offset, offset + limit);
        return {
          count: options.total === undefined ? options.funders.length : options.total,
          results: slice.map((orgId) => ({ org_id: orgId, name: `Trust ${orgId}` })),
        };
      }

      const match = /\/org\/([^/]+)\/grants_made\//u.exec(parsed.pathname);
      if (match) {
        const orgId = decodeURIComponent(match[1] ?? '');
        if (options.broken?.includes(orgId)) {
          throw new Error(`${orgId} is having a bad day`);
        }
        const row = options.unlicensed?.includes(orgId)
          ? grantRow(`${orgId}-1`, orgId, { data_license: null })
          : grantRow(`${orgId}-1`, orgId);
        return { count: 1, next: null, results: [row] };
      }

      throw new Error(`unexpected request: ${url}`);
    },
  };
  return { http, asked };
}

const BASE = 'https://api.example.test/api/v1/';

describe('walking the funder list', () => {
  it('loads every funder and their grants, then reports finished', async () => {
    const { http } = fakeApi({ funders: ['GB-CHC-1', 'GB-CHC-2', 'GB-CHC-3'] });

    const result = await advanceCorpus(http, runInTransaction, { baseUrl: BASE, pageSize: 2 });

    expect(result.walked).toBe(3);
    expect(result.awardsWritten).toBe(3);
    expect(result.finished).toBe(true);

    expect(await loaded()).toEqual({ funders: 3, awards: 3 });
  });

  it('makes the loaded grants searchable, which is the whole point', async () => {
    const { http } = fakeApi({ funders: ['GB-CHC-1'] });
    await advanceCorpus(http, runInTransaction, { baseUrl: BASE });

    const { awards } = await runInTransaction((tx) => searchAwards(tx, ['somerset']));
    expect(awards).toHaveLength(1);
    expect(awards[0]?.amountGbp).toBe(12_000);
    expect(awards[0]?.attribution).toContain('360Giving Data Standard');
  });

  it('carries on from where the last step stopped', async () => {
    const funders = ['GB-CHC-1', 'GB-CHC-2', 'GB-CHC-3', 'GB-CHC-4'];

    const first = await advanceCorpus(fakeApi({ funders }).http, runInTransaction, {
      baseUrl: BASE,
      maxFunders: 2,
    });
    expect(first.walked).toBe(2);
    expect(first.finished).toBe(false);

    const second = await advanceCorpus(fakeApi({ funders }).http, runInTransaction, {
      baseUrl: BASE,
      maxFunders: 2,
    });
    expect(second.walked).toBe(2);
    expect(second.finished).toBe(true);

    const progress = await runInTransaction((tx) => readCorpusProgress(tx));
    expect(progress.fundersDone).toBe(4);
    expect(progress.awardsWritten).toBe(4);
  });

  it('stops at its deadline rather than at a guessed funder count', async () => {
    // The bound that makes an unattended step safe: time, not a number chosen
    // against the slowest publisher in the list.
    let clock = 0;
    const { http } = fakeApi({ funders: ['a', 'b', 'c', 'd', 'e', 'f'] });

    const result = await advanceCorpus(http, runInTransaction, {
      baseUrl: BASE,
      deadlineMs: 100,
      // Each funder "takes" 40ms, so the third one is past the deadline.
      elapsed: () => {
        clock += 40;
        return clock;
      },
    });

    expect(result.walked).toBeGreaterThan(0);
    expect(result.walked).toBeLessThan(6);
    expect(result.finished).toBe(false);
  });

  it('never asks for the same funder twice in one walk', async () => {
    // The cursor advancing past a funder is what stops an endless loop. A
    // publisher who throws every time would otherwise block the load for ever.
    const { http, asked } = fakeApi({ funders: ['GB-CHC-1', 'GB-CHC-2'] });
    await advanceCorpus(http, runInTransaction, { baseUrl: BASE, pageSize: 1 });

    const grantAsks = asked.filter((url) => url.includes('/grants_made/'));
    expect(new Set(grantAsks).size).toBe(grantAsks.length);
  });
});

describe('the licence rule', () => {
  it('skips a funder whose grants state no licence, and counts it', async () => {
    const { http } = fakeApi({
      funders: ['GB-CHC-1', 'GB-CHC-2'],
      unlicensed: ['GB-CHC-2'],
    });

    const result = await advanceCorpus(http, runInTransaction, { baseUrl: BASE });

    expect(result.unlicensed).toBe(1);
    expect(result.awardsWritten).toBe(1);

    // Nothing unlicensed reached the database. This is the property, not the
    // counter: refusing unlicensed data is a rule, and only who states the
    // licence changed when the corpus started loading itself.
    expect(await loaded()).toEqual({ funders: 1, awards: 1 });
  });

  it('records the publisher’s own licence against their grants', async () => {
    const { http } = fakeApi({ funders: ['GB-CHC-1'] });
    await advanceCorpus(http, runInTransaction, { baseUrl: BASE });

    const { rows } = await harness.db.query<{ licence: string; licence_url: string }>(
      "SELECT licence, licence_url FROM source_datasets WHERE id = 'ds_360g_GB-CHC-1'",
    );
    expect(rows[0]?.licence).toBe(LICENCE.name);
    expect(rows[0]?.licence_url).toBe(LICENCE.url);
  });
});

describe('when something goes wrong', () => {
  it('keeps the funders it finished when one publisher fails', async () => {
    const { http } = fakeApi({
      funders: ['GB-CHC-1', 'GB-CHC-2', 'GB-CHC-3'],
      broken: ['GB-CHC-2'],
    });

    const result = await advanceCorpus(http, runInTransaction, { baseUrl: BASE });

    expect(result.error).toContain('GB-CHC-2');
    // The two good ones are in, and the walk went past the bad one.
    expect((await loaded()).awards).toBe(2);
    expect(result.finished).toBe(true);
  });

  it('leaves the cursor unmoved when the funder LIST itself fails', async () => {
    // Different from one publisher failing: there is nothing to walk, so the
    // next step must start where this one did rather than skipping a page.
    const http: HttpClient = {
      async getJson(): Promise<unknown> {
        throw new Error('the list returned 503');
      },
    };

    const result = await advanceCorpus(http, runInTransaction, { baseUrl: BASE });
    expect(result.walked).toBe(0);
    expect(result.error).toContain('503');

    const progress = await runInTransaction((tx) => readCorpusProgress(tx));
    expect(progress.cursor).toBe(0);
    expect(progress.finishedAt).toBeNull();
  });

  it('clears a recorded error once a step succeeds', async () => {
    const broken: HttpClient = {
      async getJson(): Promise<unknown> {
        throw new Error('the list returned 503');
      },
    };
    await advanceCorpus(broken, runInTransaction, { baseUrl: BASE });
    expect((await runInTransaction((tx) => readCorpusProgress(tx))).lastError).not.toBeNull();

    await advanceCorpus(fakeApi({ funders: ['GB-CHC-1'] }).http, runInTransaction, {
      baseUrl: BASE,
    });
    expect((await runInTransaction((tx) => readCorpusProgress(tx))).lastError).toBeNull();
  });
});

describe('starting again', () => {
  it('does not empty the corpus, so the search keeps working throughout', async () => {
    // A restart that deleted first would leave an applicant with nothing to
    // search for however long the walk takes.
    await advanceCorpus(fakeApi({ funders: ['GB-CHC-1'] }).http, runInTransaction, {
      baseUrl: BASE,
    });
    expect((await loaded()).awards).toBe(1);

    await runInTransaction((tx) => startCorpusLoad(tx));

    expect((await loaded()).awards).toBe(1);
    const progress = await runInTransaction((tx) => readCorpusProgress(tx));
    expect(progress.cursor).toBe(0);
    expect(progress.awardsWritten).toBe(0);
  });
});
