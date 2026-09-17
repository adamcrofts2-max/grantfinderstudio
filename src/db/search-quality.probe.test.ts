/**
 * How good are the search results? A MEASUREMENT, not a test.
 *
 * Skipped unless PROBE_DATABASE_URL is set. Point it at a loaded corpus.
 *
 *     PROBE_DATABASE_URL='postgres://…' npx vitest run search-quality.probe
 */
import { describe, expect, it } from 'vitest';

import { facetsFor, searchAwards, textSearch } from './grants.js';
import { NO_FILTERS } from '../domain/grants/facets.js';
import { queryTerms, rankGrants } from '../domain/grants/query.js';
import type { Queryable } from './client.js';

const PROBE_URL = process.env['PROBE_DATABASE_URL'] ?? '';

const SEARCHES = [
  // The query a user reported: "it shows a lot of irrelevant results".
  'community tree nursery somerset',
  'youth skills somerset',
  'food bank leeds',
  'chapel roof repair',
  'mental health young people',
  'community allotment growing',
];

describe.skipIf(PROBE_URL === '')('search quality', () => {
  it('measures breadth and whether the best matches survive the page limit', async () => {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: PROBE_URL });
    await client.connect();
    const tx: Queryable = {
      query: async (sql: string, params?: unknown[]) =>
        client.query(sql, params as never) as never,
    } as unknown as Queryable;

    const total = await client.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM funder_awards',
    );
    const corpus = Number(total.rows[0]?.n ?? 0);
    console.log(`PROBE corpus: ${corpus} grants\n`);

    for (const typed of SEARCHES) {
      const terms = queryTerms(typed);
      const text = (await textSearch(tx, terms))!;
      const facets = await facetsFor(tx, text, NO_FILTERS);
      const page = await searchAwards(tx, text, NO_FILTERS);
      const ranked = rankGrants(page.awards, { region: 'Somerset', amountSoughtGbp: 30_000 });

      // What Postgres itself thinks the best matches are, over EVERY match
      // rather than the newest slice the page fetches.
      const lexemes = terms.map((t) => `${t}:*`).join(' | ');
      const best = await client.query<{ id: string; rank: number; title: string }>(
        `SELECT a.id, ts_rank(a.search_vector, to_tsquery('english', $1)) AS rank,
                coalesce(a.title, '') AS title
           FROM funder_awards a
          WHERE a.search_vector @@ to_tsquery('english', $1)
          ORDER BY rank DESC, a.awarded_on DESC
          LIMIT 20`,
        [lexemes],
      );

      const fetched = new Set(page.awards.map((a) => a.id));
      const bestSeen = best.rows.filter((row) => fetched.has(row.id)).length;

      console.log(`PROBE "${typed}"  (${terms.join(' ')})`);
      console.log(
        `   matched ${facets.total} of ${corpus} grants  = ${Math.round((facets.total / corpus) * 100)}% of the corpus`,
      );
      // How much each word narrows, which is what the ranking now turns on.
      console.log(
        `   words: ${facets.terms
          .map((t) => `${t.term} ${t.matches}${t.matches === 0 ? ' (NOTHING)' : ''}`)
          .join(', ')}`,
      );
      const scores = page.awards.map((a) => a.textScore ?? 0);
      if (scores.length > 0) {
        console.log(
          `   match scores: best ${Math.round(Math.max(...scores) * 100)}%,` +
            ` worst on the page ${Math.round(Math.min(...scores) * 100)}%`,
        );
      }
      console.log(`   fetched ${page.awards.length}${page.capped ? ' (capped)' : ''}`);
      console.log(
        `   of Postgres's top 20 matches, ${bestSeen} reached the ranker — ${20 - bestSeen} never did`,
      );
      console.log('   the page shows first:');
      for (const award of ranked.slice(0, 5)) {
        console.log(
          `     ${award.awardedOn}  £${award.amountGbp.toLocaleString('en-GB').padStart(8)}  ${(award.title ?? '').slice(0, 44)}`,
        );
      }
      console.log('   the best matches are:');
      for (const row of best.rows.slice(0, 5)) {
        console.log(`     rank ${row.rank.toFixed(4)}  ${row.title.slice(0, 44)}`);
      }
      console.log('');
    }

    await client.end();
    expect(true).toBe(true);
  }, 240_000);
});
