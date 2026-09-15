/**
 * Narrowing a grant search, and what to offer as the ways to narrow it.
 *
 * ## Why not a list of checkboxes
 *
 * The obvious design — a column of topic checkboxes — cannot work on this
 * data, and the reason is in the data rather than in the taste.
 *
 * A grant's `tags` are its publisher's own `classifications[].title`, free
 * text, chosen independently by two hundred-odd publishers. "Young people",
 * "Youth", "Children & young people" and "Children and Young People" are four
 * labels for one idea and all four are in the corpus. `region` is the same: a
 * county from one publisher, a city from the next, a ward from the third. A
 * fixed checkbox list over that is unusable; a curated taxonomy on top of it
 * would be us inventing categories the data does not have, and then quietly
 * mis-filing grants into them.
 *
 * So the options are DERIVED FROM THE RESULTS somebody is looking at, and each
 * one carries a count. You are shown the eight topics that actually occur in
 * your results, not four hundred that might; and because every option says how
 * many grants it would leave, you can never tick one and get nothing. A filter
 * with no count is a trap.
 *
 * ## Why these dimensions
 *
 * Phrased as the decisions a CIC is actually making, not as the attributes a
 * row happens to have:
 *
 *  - **Amount.** The strongest signal there is. Somebody who needs £15,000 is
 *    not helped by capital grants of £2m, however well the words match.
 *  - **Still giving.** A funder whose last published grant was in 2018 is not
 *    a prospect. Recency is a property of the grant and a verdict on the
 *    funder.
 *  - **Place.** Most UK grant-making is geographically restricted, so this is
 *    often the difference between eligible and not.
 *  - **Topic**, last, because it is the least reliable field of the four.
 *
 * Amount is offered as BANDS rather than a slider. Grant sizes are log-scaled
 * — £1k to £2m in one corpus — so a linear slider spends nine tenths of its
 * travel on the last tenth of the data, and offers a precision ("£17,400")
 * that means nothing. Bands are how funders themselves talk about size.
 */

export interface AmountBand {
  id: string;
  label: string;
  /** Inclusive. */
  min: number;
  /** Exclusive; null for the open-ended top band. */
  max: number | null;
}

export const AMOUNT_BANDS: readonly AmountBand[] = [
  { id: 'under5k', label: 'Under £5,000', min: 0, max: 5_000 },
  { id: '5k-25k', label: '£5,000–£25,000', min: 5_000, max: 25_000 },
  { id: '25k-100k', label: '£25,000–£100,000', min: 25_000, max: 100_000 },
  { id: '100k-500k', label: '£100,000–£500,000', min: 100_000, max: 500_000 },
  { id: 'over500k', label: 'Over £500,000', min: 500_000, max: null },
] as const;

export function bandById(id: string): AmountBand | null {
  return AMOUNT_BANDS.find((band) => band.id === id) ?? null;
}

export function bandFor(amountGbp: number): AmountBand | null {
  return (
    AMOUNT_BANDS.find(
      (band) => amountGbp >= band.min && (band.max === null || amountGbp < band.max),
    ) ?? null
  );
}

export interface RecencyOption {
  id: string;
  label: string;
  years: number;
}

/**
 * How recently the money was given.
 *
 * Two years is the "still giving" line because a grant programme that has not
 * paid out in two years has usually either closed or changed. Five is there
 * for a CIC in a thin field who would rather see a stale funder than nothing.
 */
export const RECENCY: readonly RecencyOption[] = [
  { id: '2y', label: 'Gave in the last 2 years', years: 2 },
  { id: '5y', label: 'Gave in the last 5 years', years: 5 },
] as const;

export function recencyById(id: string): RecencyOption | null {
  return RECENCY.find((option) => option.id === id) ?? null;
}

export interface GrantFilters {
  /** Amount band ids. Several means "any of these". */
  bands: readonly string[];
  /** A recency option id, or null. Only one can apply. */
  since: string | null;
  /** Place names, matched as substrings of the grant's region. */
  places: readonly string[];
  /** Publisher classification labels, matched exactly. */
  topics: readonly string[];
}

export const NO_FILTERS: GrantFilters = { bands: [], since: null, places: [], topics: [] };

export function hasFilters(filters: GrantFilters): boolean {
  return (
    filters.bands.length > 0 ||
    filters.since !== null ||
    filters.places.length > 0 ||
    filters.topics.length > 0
  );
}

/** How many separate choices are in force, for a "clear all (3)" affordance. */
export function filterCount(filters: GrantFilters): number {
  return (
    filters.bands.length +
    (filters.since === null ? 0 : 1) +
    filters.places.length +
    filters.topics.length
  );
}

const MAX_VALUES_PER_DIMENSION = 6;

function readMany(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw.flatMap((v) => v.split('~'))) {
    const trimmed = entry.trim();
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_VALUES_PER_DIMENSION) break;
  }
  return out;
}

/**
 * Filters from the query string.
 *
 * In the URL, not in component state, and that is the reason chips are LINKS
 * rather than checkboxes: the back button works, a narrowed search can be sent
 * to a colleague, and the page needs no client-side JavaScript to filter at
 * all. A checkbox needs either a submit button or a script; a toggle link is
 * one tap on a phone and already shareable.
 *
 * Unknown ids are dropped rather than rejected. A stale link should show
 * something useful, not an error about a band that was renamed.
 */
export function filtersFromParams(
  params: Record<string, string | string[] | undefined>,
): GrantFilters {
  const since = readMany(params['since'])[0] ?? null;
  return {
    bands: readMany(params['amount']).filter((id) => bandById(id) !== null),
    since: since !== null && recencyById(since) !== null ? since : null,
    places: readMany(params['place']),
    topics: readMany(params['topic']),
  };
}

/** The query string for a set of filters, stable so links do not churn. */
export function filtersToParams(filters: GrantFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.bands.length > 0) params['amount'] = filters.bands.join('~');
  if (filters.since !== null) params['since'] = filters.since;
  if (filters.places.length > 0) params['place'] = filters.places.join('~');
  if (filters.topics.length > 0) params['topic'] = filters.topics.join('~');
  return params;
}

export type Dimension = 'amount' | 'since' | 'place' | 'topic';

/**
 * The same filters with one value toggled.
 *
 * `since` replaces rather than accumulates: "gave in the last 2 years" and
 * "in the last 5" are not two filters, they are one answer, and holding both
 * would mean the wider one silently winning.
 */
export function toggle(
  filters: GrantFilters,
  dimension: Dimension,
  value: string,
): GrantFilters {
  const flip = (current: readonly string[]): string[] =>
    current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value].slice(0, MAX_VALUES_PER_DIMENSION);

  switch (dimension) {
    case 'amount':
      return { ...filters, bands: flip(filters.bands) };
    case 'place':
      return { ...filters, places: flip(filters.places) };
    case 'topic':
      return { ...filters, topics: flip(filters.topics) };
    case 'since':
      return { ...filters, since: filters.since === value ? null : value };
  }
}

export function isActive(filters: GrantFilters, dimension: Dimension, value: string): boolean {
  switch (dimension) {
    case 'amount':
      return filters.bands.includes(value);
    case 'place':
      return filters.places.includes(value);
    case 'topic':
      return filters.topics.includes(value);
    case 'since':
      return filters.since === value;
  }
}

/**
 * Filters with one dimension cleared.
 *
 * Which is how a count is made honest. An option's count has to answer "how
 * many would I get if I picked this", so it is computed with every OTHER
 * dimension still applied and its own dimension released — otherwise ticking
 * one amount band would show every other band as zero, and the screen would
 * look like a dead end when it is one tap from being useful.
 */
export function without(filters: GrantFilters, dimension: Dimension): GrantFilters {
  switch (dimension) {
    case 'amount':
      return { ...filters, bands: [] };
    case 'place':
      return { ...filters, places: [] };
    case 'topic':
      return { ...filters, topics: [] };
    case 'since':
      return { ...filters, since: null };
  }
}

/**
 * A band around what the applicant said they need.
 *
 * Offered as one tap — "about what we need" — because it is the filter most
 * people want first and the least likely to be assembled correctly by hand.
 * Half to double the ask: a funder who gives £8,000 is worth reading for a CIC
 * asking £15,000, and one who gives £400,000 is not.
 */
export function bandsAroundAsk(amountSoughtGbp: number | null): string[] {
  if (amountSoughtGbp === null || amountSoughtGbp <= 0) return [];
  const low = amountSoughtGbp / 2;
  const high = amountSoughtGbp * 2;
  return AMOUNT_BANDS.filter(
    (band) => band.min <= high && (band.max === null || band.max > low),
  ).map((band) => band.id);
}
