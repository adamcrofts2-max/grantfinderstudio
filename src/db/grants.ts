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
 * every grant in the corpus. What reaches this now is the `place` filter,
 * which is a place NAME and so cannot be whitelisted to letters and digits the
 * way a search term is — "Stoke-on-Trent" and "King's Lynn" are real answers.
 * Hyphens and apostrophes are harmless in a LIKE pattern; the three
 * characters that are not are escaped here.
 */
function escapeLike(term: string): string {
  return term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

/**
 * The terms as one `to_tsquery` argument, or null when none survive.
 *
 * ## Why full text rather than ILIKE
 *
 * The search used to be `ILIKE '%term%'` over four columns, held up by three
 * GIN trigram indexes. Those indexes measured 26 MB per 20,000 grants — more
 * than the grants themselves — and at the corpus's full size they were the
 * difference between fitting a free database tier and not. Migration 0015
 * replaced them with one tsvector index, maintained by a trigger, covering
 * title, description, recipient, region AND the classification tags.
 *
 * ## Why every term gets `:*`
 *
 * A tsvector matches words, so `somer` would no longer find `Somerset` —
 * which is a thing people really type, because they are halfway through
 * typing. `somer:*` is a prefix match and finds it again, using the index
 * rather than defeating it. What is lost against trigrams is matching the
 * MIDDLE of a word (`merset`), which nobody searches for. What is gained is
 * stemming: `youth` and `youths` are now one word instead of two patterns.
 *
 * ## Why this is safe
 *
 * `&`, `|`, `!`, `(` and `<->` are tsquery OPERATORS, so a term carrying one
 * would change what the query means — or, more likely, make `to_tsquery`
 * raise a syntax error and turn a typo into a 500. `queryTerms` already
 * whitelists to `[\p{L}\p{N}]+`, but a function is not safe because of who
 * calls it today: anything outside the whitelist is dropped here too.
 *
 * Joined with `|` — ANY of the terms — for the reason set out in
 * `domain/grants/query.ts`: somebody typing "youth skills Somerset" means
 * "anything like this", and requiring every word returns nothing and looks
 * like an empty corpus. Ranking is what puts the closest first.
 */
/**
 * The terms that can actually be searched for.
 *
 * Separate from `tsqueryFor` because EVERY entry point has to agree on when
 * there is nothing to search for, and the definition has to be this one. It
 * was not, for a moment: the guards asked whether any term was non-blank while
 * the predicate asked whether any term survived the whitelist, so a search for
 * `%` passed the guard, produced no text clause, and `buildWhere` fell through
 * to TRUE — the entire corpus, returned as a search result. A whitelist and a
 * guard that disagree about the empty case are a whitelist with a hole in it.
 */
function searchable(terms: readonly string[]): string[] {
  return terms
    .map((term) => term.replaceAll(/[^\p{L}\p{N}]/gu, ''))
    .filter((term) => term !== '');
}

function tsqueryFor(terms: readonly string[]): string | null {
  const lexemes = searchable(terms).map((term) => `${term}:*`);
  return lexemes.length === 0 ? null : lexemes.join(' | ');
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
 * tsquery operator, a wildcard or a quote. `tsqueryFor` applies the same
 * whitelist again rather than trusting that.
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

  // One indexed column covers what four ILIKEs and an unnest used to: the
  // trigger in 0015 keeps `search_vector` over title, description, recipient,
  // region and tags together.
  const tsquery = tsqueryFor(terms);
  if (tsquery !== null) {
    clauses.push(`a.search_vector @@ to_tsquery('english', ${bind(tsquery)})`);
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
  if (searchable(terms).length === 0) {
    return { awards: [], capped: false };
  }

  const where = buildWhere(terms, filters);
  // BY RELEVANCE, then by date.
  //
  // This ordered by `awarded_on` alone, and the limit below is what made that
  // a fault rather than a preference: a search matching 284 grants handed the
  // ranker the NEWEST 120 of them, which is an arbitrary sample with respect
  // to how well any of them matched. Ten of the forty-nine grants actually
  // titled "Youth skills programme" never reached the page for a search for
  // youth skills, while seven chapel-roof grants did.
  //
  // `ts_rank` reads the weights 0020 put on the vector, so a title match
  // counts for about ten times a recipient-name match. Date remains the
  // tie-break, because among equally good matches the recent one is the
  // better lead.
  // The ranking needs the same query the predicate used. `buildWhere` has
  // taken $1..$n, so the query is $n+1 and the limit $n+2.
  const queryAt = where.values.length + 1;
  const { rows } = await tx.query<Row>(
    `${SELECT}
      WHERE ${where.sql}
      ORDER BY ts_rank(a.search_vector, to_tsquery('english', $${queryAt})) DESC,
               a.awarded_on DESC NULLS LAST, a.amount_gbp DESC
      LIMIT $${queryAt + 1}`,
    [...where.values, tsqueryFor(terms), limit + 1],
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
 * The options worth offering, plus the ones already chosen.
 *
 * Dropping the zeroes is what keeps the row short and keeps every chip a real
 * move — an option that would leave nothing is not an option, and that is the
 * whole reason the counts are computed at all.
 *
 * **A CHOSEN option is exempt, whatever its count.** It used not to be, and
 * the result was a filter that was active and invisible at the same time:
 * pick a band no matching grant falls in and its own count is zero, so the
 * chip vanished while the header went on saying "narrowed by 1 filter — tap a
 * filter again to remove it". There was nothing left to tap. The empty-result
 * card then said "remove one and the counts will show you what is there", of
 * a screen with no removable filter on it, and the only way out was Clear,
 * which throws away every choice rather than the one that emptied the page.
 *
 * A control is the only handle on the state it created. It has to stay on the
 * screen for as long as that state does, and reading zero is exactly the
 * information the person needs.
 *
 * `chosen` values absent from `options` are appended rather than merely kept,
 * because place and topic options come from a GROUP BY over the matching rows
 * — a chosen place that matches nothing is not in the result at all, so there
 * is no zero to preserve and one has to be supplied.
 */
function offer(options: FacetOption[], chosen: readonly string[]): FacetOption[] {
  const kept = options.filter((option) => option.count > 0 || chosen.includes(option.value));
  const present = new Set(kept.map((option) => option.value));
  const missing = chosen
    .filter((value) => !present.has(value))
    .map((value) => ({ value, label: value, count: 0 }));
  return [...kept, ...missing];
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
  if (searchable(terms).length === 0) {
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
    // Amount and recency map over the domain's own lists, so a chosen option
    // reading zero keeps its place in the scale rather than moving to the end.
    amount: offer(
      AMOUNT_BANDS.map((band) => ({
        value: band.id,
        label: band.label,
        count: counted('amount', band.id),
      })),
      filters.bands,
    ),
    since: offer(
      RECENCY.map((option) => ({
        value: option.id,
        label: option.label,
        count: counted('since', option.id),
      })),
      filters.since === null ? [] : [filters.since],
    ),
    place: offer(
      rows
        .filter((row) => row.dim === 'place' && row.value !== null)
        .map((row) => ({ value: row.value as string, label: row.value as string, count: row.n })),
      filters.places,
    ),
    topic: offer(
      rows
        .filter((row) => row.dim === 'topic' && row.value !== null)
        .map((row) => ({ value: row.value as string, label: row.value as string, count: row.n })),
      filters.topics,
    ),
    total: rows.find((row) => row.dim === 'total')?.n ?? 0,
  };
}


export interface FunderExample {
  id: string;
  title: string | null;
  description: string | null;
  recipientName: string | null;
  amountGbp: number;
  awardedOn: string;
  region: string | null;
}

export interface FunderSummary {
  funderId: string;
  funderName: string;
  funderWebsite: string | null;
  /** Grants of theirs matching the search and filters — not their whole history. */
  matching: number;
  amounts: { min: number; lowerQuartile: number; median: number; upperQuartile: number; max: number };
  firstAwardedOn: string | null;
  lastAwardedOn: string | null;
  /** Of the matching grants, how many went to the applicant's own area. */
  inYourRegion: number;
  /** The label they use most often across the matching grants. */
  commonTag: string | null;
  /** The most recent matching grants, for the expanded view. */
  examples: FunderExample[];
}

/** Funders on one screen. More than this is a list nobody reads. */
const FUNDER_LIMIT = 40;
/** Grants shown inside one funder before "see them all". */
const EXAMPLES_PER_FUNDER = 3;

/**
 * The matching grants, grouped by who gave them.
 *
 * ## Why this view exists
 *
 * An applicant's question is not "which grants mention youth work", it is "who
 * would fund us, and for how much". Twenty grant rows from one foundation
 * answer that worse than one line saying *18 grants like yours, typically
 * £10,000–£35,000, last gave March 2025, 6 of them in Somerset* — because the
 * decision being made is about a funder, and a list of grants makes the reader
 * do the grouping in their head.
 *
 * ## Statistics over the MATCHING grants
 *
 * Not over the funder's whole history, deliberately. "What do they give for
 * work like ours" is a different and more useful question than "what do they
 * give", and it is the one a search has already framed. The count is stated
 * next to the figures so nobody mistakes a median of three grants for a
 * policy — and `src/domain/funder/behaviour.ts` already holds the rule about
 * how many awards it takes before a median means anything.
 *
 * ## Two queries, not forty-one
 *
 * One grouped aggregate over the whole matched set, then one windowed query for
 * the few example grants per funder on screen. Doing the examples per funder
 * would be a query per row.
 */
export async function funderSummaries(
  tx: Queryable,
  terms: readonly string[],
  filters: GrantFilters,
  options: { region?: string | null; limit?: number } = {},
): Promise<FunderSummary[]> {
  if (searchable(terms).length === 0) return [];

  const limit = options.limit ?? FUNDER_LIMIT;
  const region = options.region?.trim() ?? '';
  const where = buildWhere(terms, filters);
  const values = [...where.values];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  // An empty region must count zero, not everything: `ILIKE '%%'` matches
  // every row, which would have told every applicant that every funder works
  // in their area.
  const regionPattern = bind(region === '' ? null : `%${escapeLike(region)}%`);
  const limitAt = bind(limit);

  const { rows } = await tx.query<{
    funder_id: string;
    funder_name: string;
    funder_website: string | null;
    matching: number;
    amount_min: string;
    amount_q1: string;
    amount_median: string;
    amount_q3: string;
    amount_max: string;
    first_awarded_on: string | null;
    last_awarded_on: string | null;
    in_region: number;
    common_tag: string | null;
  }>(
    `SELECT a.funder_id,
            f.name    AS funder_name,
            f.website AS funder_website,
            count(*)::int                                                    AS matching,
            min(a.amount_gbp)::text                                          AS amount_min,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY a.amount_gbp)::text AS amount_q1,
            percentile_cont(0.5)  WITHIN GROUP (ORDER BY a.amount_gbp)::text AS amount_median,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY a.amount_gbp)::text AS amount_q3,
            max(a.amount_gbp)::text                                          AS amount_max,
            min(a.awarded_on)::text                                          AS first_awarded_on,
            max(a.awarded_on)::text                                          AS last_awarded_on,
            count(*) FILTER (
              WHERE ${regionPattern}::text IS NOT NULL AND a.region ILIKE ${regionPattern}
            )::int                                                           AS in_region,
            (SELECT t FROM funder_awards b, unnest(b.tags) AS t
               WHERE b.funder_id = a.funder_id AND t <> ''
               GROUP BY t ORDER BY count(*) DESC, t LIMIT 1)                 AS common_tag
       FROM funder_awards a
       JOIN funders f ON f.id = a.funder_id
      WHERE ${where.sql}
      GROUP BY a.funder_id, f.name, f.website
      -- Repeated giving first, then recency. Both are evidence rather than
      -- preference, and both are things the screen can state in a sentence.
      ORDER BY count(*) DESC, max(a.awarded_on) DESC NULLS LAST, f.name
      LIMIT ${limitAt}`,
    values,
  );

  if (rows.length === 0) return [];

  const examples = await funderExamples(
    tx,
    terms,
    filters,
    rows.map((row) => row.funder_id),
  );

  return rows.map((row) => ({
    funderId: row.funder_id,
    funderName: row.funder_name,
    funderWebsite: row.funder_website,
    matching: row.matching,
    amounts: {
      min: Number(row.amount_min),
      lowerQuartile: Number(row.amount_q1),
      median: Number(row.amount_median),
      upperQuartile: Number(row.amount_q3),
      max: Number(row.amount_max),
    },
    firstAwardedOn: row.first_awarded_on,
    lastAwardedOn: row.last_awarded_on,
    inYourRegion: row.in_region,
    commonTag: row.common_tag,
    examples: examples.get(row.funder_id) ?? [],
  }));
}

/**
 * A few of each funder's matching grants, in one query.
 *
 * A window function rather than a query per funder: forty funders on screen
 * would otherwise be forty-one round trips, and the evidence a person actually
 * reads is two or three grants apiece.
 */
async function funderExamples(
  tx: Queryable,
  terms: readonly string[],
  filters: GrantFilters,
  funderIds: readonly string[],
): Promise<Map<string, FunderExample[]>> {
  const where = buildWhere(terms, filters);
  const values = [...where.values, funderIds, EXAMPLES_PER_FUNDER];
  const idsAt = `$${values.length - 1}`;
  const perFunderAt = `$${values.length}`;

  const { rows } = await tx.query<{
    id: string;
    funder_id: string;
    title: string | null;
    description: string | null;
    recipient_name: string | null;
    amount_gbp: string | null;
    awarded_on: string | null;
    region: string | null;
  }>(
    `WITH ranked AS (
       SELECT a.id, a.funder_id, a.title, a.description, a.recipient_name,
              a.amount_gbp::text AS amount_gbp, a.awarded_on::text AS awarded_on, a.region,
              row_number() OVER (
                PARTITION BY a.funder_id
                ORDER BY a.awarded_on DESC NULLS LAST, a.amount_gbp DESC
              ) AS rank
         FROM funder_awards a
        WHERE ${where.sql} AND a.funder_id = ANY (${idsAt}::text[])
     )
     SELECT id, funder_id, title, description, recipient_name, amount_gbp, awarded_on, region
       FROM ranked WHERE rank <= ${perFunderAt}`,
    values,
  );

  const byFunder = new Map<string, FunderExample[]>();
  for (const row of rows) {
    if (row.awarded_on === null) continue;
    const list = byFunder.get(row.funder_id) ?? [];
    list.push({
      id: row.id,
      title: row.title,
      description: row.description,
      recipientName: row.recipient_name,
      amountGbp: Number(row.amount_gbp ?? 0),
      awardedOn: row.awarded_on,
      region: row.region,
    });
    byFunder.set(row.funder_id, list);
  }
  return byFunder;
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
