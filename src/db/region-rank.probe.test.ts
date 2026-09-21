/**
 * Does a county somebody TYPED change the order they see?
 *
 * The claim on the roadmap: it earns rank in the fetch (the vector carries
 * region at weight D) and nothing in the final ordering, because `relevance`
 * only knows the applicant's OWN region. Measured here before anything is
 * changed.
 */
import { describe, it } from 'vitest';

import { searchAwards, textSearch } from './grants.js';
import { NO_FILTERS } from '../domain/grants/facets.js';
import { queryTerms, relevance } from '../domain/grants/query.js';
import type { Queryable } from './client.js';

const PROBE_URL = process.env['PROBE_DATABASE_URL'] ?? '';

describe.skipIf(PROBE_URL === '')('a typed county', () => {
  it('measures where its grants land', async () => {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: PROBE_URL });
    await client.connect();
    const tx: Queryable = {
      query: async (sql: string, params?: unknown[]) =>
        client.query(sql, params as never) as never,
    } as unknown as Queryable;

    for (const [query, county] of [
      ['dorset tree nursery', 'Dorset'],
      ['bristol green space', 'Bristol'],
      ['cornwall woodland', 'Cornwall'],
    ] as const) {
      const terms = queryTerms(query);
      // NO applicant region: this is about the words they typed, not where
      // they are. An applicant in Somerset searching "dorset" wants Dorset.
      const context = { terms, region: null, amountSoughtGbp: null };
      const scope = await textSearch(tx, terms);
      if (scope === null) continue;
      const page = await searchAwards(tx, scope, NO_FILTERS);

      const ranked = page.awards
        .map((a, index) => ({ a, index, score: relevance(a, context) }))
        .toSorted((x, y) => y.score - x.score || x.index - y.index);

      const inCounty = ranked.filter((r) => (r.a.region ?? '') === county).length;
      const topTen = ranked.slice(0, 10).filter((r) => (r.a.region ?? '') === county).length;
      const firstAt = ranked.findIndex((r) => (r.a.region ?? '') === county);

      console.log(`\nPROBE "${query}" — ${page.awards.length} fetched, ${inCounty} in ${county}`);
      console.log(`  ${topTen} of the top 10 are in ${county}; first one at position ${firstAt + 1}`);
      for (const r of ranked.slice(0, 8)) {
        console.log(
          `   ${r.score.toFixed(2).padStart(6)}  ${(r.a.title ?? '').slice(0, 34).padEnd(34)} ` +
            `${(r.a.region ?? '').padEnd(16)} text=${(r.a.textScore ?? 0).toFixed(3)}`,
        );
      }
    }
    await client.end();
  }, 120_000);
});
