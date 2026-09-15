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
import { claimCorpusStep, readCorpusProgress, startCorpusLoad } from '../../db/corpus.js';
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
  /** Funders who publish more grants than one step will fetch. */
  enormous?: string[];
  /** Funders whose grants state no licence. */
  unlicensed?: string[];
  /** Funders whose grant fetch throws. */
  broken?: string[];
  /**
   * Funders who publish one recent grant and one from a decade ago.
   *
   * Which is what almost every real publisher looks like: their whole history
   * is on the API, because the API has no date filter to ask otherwise.
   */
  stale?: string[];
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
        if (options.stale?.includes(orgId)) {
          const recent = grantRow(`${orgId}-new`, orgId);
          const old = grantRow(`${orgId}-old`, orgId);
          old.data.awardDate = '2015-05-01';
          return { count: 2, next: null, results: [recent, old] };
        }
        if (options.enormous?.includes(orgId)) {
          // A `next` that never runs out, which is what a publisher with tens
          // of thousands of grants looks like from here.
          const page = Number(parsed.searchParams.get('offset') ?? '0');
          return {
            count: 999_999,
            next: `${BASE}org/${encodeURIComponent(orgId)}/grants_made/?offset=${page + 1}`,
            results: [grantRow(`${orgId}-${page}`, orgId)],
          };
        }
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

describe('the lease that lets this run itself', () => {
  /**
   * The load is triggered by ordinary page visits and by a route that needs no
   * secret, so this lease is the whole of the concurrency control AND the whole
   * of the abuse control. Every property below is load-bearing.
   */
  it('starts the load without anybody starting it', async () => {
    // The point of the whole change: a deployment nobody has configured, and
    // nobody has pressed anything on, still fills its record.
    await harness.db.exec('DELETE FROM corpus_load;');
    expect((await runInTransaction((tx) => readCorpusProgress(tx))).startedAt).toBeNull();

    expect(await runInTransaction((tx) => claimCorpusStep(tx, 60))).toBe(true);
    expect((await runInTransaction((tx) => readCorpusProgress(tx))).startedAt).not.toBeNull();
  });

  it('gives the lease to one caller and refuses the next', async () => {
    await harness.db.exec('DELETE FROM corpus_load;');
    expect(await runInTransaction((tx) => claimCorpusStep(tx, 60))).toBe(true);
    // A hundred visitors in a minute must produce one step, not a hundred.
    expect(await runInTransaction((tx) => claimCorpusStep(tx, 60))).toBe(false);
    expect(await runInTransaction((tx) => claimCorpusStep(tx, 60))).toBe(false);
  });

  it('grants it again once the interval has passed', async () => {
    await harness.db.exec('DELETE FROM corpus_load;');
    expect(await runInTransaction((tx) => claimCorpusStep(tx, 60))).toBe(true);
    await harness.db.exec("UPDATE corpus_load SET updated_at = now() - interval '2 minutes';");
    expect(await runInTransaction((tx) => claimCorpusStep(tx, 60))).toBe(true);
  });

  it('holds the interval off even when the step dies', async () => {
    // `updated_at` is set BEFORE the work, not after. Otherwise a step that
    // crashes leaves the lease free and a crash loop becomes a request loop
    // against somebody else's API.
    await harness.db.exec('DELETE FROM corpus_load;');
    await runInTransaction((tx) => claimCorpusStep(tx, 60));
    const claimed = await runInTransaction((tx) => readCorpusProgress(tx));
    expect(claimed.updatedAt).not.toBeNull();
    expect(await runInTransaction((tx) => claimCorpusStep(tx, 60))).toBe(false);
  });

  it('refuses once the walk is finished, so nothing runs for ever', async () => {
    await harness.db.exec('DELETE FROM corpus_load;');
    await runInTransaction((tx) => claimCorpusStep(tx, 0));
    await harness.db.exec('UPDATE corpus_load SET finished_at = now();');
    expect(await runInTransaction((tx) => claimCorpusStep(tx, 0))).toBe(false);
  });

  it('is claimable again after a restart', async () => {
    await harness.db.exec('DELETE FROM corpus_load;');
    await runInTransaction((tx) => claimCorpusStep(tx, 0));
    await harness.db.exec('UPDATE corpus_load SET finished_at = now();');
    expect(await runInTransaction((tx) => claimCorpusStep(tx, 0))).toBe(false);

    await runInTransaction((tx) => startCorpusLoad(tx));
    expect(await runInTransaction((tx) => claimCorpusStep(tx, 0))).toBe(true);
  });
});

describe('a funder the walk cannot read', () => {
  /**
   * The third and last uncounted way for the corpus to be short, found by
   * walking the product: three publishers failed mid-walk and the console
   * reported "Funders read 42 of 42 — 100%", "Records cut short 0", state
   * "finished", and no problem at all. `error` is one slot, overwritten by
   * the next failure and cleared by the next success, so it was never a
   * record of what is MISSING — only of what most recently went wrong.
   */
  it('counts the failure and names the funder', async () => {
    const { http } = fakeApi({
      funders: ['GB-CHC-1', 'GB-CHC-BAD', 'GB-CHC-2'],
      broken: ['GB-CHC-BAD'],
    });

    const result = await advanceCorpus(http, runInTransaction, { baseUrl: BASE });

    expect(result.failedOrgIds).toEqual(['GB-CHC-BAD']);
    const progress = await runInTransaction((tx) => readCorpusProgress(tx));
    expect(progress.fundersFailed).toBe(1);
    expect(progress.failedOrgIds).toContain('GB-CHC-BAD');
  });

  it('keeps the count after a later step succeeds, unlike the error', async () => {
    // This is the whole bug. A second successful step used to clear the only
    // trace of the first step's failure.
    const broken = fakeApi({ funders: ['GB-CHC-BAD'], broken: ['GB-CHC-BAD'] });
    await advanceCorpus(broken.http, runInTransaction, { baseUrl: BASE, maxFunders: 1 });

    const fine = fakeApi({ funders: ['GB-CHC-BAD', 'GB-CHC-2'] });
    await advanceCorpus(fine.http, runInTransaction, { baseUrl: BASE });

    const progress = await runInTransaction((tx) => readCorpusProgress(tx));
    expect(progress.lastError, 'a success should clear the error').toBeNull();
    expect(progress.fundersFailed, 'but not the count of what is missing').toBe(1);
    expect(progress.failedOrgIds).toContain('GB-CHC-BAD');
  });

  it('counts each failing funder once per step, not once per walk', async () => {
    const { http } = fakeApi({
      funders: ['GB-CHC-A', 'GB-CHC-B', 'GB-CHC-3'],
      broken: ['GB-CHC-A', 'GB-CHC-B'],
    });
    const result = await advanceCorpus(http, runInTransaction, { baseUrl: BASE });

    expect(result.failedOrgIds).toEqual(['GB-CHC-A', 'GB-CHC-B']);
    expect((await runInTransaction((tx) => readCorpusProgress(tx))).fundersFailed).toBe(2);
  });

  it('counts none when every funder was read', async () => {
    const { http } = fakeApi({ funders: ['GB-CHC-1', 'GB-CHC-2'] });
    const result = await advanceCorpus(http, runInTransaction, { baseUrl: BASE });
    expect(result.failedOrgIds).toEqual([]);
    expect((await runInTransaction((tx) => readCorpusProgress(tx))).fundersFailed).toBe(0);
  });

  it('forgets the failures on a deliberate restart', async () => {
    const { http } = fakeApi({ funders: ['GB-CHC-BAD'], broken: ['GB-CHC-BAD'] });
    await advanceCorpus(http, runInTransaction, { baseUrl: BASE });
    await runInTransaction((tx) => startCorpusLoad(tx));

    const progress = await runInTransaction((tx) => readCorpusProgress(tx));
    expect(progress.fundersFailed).toBe(0);
    expect(progress.failedOrgIds).toEqual([]);
  });
});

describe('the three-year window', () => {
  /**
   * The corpus holds `RECENT_YEARS`, because all of 360Giving measured at
   * roughly 420 MB and no free database tier is that big. The window is a
   * storage decision, and these tests pin the two things that make it honest:
   * what is dropped is dropped, and what is dropped is COUNTED.
   */
  it('keeps the recent grant and drops the decade-old one', async () => {
    const { http } = fakeApi({ funders: ['GB-CHC-OLD'], stale: ['GB-CHC-OLD'] });

    const result = await advanceCorpus(http, runInTransaction, { baseUrl: BASE });

    expect(result.awardsWritten).toBe(1);
    expect(result.discarded).toBe(1);
    expect((await loaded()).awards).toBe(1);
  });

  it('records what it discarded, so a partial corpus can be audited', async () => {
    const { http } = fakeApi({ funders: ['GB-CHC-OLD'], stale: ['GB-CHC-OLD'] });
    await advanceCorpus(http, runInTransaction, { baseUrl: BASE });

    const progress = await runInTransaction((tx) => readCorpusProgress(tx));
    expect(progress.awardsDiscarded).toBe(1);
  });

  it('fetched the old grant anyway, because their API has no date filter', async () => {
    // The point of this test is that the window is NOT a speed-up and must
    // never be described as one. `org/{id}/grants_made/` declares no filter
    // fields, so every grant a funder ever published crosses the wire
    // whatever we keep. Someone reading `discarded: 1` should not conclude
    // that one request was saved.
    const { http, asked } = fakeApi({ funders: ['GB-CHC-OLD'], stale: ['GB-CHC-OLD'] });
    await advanceCorpus(http, runInTransaction, { baseUrl: BASE });

    const grantAsks = asked.filter((url) => url.includes('/grants_made/'));
    expect(grantAsks).toHaveLength(1);
    expect(grantAsks[0]).not.toMatch(/since|date|after/iu);
  });

  it('keeps everything when the window is opened wide', async () => {
    // Proves the drop is the window's doing and not the fixture's — the same
    // two grants, one setting changed.
    const { http } = fakeApi({ funders: ['GB-CHC-OLD'], stale: ['GB-CHC-OLD'] });
    const result = await advanceCorpus(http, runInTransaction, {
      baseUrl: BASE,
      recentYears: 50,
    });

    expect(result.awardsWritten).toBe(2);
    expect(result.discarded).toBe(0);
  });

  it('counts nothing discarded when every grant is inside the window', async () => {
    const { http } = fakeApi({ funders: ['GB-CHC-1', 'GB-CHC-2'] });
    const result = await advanceCorpus(http, runInTransaction, { baseUrl: BASE });
    expect(result.discarded).toBe(0);
  });
});

describe('a funder with more grants than we fetch', () => {
  /**
   * The cap was 20 pages — two thousand grants — and the connector's
   * `truncated` flag was returned and then dropped. So the biggest funders in
   * the corpus, the ones that matter most, had their records silently cut
   * short, and every figure drawn from them was wrong: the median, the
   * quartiles, "6 grants like yours", the range.
   *
   * A cap still has to exist or one enormous publisher eats a whole step. What
   * must never happen again is that it is invisible.
   */
  it('is COUNTED as cut short, not silently trimmed', async () => {
    const { http } = fakeApi({ funders: ['GB-CHC-BIG'], enormous: ['GB-CHC-BIG'] });
    const result = await advanceCorpus(http, runInTransaction, {
      baseUrl: BASE,
      maxPagesPerFunder: 3,
    });

    expect(result.truncated).toBe(1);
    expect((await runInTransaction((tx) => readCorpusProgress(tx))).fundersTruncated).toBe(1);
  });

  it('still stores what it did get, rather than discarding the funder', async () => {
    const { http } = fakeApi({ funders: ['GB-CHC-BIG'], enormous: ['GB-CHC-BIG'] });
    await advanceCorpus(http, runInTransaction, { baseUrl: BASE, maxPagesPerFunder: 3 });
    // Three pages of one grant each. An incomplete record beats none, so long
    // as its incompleteness is on the record.
    expect((await loaded()).awards).toBe(3);
  });

  it('counts nothing as cut short when nothing was', async () => {
    const { http } = fakeApi({ funders: ['GB-CHC-1', 'GB-CHC-2'] });
    const result = await advanceCorpus(http, runInTransaction, { baseUrl: BASE });
    expect(result.truncated).toBe(0);
    expect((await runInTransaction((tx) => readCorpusProgress(tx))).fundersTruncated).toBe(0);
  });

  it('fetches far more per funder than it used to', async () => {
    // 20 pages was 2,000 grants. The big UK funders publish tens of
    // thousands, so the default was cutting exactly the funders an applicant
    // most wants to understand.
    const { http, asked } = fakeApi({ funders: ['GB-CHC-BIG'], enormous: ['GB-CHC-BIG'] });
    await advanceCorpus(http, runInTransaction, { baseUrl: BASE, deadlineMs: 60_000 });
    const pages = asked.filter((url) => url.includes('/grants_made/')).length;
    expect(pages).toBeGreaterThan(100);
  });
});

describe('progress after a restart clears the counters it should', () => {
  it('forgets how many records were cut short last time', async () => {
    const { http } = fakeApi({ funders: ['GB-CHC-BIG'], enormous: ['GB-CHC-BIG'] });
    await advanceCorpus(http, runInTransaction, { baseUrl: BASE, maxPagesPerFunder: 2 });
    expect((await runInTransaction((tx) => readCorpusProgress(tx))).fundersTruncated).toBe(1);

    await runInTransaction((tx) => startCorpusLoad(tx));
    expect((await runInTransaction((tx) => readCorpusProgress(tx))).fundersTruncated).toBe(0);
  });
});
