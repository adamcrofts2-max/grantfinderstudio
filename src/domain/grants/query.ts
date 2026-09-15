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

export interface Rankable {
  title: string | null;
  description: string | null;
  recipientName: string | null;
  region: string | null;
  amountGbp: number;
}

export interface RankContext {
  terms: readonly string[];
  region: string | null;
  amountSoughtGbp: number | null;
}

/**
 * Whether a term appears, allowing for the plural.
 *
 * `includes` alone is asymmetric, and the asymmetry began to matter when the
 * database search became full-text (migration 0015). Postgres stems, so a
 * search for "youths" now MATCHES a grant that says "youth" — and then this
 * function scored that grant zero and sorted it below rows that matched
 * nothing at all, because "youth" does not contain "youths". A row the query
 * returned and the ranking cannot see is worse than a row that was never
 * returned: it looks like the ordering is random.
 *
 * Trailing "s" both ways covers it. The other direction is already free —
 * a haystack of "youths" contains "youth". This is not a stemmer and is not
 * trying to be one; it closes the one gap that English plurals actually open,
 * and it can be read in a line.
 */
function matches(haystack: string, term: string): boolean {
  if (haystack.includes(term)) return true;
  return term.endsWith('s') && term.length > 3 && haystack.includes(term.slice(0, -1));
}

/**
 * How well one grant answers the search, 0 upwards.
 *
 * Deliberately a small integer built from countable things rather than a
 * weighted float: every point corresponds to something the screen can state
 * in a sentence, so an applicant can see why a row is where it is. A score
 * nobody can check is worse than no ordering at all.
 */
export function relevance(grant: Rankable, context: RankContext): number {
  const haystack = [grant.title, grant.description, grant.recipientName]
    .filter((part): part is string => part !== null)
    .join(' ')
    .toLowerCase();

  let score = 0;
  for (const term of context.terms) {
    if (matches(haystack, term)) score += 2;
  }

  const region = context.region?.trim().toLowerCase();
  if (region !== undefined && region !== '' && grant.region !== null) {
    if (grant.region.toLowerCase().includes(region)) score += 3;
  }

  const ask = context.amountSoughtGbp;
  if (ask !== null && ask > 0) {
    const ratio = grant.amountGbp / ask;
    if (ratio >= 0.5 && ratio <= 2) score += 2;
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
