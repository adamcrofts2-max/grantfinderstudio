/** Why does a chapel-roof grant outrank a youth-skills one? A measurement. */
import { describe, expect, it } from 'vitest';

import { searchAwards, textSearch } from './grants.js';
import { NO_FILTERS } from '../domain/grants/facets.js';
import { queryTerms, relevance } from '../domain/grants/query.js';
import type { Queryable } from './client.js';

const PROBE_URL = process.env['PROBE_DATABASE_URL'] ?? '';

describe.skipIf(PROBE_URL === '')('why that order', () => {
  it('scores the page of results', async () => {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: PROBE_URL });
    await client.connect();
    const tx: Queryable = {
      query: async (sql: string, params?: unknown[]) =>
        client.query(sql, params as never) as never,
    } as unknown as Queryable;

    const terms = queryTerms('youth skills somerset');
    const context = { terms, region: 'Somerset', amountSoughtGbp: 30_000 };
    const page = await searchAwards(tx, (await textSearch(tx, terms))!, NO_FILTERS);

    const scored = page.awards.map((a) => ({
      score: relevance(a, context),
      title: a.title ?? '',
      region: a.region ?? '',
      amount: a.amountGbp,
      hay: `${a.title ?? ''} ${a.description ?? ''} ${a.recipientName ?? ''}`.toLowerCase(),
    }));

    const best = [...scored].toSorted((x, y) => y.score - x.score);
    console.log(`PROBE fetched ${scored.length}, distinct scores: ${[...new Set(scored.map((s) => s.score))].toSorted((a, b) => b - a).join(', ')}`);
    console.log('PROBE highest scoring in the fetched page:');
    for (const s of best.slice(0, 6)) {
      const hits = terms.filter((t) => s.hay.includes(t));
      console.log(`   ${String(s.score).padStart(2)}  ${s.title.slice(0, 30).padEnd(30)} region=${s.region.padEnd(18)} £${s.amount.toLocaleString('en-GB').padStart(7)}  terms in text: [${hits.join(' ')}]`);
    }
    console.log('PROBE lowest scoring:');
    for (const s of best.slice(-3)) {
      console.log(`   ${String(s.score).padStart(2)}  ${s.title.slice(0, 30).padEnd(30)} region=${s.region.padEnd(18)}`);
    }

    const titles = new Map<string, number>();
    for (const s of scored) titles.set(s.title, (titles.get(s.title) ?? 0) + 1);
    console.log('PROBE what is in the fetched page, by title:');
    for (const [title, n] of [...titles].toSorted((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`   ${String(n).padStart(3)} × ${title}`);
    }

    const youth = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM funder_awards WHERE title ILIKE '%youth skills%'`,
    );
    console.log(`PROBE "Youth skills programme" grants in the corpus: ${youth.rows[0]?.n}`);
    console.log(`PROBE how many reached the fetched page: ${scored.filter((s) => /youth skills/iu.test(s.title)).length}`);

    await client.end();
    expect(true).toBe(true);
  }, 120_000);
});
