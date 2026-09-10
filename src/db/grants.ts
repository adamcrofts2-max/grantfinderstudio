/**
 * Searching awarded grants. TENANT path, over SHARED reference data.
 *
 * `funder_awards` is granted SELECT to `app_user` (0001) and carries no
 * policy: every tenant reads all of it, because it is published open data
 * rather than anybody's own work. So this runs on the tenant connection with
 * no risk of leaking between organisations — there is nothing tenant-specific
 * in it to leak.
 */

import type { Queryable } from './client.js';
import type { GrantSearchCriteria } from '../domain/grants/search.js';
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

/**
 * Grants matching the criteria, newest first.
 *
 * Every filter is optional and every one is parameterised. The text filter
 * reaches the recipient's name and the grant description, which is where a
 * publisher says what the money was for.
 *
 * `LIMIT` is not paging politeness: a published dataset can carry tens of
 * thousands of awards, and a screen that tried to render them all would take
 * the request with it. The caller is told when it was capped so it can say so
 * rather than quietly showing a slice.
 */
export async function searchAwards(
  tx: Queryable,
  criteria: GrantSearchCriteria,
  limit = 60,
): Promise<{ awards: AwardResult[]; capped: boolean }> {
  const text = criteria.text.trim();
  const region = criteria.region.trim();
  const tag = criteria.tag.trim();

  const { rows } = await tx.query<Row>(
    `SELECT a.id, a.funder_id, f.name AS funder_name, f.website AS funder_website,
            a.recipient_name, a.title, a.amount_gbp::text AS amount_gbp,
            a.awarded_on::text AS awarded_on, a.description,
            a.jurisdiction, a.region, a.tags, d.attribution
       FROM funder_awards a
       JOIN funders f ON f.id = a.funder_id
       LEFT JOIN source_datasets d ON d.id = a.source_dataset_id
      WHERE ($1 = '' OR a.recipient_name ILIKE '%' || $1 || '%'
                     OR a.title ILIKE '%' || $1 || '%'
                     OR a.description ILIKE '%' || $1 || '%')
        AND ($2 = '' OR a.region ILIKE '%' || $2 || '%')
        AND ($3 = '' OR EXISTS (
              SELECT 1 FROM unnest(a.tags) AS t WHERE t ILIKE '%' || $3 || '%'))
        AND ($4::numeric IS NULL OR a.amount_gbp >= $4::numeric)
        AND ($5::numeric IS NULL OR a.amount_gbp <= $5::numeric)
      ORDER BY a.awarded_on DESC NULLS LAST, a.amount_gbp DESC
      LIMIT $6`,
    [text, region, tag, criteria.minAmountGbp, criteria.maxAmountGbp, limit + 1],
  );

  const capped = rows.length > limit;
  return {
    awards: rows.slice(0, limit).map((row) => ({
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
    })),
    capped,
  };
}

/**
 * How many awards are held at all.
 *
 * So an empty result can tell the truth about WHY it is empty: no grants have
 * been loaded on this deployment, or the filters excluded them. Those are
 * completely different problems and look identical without this.
 */
export async function countAwards(tx: Queryable): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM funder_awards',
  );
  return rows[0]?.n ?? 0;
}

/** The distinct classification labels held, for the filter's suggestions. */
export async function awardTags(tx: Queryable, limit = 40): Promise<string[]> {
  const { rows } = await tx.query<{ tag: string }>(
    `SELECT DISTINCT t AS tag
       FROM funder_awards a, unnest(a.tags) AS t
      WHERE t <> ''
      ORDER BY t
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => row.tag);
}

/** The distinct regions held, for the same reason. */
export async function awardRegions(tx: Queryable, limit = 40): Promise<string[]> {
  const { rows } = await tx.query<{ region: string }>(
    `SELECT DISTINCT region
       FROM funder_awards
      WHERE region IS NOT NULL AND region <> ''
      ORDER BY region
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => row.region);
}
