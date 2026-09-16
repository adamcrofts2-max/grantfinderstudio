/**
 * How long a search takes at the corpus's real size. A MEASUREMENT, not a test.
 *
 * ## Why it is here rather than in a notebook somewhere
 *
 * "Is it fast enough?" was answered by assurance twice and by measurement
 * once, and only the measurement was worth anything: it is what decided the
 * index (0015) and the window (0016). The next person to change either will
 * ask the same question, and re-inventing the rig is how a measured decision
 * turns back into an opinion.
 *
 * It calls the PRODUCT'S OWN query builders, not hand-written SQL — which is
 * the whole point. Timing SQL somebody typed for the occasion measures that
 * SQL. `searchAwards`, `facetsFor` and `funderSummaries` are what a search
 * page actually runs, in the order `searchCorpus` runs them, on one
 * connection.
 *
 * ## Running it
 *
 *     PROBE_DATABASE_URL='postgres://…' npx vitest run search-latency.probe
 *
 * Skipped without that variable, so it never runs in CI and never touches a
 * database nobody pointed it at. Seed the corpus first — measuring an empty
 * table measures nothing. Results at 65,008 grants are in `docs/STATUS.md`.
 */
import { describe, expect, it } from 'vitest';

import { facetsFor, searchAwards, funderSummaries } from './grants.js';
import { NO_FILTERS } from '../domain/grants/facets.js';
import type { Queryable } from './client.js';

const PROBE_URL = process.env['PROBE_DATABASE_URL'] ?? '';

/** Seven runs after a warm one, reported as a median: one run measures the cache. */
async function time(label: string, fn: () => Promise<unknown>): Promise<void> {
  await fn();
  const runs: number[] = [];
  for (let i = 0; i < 7; i += 1) {
    const t = process.hrtime.bigint();
    // eslint-disable-next-line no-await-in-loop
    await fn();
    runs.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  runs.sort((a, b) => a - b);
  console.log(
    `PROBE ${label}: median ${runs[3]?.toFixed(1)} ms (min ${runs[0]?.toFixed(1)}, max ${runs[6]?.toFixed(1)})`,
  );
}

describe.skipIf(PROBE_URL === '')('search latency at corpus scale', () => {
  it('times the queries a search page actually runs', async () => {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: PROBE_URL });
    await client.connect();

    const tx: Queryable = {
      query: async (sql: string, params?: unknown[]) =>
        client.query(sql, params as never) as never,
    } as unknown as Queryable;

    const terms = ['youth', 'skills', 'somerset'];

    const { rows } = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM funder_awards');
    console.log('PROBE corpus rows:', rows[0]?.n);

    await time('searchAwards (the page of results)', () => searchAwards(tx, terms));
    await time('facetsFor (every chip count)', () => facetsFor(tx, terms, NO_FILTERS));
    await time('funderSummaries (the by-funder view)', () =>
      funderSummaries(tx, terms, NO_FILTERS, { region: 'Somerset' }),
    );

    // The worst case the tokeniser allows. Each term carries its own floor
    // (see `textSearch`), so the cost of a long query is the thing to watch:
    // MAX_TERMS is 8 and somebody pasting a sentence gets all eight.
    const many = ['youth', 'skills', 'somerset', 'training', 'volunteering',
      'placements', 'wells', 'employment'];
    await time(`searchAwards (${many.length} terms)`, () => searchAwards(tx, many));
    await time(`facetsFor (${many.length} terms)`, () => facetsFor(tx, many, NO_FILTERS));
    await time(`funderSummaries (${many.length} terms)`, () =>
      funderSummaries(tx, many, NO_FILTERS, { region: 'Somerset' }),
    );

    await client.end();
    expect(true).toBe(true);
  }, 120_000);
});
