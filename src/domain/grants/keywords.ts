/**
 * The words that describe somebody's work, taken from their own description.
 *
 * ## The fault this exists to fix
 *
 * The grant search's first screen searched for the applicant's BENEFICIARY
 * GROUPS and their county, and nothing else. Walked as a community tree
 * nursery in Somerset, the product's own opening question was
 *
 *     young people older people Somerset
 *
 * because those were the two groups the onboarding list let them tick — there
 * is no environmental option in it, and their work is not a beneficiary group.
 * The top funder offered was a youth trust; the woodland funder that had given
 * seventeen tree-nursery grants, five of them in Somerset, was nowhere. The
 * applicant had typed "Community tree nursery" and a sixty-word description of
 * growing native saplings from local seed one screen earlier.
 *
 * So the default question is now asked of the words they used for the WORK,
 * with the beneficiary groups kept as the fallback they always were for a
 * project whose own description says little.
 *
 * ## Why not the whole description
 *
 * Every term in a search carries its own relevance floor and its own cost —
 * an eight-word query already spends about a second in the database. Sixty
 * words would be slower and no better: the words that matter repeat, and the
 * rest are grammar.
 *
 * ## Why frequency rather than a cleverer measure
 *
 * Inverse document frequency is the right way to rank a word's power, and the
 * search already uses it — against the corpus, where the statistics are. Here
 * there is one short document and no corpus, so the only honest signal is
 * that somebody said "trees" three times and "provide" once. Ordering by
 * count and then by where it first appears keeps the applicant's own emphasis.
 */

/**
 * Words that carry no work in a funding description.
 *
 * Deliberately short. A long stop list starts deciding what somebody's work
 * is about — "support", "community" and "people" look like filler and are
 * exactly what half of this sector does, so they stay.
 */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'they', 'them', 'their',
  'our', 'ours', 'we', 'us', 'you', 'your', 'are', 'was', 'were', 'will',
  'would', 'can', 'could', 'has', 'have', 'had', 'been', 'being', 'into',
  'out', 'over', 'under', 'per', 'about', 'than', 'then', 'there', 'here',
  'where', 'when', 'what', 'which', 'who', 'whom', 'how', 'why', 'all', 'any',
  'each', 'every', 'both', 'more', 'most', 'some', 'such', 'only', 'own',
  'same', 'very', 'just', 'also', 'not', 'but', 'because', 'while', 'during',
  'after', 'before', 'between', 'through', 'across', 'within', 'without',
  'new', 'get', 'got', 'make', 'makes', 'made', 'give', 'gives', 'given',
  'need', 'needs', 'needed', 'want', 'wants', 'pay', 'pays', 'paid', 'cost',
  'costs', 'grant', 'grants', 'funding', 'funded', 'fund', 'funds', 'project',
  'projects', 'year', 'years', 'month', 'months', 'week', 'weeks', 'day',
  'days', 'time', 'times', 'part', 'parts', 'well', 'good', 'better', 'best',
  'many', 'much', 'lot', 'lots', 'one', 'two', 'three', 'four', 'five',
  'would', 'like', 'per', 'cent', 'plus', 'etc',
]);

/** The shortest word worth searching for. Two-letter words are grammar. */
const MIN_LENGTH = 3;

/**
 * Content words, most-used first, each once.
 *
 * Hyphens and apostrophes are kept inside a word — "long-term" and
 * "children's" are one word each — and everything else splits.
 */
export function workWords(text: string | null, limit: number): string[] {
  if (text === null) return [];
  const counts = new Map<string, { count: number; first: number }>();
  const tokens = text
    .toLowerCase()
    .replace(/[’']/gu, "'")
    .split(/[^a-z0-9'-]+/u)
    .map((token) => token.replace(/^['-]+|['-]+$/gu, ''));

  tokens.forEach((token, index) => {
    if (token.length < MIN_LENGTH) return;
    if (STOP_WORDS.has(token)) return;
    // A number on its own says nothing searchable; "12,000 saplings" keeps
    // the saplings.
    if (/^[0-9]+$/u.test(token)) return;
    const seen = counts.get(token);
    if (seen === undefined) counts.set(token, { count: 1, first: index });
    else seen.count += 1;
  });

  return [...counts.entries()]
    .toSorted((a, b) => b[1].count - a[1].count || a[1].first - b[1].first)
    .slice(0, Math.max(limit, 0))
    .map(([word]) => word);
}

export interface DefaultSearchInput {
  /** The applicant's own label for the work. The most deliberate words there are. */
  projectName: string | null;
  projectDescription: string | null;
  beneficiaryGroups: readonly string[];
  region: string | null;
}

/** At most this many work words, before the region is added. */
const WORK_LIMIT = 5;
/** Fewer than this from the project's own text and the groups are worth adding. */
const THIN = 2;

/**
 * The search to land somebody on before they have typed anything.
 *
 * Name first, because it is the phrase they chose for the whole thing; then
 * the description's most-repeated words; then, only if that came to almost
 * nothing, the beneficiary groups; then the county.
 *
 * The groups are a fallback rather than a component because they were what
 * made the tree nursery's default search a youth search — and because a
 * project with a real description does not need them: "young people" is in
 * the description of any project that is about young people.
 */
export function defaultSearchText(input: DefaultSearchInput): string {
  const fromName = workWords(input.projectName, 3);
  const fromDescription = workWords(input.projectDescription, WORK_LIMIT).filter(
    (word) => !fromName.includes(word),
  );
  const work = [...fromName, ...fromDescription].slice(0, WORK_LIMIT);

  const parts = [...work];
  if (work.length < THIN) {
    for (const group of input.beneficiaryGroups) {
      const trimmed = group.trim();
      if (trimmed !== '') parts.push(trimmed);
    }
  }
  const region = input.region?.trim() ?? '';
  if (region !== '') parts.push(region);

  return parts.join(' ').trim();
}

/**
 * The work words that actually narrow anything, given the corpus in hand.
 *
 * ## Why this is needed, found by walking
 *
 * "Community tree nursery" yields the words *community, tree, nursery*, and
 * on those the funders page promoted a food-poverty funder into "funded your
 * kind of work" for a tree nursery — because "A community food hub
 * redistributing surplus" contains "community". One word that describes half
 * the sector undoes the whole point of matching on the work.
 *
 * The search already solves this properly, with inverse document frequency
 * computed in the database. Here there is no database — the funders page
 * holds every award in memory and matches in TypeScript — so the same idea is
 * computed over the texts in hand: a word in more than `maxShare` of them is
 * not evidence of anything and is dropped.
 *
 * ## Why a share rather than a stop list
 *
 * Because which words are generic depends on the corpus, not on English.
 * "Community" is noise in UK grant data and would be the whole signal in a
 * corpus of defence contracts. A share adapts; a hand-written list of
 * "obviously generic" words is someone's guess, permanently.
 *
 * ## Why the default is a third, measured rather than guessed
 *
 * On a 470-grant corpus, the share of grants whose text contains each word:
 *
 *     woodland 40%   community 39%   tree 26%   trees 14%
 *     grow 10%       food 10%        nursery 8.5%   native 5.3%
 *
 * A tighter threshold looks more rigorous and is worse: at 15% it throws away
 * *tree* — the single most useful word a tree nursery has — while keeping
 * *grow*, which matched a food-growing funder's grants and put it second on
 * the list. So the ceiling is set where the words that describe a whole
 * sector sit (a third and up) and no tighter, and the work of telling a real
 * match from a coincidental one is done by requiring TWO words rather than by
 * pruning the vocabulary harder.
 *
 * Returns the survivors in the order given. If EVERY word is too common the
 * result is empty, which is the honest answer: an applicant who has described
 * themselves only in words the whole corpus uses has told us nothing to match
 * on, and the beneficiary groups remain the fallback they always were.
 */
/**
 * Fewer texts than this and the share means nothing.
 *
 * At five texts a fifteen-per-cent ceiling is less than one document, so
 * every word that occurs at all is "too common" and the filter drops the lot
 * — which a test caught and a nearly-empty deployment would have suffered in
 * silence. Below this many, nothing is judged.
 */
const ENOUGH_TO_JUDGE = 20;

export function distinctiveWords(
  words: readonly string[],
  texts: readonly string[],
  maxShare = 0.3,
): string[] {
  if (texts.length < ENOUGH_TO_JUDGE) return [...words];
  const lowered = texts.map((text) => text.toLowerCase());
  return words.filter((word) => {
    const needle = word.trim().toLowerCase();
    if (needle.length < MIN_LENGTH) return false;
    let hits = 0;
    for (const text of lowered) if (text.includes(needle)) hits += 1;
    // Strictly more than the share, so a word sitting exactly on it survives.
    return hits / lowered.length <= maxShare;
  });
}
