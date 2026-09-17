/**
 * Turning what somebody typed into a corpus-wide grant search.
 *
 * ## Why this is not just passing the string along
 *
 * The 360Giving Data Store's grant search takes a REGULAR EXPRESSION and runs
 * it over the whole grant JSON, on their servers. Two consequences shape
 * everything here.
 *
 * **A phrase almost never matches.** "youth skills Somerset" as a literal
 * pattern needs those words adjacent in the JSON, which they never are. So the
 * words are joined with alternation — any of them — and the results are then
 * ranked locally by how many actually appear. Broad fetch, precise ordering.
 *
 * **The pattern is executed by somebody else's service.** Metacharacters a
 * person types innocently (`(`, `*`, `+?`) are at best a syntax error and at
 * worst a pathological pattern that costs 360Giving real CPU — and this is an
 * open, unauthenticated API run by a small charity, which is exactly the kind
 * of integration that gets blocked for it.
 *
 * So the tokeniser is the guarantee rather than an escape step: it splits on
 * everything that is not a letter or a digit, so only `[\p{L}\p{N}]+` terms
 * can ever reach the pattern. Nothing to escape, because nothing dangerous
 * survives being read. A sanitiser can be wrong about one character; a
 * whitelist cannot.
 */

/** Words too short or too common to narrow anything. */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'our', 'are', 'was',
  'who', 'has', 'have', 'been', 'their', 'them', 'they', 'grant', 'grants',
  'funding', 'fund', 'funds', 'project', 'projects', 'not', 'you', 'all',
  'any', 'can', 'its', 'per', 'but', 'had', 'were', 'will', 'would',
]);

/** Beyond this the pattern stops narrowing and starts costing them time. */
export const MAX_TERMS = 8;
const MIN_TERM_LENGTH = 3;

/**
 * The significant words of a query, in the order typed.
 *
 * Lowercased, de-duplicated, stop words and very short words dropped. Kept
 * separate from the pattern because ranking needs the terms themselves.
 */
export function queryTerms(text: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < MIN_TERM_LENGTH) continue;
    if (STOP_WORDS.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    terms.push(word);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

/**
 * The pattern to send, or null when there is nothing worth searching for.
 *
 * Null rather than an empty pattern: an empty regex matches every grant in the
 * corpus, which would be a million-row request dressed as a search.
 */
export function searchPattern(text: string): string | null {
  const terms = queryTerms(text);
  if (terms.length === 0) return null;
  return terms.join('|');
}

/**
 * How close a grant has to be to count as a match, as a fraction of the best
 * score anything could get for the same words.
 *
 * ## What the score is
 *
 * Each word contributes `idf(word) × (this row's rank for it / the best rank
 * that word achieves anywhere)`, and the achievable total is the sum of every
 * word's idf. So the fraction is "how much of what these words could tell you
 * does this grant actually satisfy". `textSearch` in `src/db/grants.ts` has
 * the reasoning for both halves.
 *
 * ## Why a fraction and not a rank
 *
 * `ts_rank` is not on a scale anybody can name a constant on: it depends on
 * how many words matched, at which weights, in a document of some length. A
 * fixed floor tuned to one corpus quietly means something else on the next.
 *
 * ## Why a quarter
 *
 * Measured, on a 464-grant corpus, against the four queries that earlier
 * versions of this floor got wrong and the two they got right:
 *
 * ```
 *                                       10%    15%    25%    33%
 *   community tree nursery somerset      85     39     39     30
 *   youth                                80     21     21     21
 *   somerset                             19     19     19     19
 *   youth skills somerset                39     39     39     39
 *   chapel roof repair                   44     44     44     22
 *   mental health young people          205    205    106     69
 * ```
 *
 * At a tenth, "youth" brings back the eighty grants whose only tie to the word
 * is a recipient called a Youth something, and the tree-nursery search still
 * leads with community food hubs. Fifteen per cent fixes both, and everything
 * from there to a quarter gives the same answer on the first five.
 *
 * A quarter rather than fifteen per cent because of the last row: four common
 * words stayed at 44% of the corpus until a quarter, where it halves. Nothing
 * in the first five changes between them, so a quarter is the same answer for
 * less breadth.
 *
 * NOT A THIRD, and the reason is the place search. A county appears only in
 * the region field, so `somerset` contributes its idf and nothing else —
 * 32% of the achievable total in that four-word query, which clears a quarter
 * and fails a third. At a third, typing your own county alongside four other
 * words silently stops finding grants in it, and the count drops from 39 to
 * 30. That is the fault two earlier versions of this constant already had, so
 * the floor stays under the level where a place term stops counting.
 *
 * The consequence to be honest about: a word is worth less the more other
 * words you type, so a grant matching one word of six may fall under the
 * floor. That is the correct reading of a six-word query — and the place
 * facet, which the same predicate feeds, is the way to hold a county
 * regardless.
 */
export const RELEVANCE_FLOOR = 0.25;

export interface Rankable {
  region: string | null;
  amountGbp: number;
  /**
   * How well this grant matches the words typed, 0–1, from the database.
   *
   * Null when there was no search to be relevant to.
   */
  textScore: number | null;
}

export interface RankContext {
  region: string | null;
  amountSoughtGbp: number | null;
}

/**
 * How much the words are worth against how much the applicant is worth.
 *
 * ## Why the text part is not computed here any more
 *
 * It used to be. This function held field weights — title 4, tag 3,
 * description 2, recipient 1 — and counted, for each word, the best field it
 * appeared in. Those numbers were themselves a fix for an earlier version
 * where every field counted the same and a grant to "Wells Youth Collective"
 * for a roof outranked thirty-nine grants titled "Youth skills programme".
 *
 * Counting fields cannot get this right, because it cannot know how much a
 * word NARROWS. `community` and `nursery` both appeared in a title, so both
 * scored 4 — and `community` matched 47% of the corpus while `nursery`
 * matched 4%. A user searching "community tree nursery somerset" got a page
 * of community food hubs, and nothing here could tell the difference.
 *
 * Inverse document frequency is the missing ingredient and it needs the whole
 * corpus to compute, so it belongs in the query that has one. `textScore` is
 * that answer, arriving as a fraction of the best score those words could get
 * — see `textSearch` in `src/db/grants.ts`.
 *
 * What is left here is the two things the DATABASE cannot know, because they
 * are about this applicant rather than about the corpus: whether the grant
 * went to their own area, and whether it is a size this funder actually gives
 * at. The stemming and the field weights that used to live here are the
 * database's now — Postgres stems, and migration 0020 put `setweight` on the
 * vector — which is why the plural helper this file used to carry is gone.
 *
 * ## The scale
 *
 * Text is worth up to `TEXT_WEIGHT`, which is deliberately much larger than
 * either bonus: somebody who typed words wants grants matching those words,
 * and their county is how to order the ones that do rather than a reason to
 * lift the ones that do not. A grant matching 70% of the query beats one
 * matching 30% in their own area at their own size — 14 against 11 — and
 * between two equally good matches, theirs comes first.
 */
const TEXT_WEIGHT = 20;
/** Their area, which is often the difference between eligible and not. */
const REGION_BONUS = 3;
/** A size they actually give at. */
const AMOUNT_BONUS = 2;

export function relevance(grant: Rankable, context: RankContext): number {
  let score = (grant.textScore ?? 0) * TEXT_WEIGHT;

  const region = context.region?.trim().toLowerCase();
  if (region !== undefined && region !== '' && grant.region !== null) {
    if (grant.region.toLowerCase().includes(region)) score += REGION_BONUS;
  }

  const ask = context.amountSoughtGbp;
  if (ask !== null && ask > 0) {
    const ratio = grant.amountGbp / ask;
    if (ratio >= 0.5 && ratio <= 2) score += AMOUNT_BONUS;
  }

  return score;
}

/**
 * Rank, keeping the API's own order as the tie-break.
 *
 * `toSorted` rather than `sort`: the caller's array is the fetched page and
 * mutating it would make a second render of the same data order differently.
 */
export function rankGrants<T extends Rankable>(
  grants: readonly T[],
  context: RankContext,
): T[] {
  const scored = grants.map((grant, index) => ({
    grant,
    score: relevance(grant, context),
    index,
  }));
  return scored
    .toSorted((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.grant);
}
