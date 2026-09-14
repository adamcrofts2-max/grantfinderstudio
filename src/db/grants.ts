/**
 * Searching awarded grants, locally. TENANT path, over SHARED reference data.
 *
 * `funder_awards` is granted SELECT to `app_user` (0001) and carries no
 * policy: every tenant reads all of it, because it is published open data
 * rather than anybody's own work. So this runs on the tenant connection with
 * no risk of leaking between organisations — there is nothing tenant-specific
 * in it to leak.
 *
 * ## Why the search came back here
 *
 * It was moved OUT of the database and onto 360Giving's API, on the strength of
 * an all-grants search route read out of their source. That route is not
 * public: it 404s, three deployments in a row. What their published API gives
 * is every grant a NAMED funder made — and no text search on anything. So the
 * only place grant TEXT can be searched is a copy we hold, which is also what
 * 360Giving tell developers to do with their data.
 *
 * The complaint that moved it away was right and still stands: "the user should
 * be able to search the grants, not the admin load each grant." The answer is
 * to fill this table automatically from the funder list, not to abandon it.
 */

import type { Queryable } from './client.js';
import type { Jurisdiction } from '../domain/types.js';

export interface AwardResult {
  id: string;
  funderId: string;
  funderName: string;
  funderWebsite: string | null;
  recipientName: string | null;
  /** The publisher's short label for the grant. */
  title: string | null;
  amountGbp: number;
  awardedOn: string | null;
  description: string | null;
  jurisdiction: Jurisdiction | null;
  region: string | null;
  tags: string[];
  /** The licence line that must travel with anything derived from the source. */
  attribution: string | null;
}

interface Row {
  id: string;
  funder_id: string;
  funder_name: string;
  funder_website: string | null;
  recipient_name: string | null;
  title: string | null;
  amount_gbp: string | null;
  awarded_on: string | null;
  description: string | null;
  jurisdiction: Jurisdiction | null;
  region: string | null;
  tags: string[] | null;
  attribution: string | null;
}

const SELECT = `
  SELECT a.id, a.funder_id, f.name AS funder_name, f.website AS funder_website,
         a.recipient_name, a.title, a.amount_gbp::text AS amount_gbp,
         a.awarded_on::text AS awarded_on, a.description,
         a.jurisdiction, a.region, a.tags, d.attribution
    FROM funder_awards a
    JOIN funders f ON f.id = a.funder_id
    LEFT JOIN source_datasets d ON d.id = a.source_dataset_id`;

function toAward(row: Row): AwardResult {
  return {
    id: row.id,
    funderId: row.funder_id,
    funderName: row.funder_name,
    funderWebsite: row.funder_website,
    recipientName: row.recipient_name,
    title: row.title,
    amountGbp: Number(row.amount_gbp ?? 0),
    awardedOn: row.awarded_on,
    description: row.description,
    jurisdiction: row.jurisdiction,
    region: row.region,
    tags: row.tags ?? [],
    attribution: row.attribution,
  };
}

/**
 * A term, made safe to put inside an ILIKE pattern.
 *
 * `%` and `_` are wildcards and `\\` escapes them, so a term carrying one
 * changes what the query means: a single `%` becomes `%%%`, which matches
 * every grant in the corpus. In the app nothing dangerous can get here —
 * `queryTerms` splits on everything that is not a letter or a digit, which is
 * a whitelist rather than an escape step — but a function is not safe because
 * of who calls it today. Escaped here so this one is safe for any caller.
 */
function escapeLike(term: string): string {
  return term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

/**
 * Awards matching ANY of the terms, newest first.
 *
 * ANY rather than ALL, deliberately. Somebody types "youth skills Somerset" and
 * means "anything like this" — a grant described as "young people, employment
 * training" in Wells is exactly what they wanted and shares not one whole word
 * with the query. Requiring every term would return nothing and look like an
 * empty corpus. Ranking is what puts the closest first, and that happens in
 * `domain/grants/query.ts` where it can be tested without a database.
 *
 * The terms arrive already tokenised by `queryTerms`, which splits on anything
 * that is not a letter or a digit — so nothing that reaches `$1` can carry a
 * wildcard, a quote or a backslash. That is a whitelist, not an escape step,
 * and it is why the array can go straight into an ILIKE ANY.
 *
 * `LIMIT` is not paging politeness: the corpus can carry hundreds of thousands
 * of awards, and a screen that tried to render them all would take the request
 * with it. The caller is told when it was capped so it can say so rather than
 * quietly showing a slice.
 */
export async function searchAwards(
  tx: Queryable,
  terms: readonly string[],
  limit = 120,
): Promise<{ awards: AwardResult[]; capped: boolean }> {
  const patterns = terms
    .filter((t) => t.trim() !== '')
    .map((t) => `%${escapeLike(t)}%`);
  if (patterns.length === 0) return { awards: [], capped: false };

  const { rows } = await tx.query<Row>(
    `${SELECT}
      WHERE a.recipient_name ILIKE ANY ($1)
         OR a.title ILIKE ANY ($1)
         OR a.description ILIKE ANY ($1)
         OR a.region ILIKE ANY ($1)
         OR EXISTS (SELECT 1 FROM unnest(a.tags) AS t WHERE t ILIKE ANY ($1))
      ORDER BY a.awarded_on DESC NULLS LAST, a.amount_gbp DESC
      LIMIT $2`,
    [patterns, limit + 1],
  );

  const capped = rows.length > limit;
  return { awards: rows.slice(0, limit).map(toAward), capped };
}

/** The most recent awards held, for a screen that nobody has typed into yet. */
export async function recentAwards(tx: Queryable, limit = 40): Promise<AwardResult[]> {
  const { rows } = await tx.query<Row>(
    `${SELECT}
      ORDER BY a.awarded_on DESC NULLS LAST, a.amount_gbp DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(toAward);
}

/**
 * How much of the corpus is held.
 *
 * So an empty result can tell the truth about WHY it is empty: the corpus is
 * still being assembled, or the search excluded everything. Those are
 * completely different problems and look identical without this.
 */
export async function corpusSize(
  tx: Queryable,
): Promise<{ awards: number; funders: number }> {
  const { rows } = await tx.query<{ awards: number; funders: number }>(
    `SELECT (SELECT count(*)::int FROM funder_awards) AS awards,
            (SELECT count(*)::int FROM funders)       AS funders`,
  );
  return { awards: rows[0]?.awards ?? 0, funders: rows[0]?.funders ?? 0 };
}
