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
import {
  AMOUNT_BANDS,
  NO_FILTERS,
  RECENCY,
  bandById,
  recencyById,
  without,
  type Dimension,
  type GrantFilters,
} from '../domain/grants/facets.js';

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
  /** The licence itself, which is what a footer should name. */
  licence: string | null;
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
  licence: string | null;
}

const SELECT = `
  SELECT a.id, a.funder_id, f.name AS funder_name, f.website AS funder_website,
         a.recipient_name, a.title, a.amount_gbp::text AS amount_gbp,
         a.awarded_on::text AS awarded_on, a.description,
         a.jurisdiction, a.region, a.tags, d.attribution, d.licence
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
    licence: row.licence,
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
/**
 * The WHERE clause for a search, assembled from terms and filters.
 *
 * Built here rather than inlined so that the page query and every facet count
 * are provably the same predicate. They have to be: a count that came from a
 * different WHERE than the list is a lie with a number on it.
 *
 * Returns SQL with `$n` placeholders and the values to bind, so nothing a
 * person typed is ever concatenated into the statement.
 */
function buildWhere(
  terms: readonly string[],
  filters: GrantFilters,
  startAt = 0,
): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const clauses: string[] = [];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${startAt + values.length}`;
  };

  const patterns = terms.filter((t) => t.trim() !== '').map((t) => `%${escapeLike(t)}%`);
  if (patterns.length > 0) {
    const p = bind(patterns);
    clauses.push(
      `(a.recipient_name ILIKE ANY (${p})
        OR a.title ILIKE ANY (${p})
        OR a.description ILIKE ANY (${p})
        OR a.region ILIKE ANY (${p})
        OR EXISTS (SELECT 1 FROM unnest(a.tags) AS t WHERE t ILIKE ANY (${p})))`,
    );
  }

  const bands = filters.bands
    .map(bandById)
    .filter((band): band is NonNullable<typeof band> => band !== null);
  if (bands.length > 0) {
    clauses.push(
      `(${bands
        .map((band) =>
          band.max === null
            ? `a.amount_gbp >= ${bind(band.min)}`
            : `(a.amount_gbp >= ${bind(band.min)} AND a.amount_gbp < ${bind(band.max)})`,
        )
        .join(' OR ')})`,
    );
  }

  const recency = filters.since === null ? null : recencyById(filters.since);
  if (recency !== null) {
    // Interval arithmetic in Postgres rather than a date computed in Node: a
    // serverless function's clock and the database's are not the same clock,
    // and "the last two years" should not move depending on which answered.
    clauses.push(
      `a.awarded_on >= (now() - make_interval(years => ${bind(recency.years)}::int))::date`,
    );
  }

  if (filters.places.length > 0) {
    const places = bind(filters.places.map((place) => `%${escapeLike(place)}%`));
    clauses.push(`a.region ILIKE ANY (${places})`);
  }

  if (filters.topics.length > 0) {
    // Exact labels, because these came from the facet list and are the
    // publisher's own strings — matching them loosely would merge distinct
    // labels behind the person's back.
    clauses.push(`a.tags && ${bind(filters.topics)}::text[]`);
  }

  return { sql: clauses.length === 0 ? 'TRUE' : clauses.join(' AND '), values };
}

export async function searchAwards(
  tx: Queryable,
  terms: readonly string[],
  filters: GrantFilters = NO_FILTERS,
  limit = 120,
): Promise<{ awards: AwardResult[]; capped: boolean }> {
  if (terms.filter((t) => t.trim() !== '').length === 0) {
    return { awards: [], capped: false };
  }

  const where = buildWhere(terms, filters);
  const { rows } = await tx.query<Row>(
    `${SELECT}
      WHERE ${where.sql}
      ORDER BY a.awarded_on DESC NULLS LAST, a.amount_gbp DESC
      LIMIT $${where.values.length + 1}`,
    [...where.values, limit + 1],
  );

  const capped = rows.length > limit;
  return { awards: rows.slice(0, limit).map(toAward), capped };
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface Facets {
  amount: FacetOption[];
  since: FacetOption[];
  place: FacetOption[];
  topic: FacetOption[];
  /** Grants matching the text and every active filter. */
  total: number;
}

/** How many places and topics to offer: enough to be useful, few enough to read. */
const FACET_WIDTH = 8;

/**
 * An option that would leave nothing is not an option.
 *
 * Dropping the zeroes is what keeps the row short and keeps every chip a real
 * move — the whole reason the counts are computed at all.
 */
function keep(options: FacetOption[]): FacetOption[] {
  return options.filter((option) => option.count > 0);
}

/**
 * Counts for every option a person could pick next.
 *
 * Each dimension is counted with the OTHER dimensions still applied and its
 * own released, which is what makes the numbers answer the question actually
 * being asked — "how many would I get if I picked this" — rather than "how
 * many are there given I already picked this", which shows every unpicked
 * option as zero and makes a live screen look like a dead end.
 *
 * One round trip, aggregates only, so nothing but counts crosses the wire even
 * when a search matches a hundred thousand grants.
 */
export async function facetsFor(
  tx: Queryable,
  terms: readonly string[],
  filters: GrantFilters,
): Promise<Facets> {
  if (terms.filter((t) => t.trim() !== '').length === 0) {
    return { amount: [], since: [], place: [], topic: [], total: 0 };
  }

  const values: unknown[] = [];
  /** One dimension's predicate, with its placeholders numbered for the whole query. */
  const predicate = (dimension: Dimension | null): string => {
    const where = buildWhere(
      terms,
      dimension === null ? filters : without(filters, dimension),
      values.length,
    );
    values.push(...where.values);
    return where.sql;
  };

  const parts: string[] = [];

  // Amounts keep the domain's order rather than the database's: bands read as
  // a scale, so sorting them by popularity would make them harder to use.
  parts.push(
    `amount AS (${AMOUNT_BANDS.map((band) => {
      const upper = band.max === null ? '' : ` AND a.amount_gbp < ${band.max}`;
      return `SELECT '${band.id}' AS value, count(*)::int AS n
                FROM funder_awards a
               WHERE (${predicate('amount')}) AND a.amount_gbp >= ${band.min}${upper}`;
    }).join(' UNION ALL ')})`,
  );

  parts.push(
    `since AS (${RECENCY.map(
      (option) => `SELECT '${option.id}' AS value, count(*)::int AS n
                     FROM funder_awards a
                    WHERE (${predicate('since')})
                      AND a.awarded_on >= (now() - make_interval(years => ${option.years}))::date`,
    ).join(' UNION ALL ')})`,
  );

  parts.push(
    `place AS (
       SELECT a.region AS value, count(*)::int AS n
         FROM funder_awards a
        WHERE (${predicate('place')}) AND a.region IS NOT NULL AND a.region <> ''
        GROUP BY a.region
        ORDER BY n DESC, a.region
        LIMIT ${FACET_WIDTH})`,
  );

  parts.push(
    `topic AS (
       SELECT t AS value, count(*)::int AS n
         FROM funder_awards a, unnest(a.tags) AS t
        WHERE (${predicate('topic')}) AND t <> ''
        GROUP BY t
        ORDER BY n DESC, t
        LIMIT ${FACET_WIDTH})`,
  );

  parts.push(
    `total AS (SELECT count(*)::int AS n FROM funder_awards a WHERE (${predicate(null)}))`,
  );

  const { rows } = await tx.query<{ dim: string; value: string | null; n: number }>(
    `WITH ${parts.join(', ')}
     SELECT 'amount' AS dim, value, n FROM amount
     UNION ALL SELECT 'since', value, n FROM since
     UNION ALL SELECT 'place', value, n FROM place
     UNION ALL SELECT 'topic', value, n FROM topic
     UNION ALL SELECT 'total', NULL, n FROM total`,
    values,
  );

  const counted = (dim: string, value: string): number =>
    rows.find((row) => row.dim === dim && row.value === value)?.n ?? 0;

  return {
    amount: keep(
      AMOUNT_BANDS.map((band) => ({
        value: band.id,
        label: band.label,
        count: counted('amount', band.id),
      })),
    ),
    since: keep(
      RECENCY.map((option) => ({
        value: option.id,
        label: option.label,
        count: counted('since', option.id),
      })),
    ),
    place: keep(
      rows
        .filter((row) => row.dim === 'place' && row.value !== null)
        .map((row) => ({ value: row.value as string, label: row.value as string, count: row.n })),
    ),
    topic: keep(
      rows
        .filter((row) => row.dim === 'topic' && row.value !== null)
        .map((row) => ({ value: row.value as string, label: row.value as string, count: row.n })),
    ),
    total: rows.find((row) => row.dim === 'total')?.n ?? 0,
  };
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
