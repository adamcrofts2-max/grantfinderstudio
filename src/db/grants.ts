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
import { RELEVANCE_FLOOR } from '../domain/grants/query.js';

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
  /**
   * How well this grant matches the words typed, 0–1.
   *
   * A fraction of the best score anything could get for those words — see
   * `textSearch` and `RELEVANCE_FLOOR`. Null when there was no search to be
   * relevant to, which is the "most recent grants" screen.
   *
   * Carried out of the database rather than recomputed in `relevance()`
   * because only the database knows how rare each word is, and a screen that
   * ordered results by a second, worse opinion of relevance than the one the
   * count came from would be back to the fault this replaced.
   */
  textScore: number | null;
}

interface Row {
  id: string;
  /** Only on a search; `recentAwards` has no query to be relevant to. */
  text_score?: string | null;
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

/**
 * The columns a grant row carries, and the tables behind them.
 *
 * Split in two so a caller can add a column of its own — `searchAwards` adds
 * the relevance score, which is an expression over the CTEs rather than a
 * column of any table.
 */
const SELECT = `
  SELECT a.id, a.funder_id, f.name AS funder_name, f.website AS funder_website,
         a.recipient_name, a.title, a.amount_gbp::text AS amount_gbp,
         a.awarded_on::text AS awarded_on, a.description,
         a.jurisdiction, a.region, a.tags, d.attribution, d.licence`;

const FROM = `
    FROM funder_awards a
    JOIN funders f ON f.id = a.funder_id
    LEFT JOIN source_datasets d ON d.id = a.source_dataset_id`;

const SELECT_FROM = `${SELECT}${FROM}`;

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
    textScore: row.text_score == null ? null : Number(row.text_score),
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

/**
 * One term's lexeme, read out of the single bound array.
 *
 * Subscripting `$1` rather than binding each lexeme again: the score names
 * individual terms and the predicate names the whole query, and binding the
 * same strings twice is a way for the two to end up describing different
 * searches. One parameter, so filter binds still start at `$2`.
 */
const at = (index: number): string => `($1::text[])[${index + 1}]`;

export interface TextSearch {
  /** The lexemes, bound as `$1`. Filter binds start at `$2`. */
  values: [string[]];
  /** How well one row matches, 0–1: a fraction of the best a row could do. */
  score: string;
  /** Matches the query, and is close enough to it to count. */
  where: string;
  /** Each word and how many grants in the corpus contain it. */
  coverage: { term: string; matches: number }[];
}

/**
 * The text half of a search: the query, how well a row matches it, and the
 * floor under that.
 *
 * ## The fault this replaced
 *
 * Every word counted the same, and a floor per word meant a grant counted if
 * it was a close match on ANY ONE of them. A user searched
 *
 *     community tree nursery somerset
 *
 * and got 218 of 464 grants — 47% of everything held — led by twenty-two
 * chapel roof repairs. Measured, the reason is stark:
 *
 * ```
 *   community   218 matches   47.0% of the corpus   best rank 0.67 (a title)
 *   tree         42 matches    9.1%                 best rank 0.64
 *   nursery      20 matches    4.3%                 best rank 0.61
 *   somerset     19 matches    4.1%                 best rank 0.06 (a region)
 * ```
 *
 * The returned count was 218, which is exactly the number matching
 * `community` — one word, the least informative in the query, carried the
 * whole result, and "Community tree nursery" was seventh in it. The words that
 * MEAN something there are `tree` and `nursery`, and nothing in the ranking
 * knew that.
 *
 * ## Why Postgres cannot do this alone
 *
 * `ts_rank` has no corpus statistics. It knows where in a document a word
 * appeared and at what weight, and nothing about how many other documents
 * contain it — so it cannot tell a word that narrows a search from one that
 * does not, and "community" in a corpus of community grants is barely a word.
 *
 * ## What a term's contribution accounts for
 *
 *     contribution = idf(term) × ts_rank(row, term) / best_rank(term)
 *
 * **How rare the word is.** `idf = ln(1 + N / (1 + df))`, the standard
 * smoothed inverse document frequency. On the corpus above: community 1.14,
 * tree 2.47, nursery 3.14, somerset 3.19 — a nursery worth nearly three
 * communities, which is the judgement a reader would make.
 *
 * **NORMALISED against what that term can achieve.** Dividing by the term's
 * own best rank stops the field weights distorting the comparison. A county
 * only appears in the region field, which 0020 weights D, so `somerset` tops
 * out at 0.06 where a title word reaches 0.67 — and an un-normalised sum would
 * give a rare place name a tenth of the weight of a common title word, however
 * informative. Normalised, each term contributes between nothing and its idf.
 *
 * A row's score is the sum over terms, as a fraction of the sum of every
 * term's idf — the score a row would get by matching every word as well as
 * anything in the corpus does. It counts at `RELEVANCE_FLOOR` of that.
 *
 * ## One formula, where three rules used to be
 *
 * ```
 *                                          before   after   of the corpus
 *   community tree nursery somerset          218      39      47% -> 8%
 *   mental health young people               241     106      52% -> 23%
 *   community allotment growing              108      40      23% -> 9%
 *   youth        (recipient-name noise)       90      21       unchanged
 *   somerset     (a place on its own)         19      19       all of them
 *   youth skills somerset                     39      39       unchanged
 * ```
 *
 * The recipient-name cut, the place search and the common-word flood are one
 * problem seen three ways — how much a word tells you, and how well this row
 * matches it.
 *
 * ## Why the weights are computed HERE and not in the statement
 *
 * They were a CTE, and the score was a correlated subquery over it. Measured
 * at 59,392 grants that cost the page 453 ms → 1,230 ms, and an eight-word
 * query 1.1 s → 7.0 s, because `facetsFor` evaluates the predicate a dozen
 * times, once per facet option, and each evaluation walked the CTE for every
 * candidate row.
 *
 * A term's weight is a constant for the whole query. So it is computed once,
 * in one round trip, and inlined as a number — leaving the per-row path as
 * plain arithmetic over `ts_rank` calls, which is the irreducible part.
 *
 * ONE scope is built per page and passed to all four statements. They take a
 * `TextSearch` they cannot construct themselves, so they cannot disagree about
 * what the words are worth — the property the CTE was there to guarantee, kept
 * by the type system instead of by a repeated query.
 */
export async function textSearch(
  tx: Queryable,
  terms: readonly string[],
): Promise<TextSearch | null> {
  const words = searchable(terms);
  if (words.length === 0) return null;
  const lexemes = words.map((term) => `${term}:*`);

  const { rows } = await tx.query<{ term: string; df: string; best: string; idf: string }>(
    `SELECT q.term,
            count(b.id)::text AS df,
            coalesce(max(ts_rank(b.search_vector, to_tsquery('english', q.term))), 0)::text AS best,
            ln(1 + (SELECT count(*)::numeric FROM funder_awards)
                     / (1 + count(b.id)))::text AS idf
       FROM unnest($1::text[]) AS q(term)
       LEFT JOIN funder_awards b ON b.search_vector @@ to_tsquery('english', q.term)
      GROUP BY q.term`,
    [lexemes],
  );

  const byTerm = new Map(rows.map((row) => [row.term, row]));
  /** Terms nothing matches contribute nothing, and cannot be divided by. */
  const scoring = lexemes
    .map((lexeme, index) => {
      const row = byTerm.get(lexeme);
      const best = Number(row?.best ?? 0);
      const idf = Number(row?.idf ?? 0);
      return { lexeme, index, weight: best > 0 ? idf / best : 0, idf: best > 0 ? idf : 0 };
    })
    .filter((term) => term.weight > 0);

  const achievable = scoring.reduce((sum, term) => sum + term.idf, 0);

  // `$1` is the array; each term's own lexeme is at $2+index for the
  // `ts_rank` calls. The weights are numbers this function computed, formatted
  // to a fixed precision — there is nothing here a person typed.
  const sum =
    scoring.length === 0
      ? '0'
      : scoring
          .map(
            (term) =>
              `ts_rank(a.search_vector, to_tsquery('english', ${at(term.index)}))` +
              ` * ${term.weight.toFixed(6)}`,
          )
          .join(' + ');
  const score =
    achievable > 0 ? `((${sum}) / ${achievable.toFixed(6)})` : '0';

  return {
    values: [lexemes],
    score,
    // The whole query first, so the GIN index drives the scan rather than the
    // score having to. `array_to_string` rather than another bound parameter:
    // the lexemes and the query they form cannot then disagree.
    where: `a.search_vector @@ to_tsquery('english', array_to_string($1::text[], ' | '))
        AND ${score} >= ${RELEVANCE_FLOOR}`,
    coverage: words.map((term, index) => ({
      term,
      matches: Number(byTerm.get(lexemes[index] as string)?.df ?? 0),
    })),
  };
}

/**
 * The WHERE clause for a search, assembled from the filters.
 *
 * Built here rather than inlined so that the page query and every facet count
 * are provably the same predicate. They have to be: a count that came from a
 * different WHERE than the list is a lie with a number on it.
 *
 * The text part comes in whole from `textSearch`, so every statement that
 * carries its CTE and calls this asks the same question. `startAt` is where
 * this clause's own binds begin, which is after the text's own values and
 * after anything an enclosing statement has already bound.
 *
 * Returns SQL with `$n` placeholders and the values to bind, so nothing a
 * person typed is ever concatenated into the statement.
 */
function buildWhere(
  text: TextSearch,
  filters: GrantFilters,
  startAt: number,
): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${startAt + values.length}`;
  };

  // One indexed column covers what four ILIKEs and an unnest used to: the
  // trigger in 0015 keeps `search_vector` over title, description, recipient,
  // region and tags together. The floor rides along with it, rather than
  // living in the one query that lists grants: a count that came from a looser
  // predicate than the list is a lie with a number on it.
  const clauses: string[] = [`(${text.where})`];

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

  if (filters.recipient !== null && filters.recipient.trim() !== '') {
    // ONE organisation's grants, from a peer row. Compared on the same fold
    // the peer view groups by — see `recipientKey` — because a row that links
    // to a filter which normalises differently answers "no grants" for grants
    // the page has just counted.
    clauses.push(`${recipientKey('a.recipient_name')} = ${bind(filters.recipient.trim())}`);
  }

  // No `TRUE` fallback. There used to be one, for the case where no clause
  // applied, and a search for `%` reached it and returned the entire corpus as
  // a result. The text clauses above are unconditional now, so the case cannot
  // arise — and if it ever could, an empty result is the honest answer.
  return { sql: clauses.join(' AND '), values };
}

export async function searchAwards(
  tx: Queryable,
  text: TextSearch,
  filters: GrantFilters = NO_FILTERS,
  limit = 120,
): Promise<{ awards: AwardResult[]; capped: boolean }> {
  const where = buildWhere(text, filters, text.values.length);
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
  const values = [...text.values, ...where.values, limit + 1];
  const { rows } = await tx.query<Row>(
    `${SELECT},
            ${text.score} AS text_score
      ${FROM}
      WHERE ${where.sql}
      ORDER BY text_score DESC, a.awarded_on DESC NULLS LAST, a.amount_gbp DESC
      LIMIT $${values.length}`,
    values,
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
  /**
   * Grants close enough to the text to count, and matching every active
   * filter. Not every grant that mentions one of the words: that number was
   * 47% of the corpus and described breadth rather than fit. See
   * `RELEVANCE_FLOOR`.
   */
  total: number;
  /**
   * Each word typed, and how many grants in the whole corpus contain it.
   *
   * Because a word that matches NOTHING is the most useful thing a search can
   * tell you and the one thing it never did. Somebody searched "community tree
   * nursery somerset" on a corpus holding no nurseries at all, got 47% of
   * everything back, and had no way to know that their most specific word was
   * the one doing nothing. Counted over the corpus rather than the result, so
   * it separates "we hold none of these" from "your filters removed them".
   */
  terms: { term: string; matches: number }[];
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
  text: TextSearch,
  filters: GrantFilters,
): Promise<Facets> {

  // The text's own values come first, so every predicate below and the floor
  // itself read the same placeholders.
  const values: unknown[] = [...text.values];
  /** One dimension's predicate, with its placeholders numbered for the whole query. */
  const predicate = (dimension: Dimension | null): string => {
    const where = buildWhere(
      text,
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

  // Straight off `search_terms`, which the CTE computed anyway. A word nobody
  // has ever used costs nothing extra to report and is the difference between
  // "these results look odd" and "we hold no grants mentioning nursery".

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
    // Counted when the scope was built, over the whole corpus rather than
    // the result — which is what separates "we hold none of these words" from
    // "your filters removed them".
    terms: text.coverage,
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
  /**
   * Grants of theirs close to the search and matching the filters — not their
   * whole history, and not every grant of theirs that mentions one of the
   * words. The same predicate as the list and the total, which is the only way
   * these three numbers can be read against each other.
   */
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
  text: TextSearch,
  filters: GrantFilters,
  options: { region?: string | null; limit?: number } = {},
): Promise<FunderSummary[]> {
  const limit = options.limit ?? FUNDER_LIMIT;
  const region = options.region?.trim() ?? '';
  const where = buildWhere(text, filters, text.values.length);
  const values: unknown[] = [...text.values, ...where.values];
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
    text,
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
  text: TextSearch,
  filters: GrantFilters,
  funderIds: readonly string[],
): Promise<Map<string, FunderExample[]>> {
  const where = buildWhere(text, filters, text.values.length);
  const values = [...text.values, ...where.values, funderIds, EXAMPLES_PER_FUNDER];
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

export interface RecipientSummary {
  /** The normalised name rows were grouped on, and the row's identity. */
  key: string;
  /** The spelling this organisation uses most often. */
  name: string;
  /** Grants of theirs matching the search — not their whole funding history. */
  matching: number;
  totalGbp: number;
  largestGbp: number;
  medianGbp: number;
  /** How many different funders backed them. The actionable number. */
  funders: number;
  /** A few of those funders by name, most generous first. */
  funderNames: string[];
  /** Where their grants went. Usually one place; occasionally several. */
  regions: string[];
  firstAwardedOn: string | null;
  lastAwardedOn: string | null;
  /** The label most often attached to their grants. */
  commonTag: string | null;
  /** Of their matching grants, how many went to the applicant's own area. */
  inYourRegion: number;
  /**
   * How their typical grant compares with what the applicant is asking for.
   *
   * 0 — about their size (half to double the ask)
   * 1 — a different scale (a fifth to five times)
   * 2 — nothing like it
   * null — the applicant has not said what they are asking for
   *
   * Bands rather than a distance, because the row SAYS which band it is in,
   * and a number nobody can read off the screen is a ranking nobody can
   * check.
   */
  sizeBand: 0 | 1 | 2 | null;
}

/** Organisations on one screen. */
const RECIPIENT_LIMIT = 40;
/** Funders named inside one row before "and N more". */
const FUNDERS_PER_ROW = 4;

/**
 * The matching grants, grouped by WHO RECEIVED THEM.
 *
 * ## Why this view exists
 *
 * Asked for: "be able to search via similar CICs and see the past grants
 * they've been awarded." It is the strongest form of the question the whole
 * screen is titled after — a peer's actual funder list is a template, in a way
 * that a funder's grant list is not. "Bridgetown Food Partnership raised
 * £41,000 from four funders, and here they are" tells a food-bank CIC exactly
 * who to approach next.
 *
 * ## What "similar" can honestly mean here
 *
 * Not a similarity model. We hold almost nothing about a recipient: a name, the
 * regions their grants went to, the labels on those grants, the amounts. There
 * is no sector, no size, no legal form. So this does not claim to find
 * organisations like yours — it groups the grants your SEARCH matched by who
 * got them, and the screen says so: if the search describes your work, these
 * are the bodies funded for it. The condition is stated rather than implied,
 * because a list headed "organisations like yours" that was really "whoever
 * turned up" would be the same overclaim as the count this search has already
 * been through twice.
 *
 * ## Names are the join key, and they are messy
 *
 * 360Giving publishes a recipient id inconsistently, so the name is what there
 * is. "Wells Youth Collective" and "Wells Youth Collective Ltd" are one body
 * filed twice, so grouping on the raw string would split them and halve both
 * their figures. The key is lowercased, stripped of punctuation and of one
 * trailing legal suffix, and the row displays the spelling used most often.
 *
 * What that cannot do, said plainly: two different bodies with the same name
 * merge into one row, a typo splits one body into two, and a second suffix
 * ("Trust Ltd") only loses the first. All three are visible to a reader
 * looking at the row, which is the best available answer while the source
 * publishes no stable id.
 */
/**
 * A recipient's name, folded to one key.
 *
 * ONE definition, used by the peer grouping and by the recipient filter,
 * because they have to agree: the peer view links to `?recipient=<key>`, and a
 * filter that normalised differently would answer "no grants" for a row the
 * same page had just drawn. Punctuation goes first so that "C.I.C." becomes
 * "c i c" and the suffix pattern can see it; the suffix itself goes because
 * "Sowing Roots CIC" and "Sowing Roots Community Interest Company" are one
 * organisation, spelled two ways, in the same corpus.
 */
const recipientKey = (column: string): string =>
  `btrim(regexp_replace(
     regexp_replace(lower(${column}), '[^a-z0-9 ]', ' ', 'g'),
     '\\s+(ltd|limited|plc|llp|cic|c i c|community interest company|cio|charitable incorporated organisation)\\s*$',
     '', 'g'))`;

/**
 * The display name a key stands for, and how many grants it has.
 *
 * `mode()` for the same reason the peer row uses it: several spellings of one
 * organisation, and the commonest is the one to show. Null when the key
 * matches nothing at all, so a stale or hand-edited link says so rather than
 * heading a page with an empty name.
 */
export async function recipientByKey(
  tx: Queryable,
  key: string,
): Promise<{ name: string; grants: number } | null> {
  const trimmed = key.trim();
  if (trimmed === '') return null;
  const { rows } = await tx.query<{ name: string | null; grants: number }>(
    `SELECT mode() WITHIN GROUP (ORDER BY a.recipient_name) AS name,
            count(*)::int AS grants
       FROM funder_awards a
      WHERE ${recipientKey('a.recipient_name')} = $1`,
    [trimmed],
  );
  const row = rows[0];
  if (row === undefined || row.name === null || row.grants === 0) return null;
  return { name: row.name, grants: row.grants };
}

export async function recipientSummaries(
  tx: Queryable,
  text: TextSearch,
  filters: GrantFilters,
  options: { amountSoughtGbp?: number | null; region?: string | null; limit?: number } = {},
): Promise<RecipientSummary[]> {
  const limit = options.limit ?? RECIPIENT_LIMIT;
  const where = buildWhere(text, filters, text.values.length);
  const values: unknown[] = [...text.values, ...where.values];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const ask =
    options.amountSoughtGbp != null && options.amountSoughtGbp > 0
      ? options.amountSoughtGbp
      : null;
  const askAt = bind(ask);
  const region = options.region?.trim() ?? '';
  // An empty region must count zero, not everything: `ILIKE '%%'` matches
  // every row, which would tell every applicant that every peer is local.
  const regionAt = bind(region === '' ? null : `%${escapeLike(region)}%`);
  const limitAt = bind(limit);

  /**
   * ORDERED BY FIT, NOT BY SIZE.
   *
   * It was `ORDER BY sum(amount_gbp) DESC` — most raised first — and a walk
   * showed what that means on a screen headed "organisations like yours": a
   * Somerset CIC asking for £18,000 was shown a body that had raised
   * £2,861,780, "typically £487,710". Sorting by total raised sorts by SIZE,
   * which is the opposite of the question. Worse, the figure beside the name
   * was a number forty times their ask, presented as the typical grant of an
   * organisation like them.
   *
   * Bands first, so that £17,000 and £19,000 do not reorder on noise, then
   * repeat funding, then their own area, then the total. Every key is on the
   * row in words, so the ordering can be checked rather than trusted.
   */
  const band = `CASE
         WHEN ${askAt}::numeric IS NULL THEN 0
         WHEN median BETWEEN ${askAt}::numeric / 2 AND ${askAt}::numeric * 2 THEN 0
         WHEN median BETWEEN ${askAt}::numeric / 5 AND ${askAt}::numeric * 5 THEN 1
         ELSE 2 END`;

  const { rows } = await tx.query<{
    key: string;
    name: string;
    matching: number;
    total_gbp: string;
    largest_gbp: string;
    median_gbp: string;
    funders: number;
    funder_names: string[] | null;
    regions: string[] | null;
    first_awarded_on: string | null;
    last_awarded_on: string | null;
    common_tag: string | null;
    in_region: number;
    size_band: number;
  }>(
    `WITH matched AS (
       SELECT a.recipient_name, a.amount_gbp, a.awarded_on, a.region, a.tags,
              a.funder_id, f.name AS funder_name,
              -- The shared fold (recipientKey in this file, and NO BACKTICKS
              -- in here: this is inside a template literal). The filter behind
              -- the peer rows uses the same one, so a row always links to its
              -- own grants.
              ${recipientKey('a.recipient_name')} AS key
         FROM funder_awards a
         JOIN funders f ON f.id = a.funder_id
        WHERE ${where.sql}
          AND a.recipient_name IS NOT NULL
          AND btrim(a.recipient_name) <> ''),
     grouped AS (
       SELECT key,
            mode() WITHIN GROUP (ORDER BY recipient_name)                     AS name,
            count(*)::int                                                     AS matching,
            sum(amount_gbp)::text                                             AS total_gbp,
            max(amount_gbp)::text                                             AS largest_gbp,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_gbp)           AS median,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_gbp)::text     AS median_gbp,
            count(DISTINCT funder_id)::int                                    AS funders,
            (array_agg(DISTINCT funder_name))[1:${FUNDERS_PER_ROW}]           AS funder_names,
            array_remove(array_agg(DISTINCT region), NULL)                     AS regions,
            min(awarded_on)::text                                             AS first_awarded_on,
            max(awarded_on)::text                                             AS last_awarded_on,
            -- Correlated on the grouping key rather than aggregating the
            -- arrays: array_agg over a text array raises on rows whose arrays
            -- have different lengths, which is most real corpora. (No
            -- backticks in here: this is inside a template literal.)
            (SELECT t FROM matched m, unnest(m.tags) AS t
              WHERE m.key = matched.key AND t <> ''
              GROUP BY t ORDER BY count(*) DESC, t LIMIT 1)                   AS common_tag,
            count(*) FILTER (
              WHERE ${regionAt}::text IS NOT NULL AND region ILIKE ${regionAt}
            )::int                                                            AS in_region
       FROM matched
      WHERE key <> ''
      GROUP BY key)
     SELECT *, ${band}::int AS size_band
       FROM grouped
      ORDER BY ${band}, matching DESC, in_region DESC, total_gbp::numeric DESC, key
      LIMIT ${limitAt}`,
    values,
  );

  return rows.map((row) => ({
    key: row.key,
    name: row.name,
    matching: row.matching,
    totalGbp: Number(row.total_gbp),
    largestGbp: Number(row.largest_gbp),
    medianGbp: Number(row.median_gbp),
    funders: row.funders,
    funderNames: row.funder_names ?? [],
    regions: row.regions ?? [],
    firstAwardedOn: row.first_awarded_on,
    lastAwardedOn: row.last_awarded_on,
    commonTag: row.common_tag,
    inYourRegion: row.in_region,
    sizeBand: ask === null ? null : (Math.min(2, Math.max(0, row.size_band)) as 0 | 1 | 2),
  }));
}

/** The most recent awards held, for a screen that nobody has typed into yet. */
export async function recentAwards(tx: Queryable, limit = 40): Promise<AwardResult[]> {
  const { rows } = await tx.query<Row>(
    `${SELECT_FROM}
      WHERE a.awarded_on IS NOT NULL
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
