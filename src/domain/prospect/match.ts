/**
 * Prospect research: which funders have actually funded work like yours.
 *
 * This is the half of "search" that can be built. There is no machine-readable
 * register of open UK trust and foundation calls (PRODUCT_ARCHITECTURE §2.3.1),
 * but there IS a million-grant record of what funders have already done, and
 * that answers a more useful question than a list of open calls would:
 * who has a track record of funding this, at roughly this size, near here.
 *
 * Three honesty rules, all structural rather than left to the interface:
 *
 *   1. No score. Prospects fall into named tiers whose definitions are stated
 *      and countable, exactly as `Recommendation` is a category rather than a
 *      number. A hidden weighting nobody can check is the thing this product
 *      keeps refusing to build.
 *   2. Every tier is earned by evidence the user can look at. A prospect
 *      carries the specific awards that put it there, not a similarity score.
 *   3. Silence about a funder we cannot characterise. Below
 *      MIN_AWARDS_TO_CHARACTERISE the answer is "not enough published grants
 *      to say", never a weak guess.
 *
 * Nothing here predicts that a funder will fund you. It describes what they
 * have done, which is a different claim and the only one the data supports.
 */

import {
  MIN_AWARDS_TO_CHARACTERISE,
  percentile,
  type AmountSummary,
  type Award,
} from '../funder/behaviour.js';
import type { Jurisdiction } from '../types.js';
import { formatDate } from '../time/format.js';

export const PROSPECT_CONSTANTS = {
  /**
   * Months since a funder's most recent published award, beyond which we say
   * so. Three years is long enough to be meaningful and short enough to catch
   * a fund that has quietly closed.
   *
   * It is reported, never used to exclude: publishers update 360Giving at very
   * different rates, so an absence of recent grants can mean the funder
   * stopped publishing rather than stopped giving. That distinction is the
   * user's to make, and they can only make it if we show them the date.
   */
  dormantAfterMonths: 36,
  /** Words too common in classification labels to carry meaning on their own. */
  stopwords: new Set([
    'and', 'the', 'of', 'for', 'in', 'to', 'a', 'an', 'with', 'people', 'other',
    'general', 'support', 'services', 'work', 'community',
  ]),
} as const;

/**
 * Tiers, in the order a person should read them.
 *
 * Each is a statement of fact about published grants, not a judgement about
 * your chances.
 */
export type ProspectTier =
  /** Has funded your cause, in your area. */
  | 'area_and_cause'
  /** Has funded your cause, elsewhere. */
  | 'cause'
  /** Has funded in your area, for other causes. */
  | 'area'
  /** Enough grants to characterise, none of them overlapping with you. */
  | 'no_overlap'
  /** Too few published grants to say anything. */
  | 'not_characterised';

export const TIER_ORDER: readonly ProspectTier[] = [
  'area_and_cause',
  'cause',
  'area',
  'no_overlap',
  'not_characterised',
];

export interface ProspectApplicant {
  jurisdiction: Jurisdiction | null;
  /** County or city, as the applicant describes it. */
  region: string | null;
  beneficiaryGroups: readonly string[];
  /**
   * The words the applicant used for the work itself.
   *
   * Because the beneficiary groups are not what most organisations DO. A
   * community tree nursery ticks "young people" and "the general community" —
   * the onboarding list has nothing else for it — and on the groups alone the
   * strongest prospect on offer was a youth trust, while the woodland funder
   * with seventeen tree-nursery grants was filed under "for other kinds of
   * work". Optional so that a caller with no project still gets the old
   * behaviour rather than an error. See `defaultSearchText`.
   */
  workWords?: readonly string[];
  /** What they are seeking, for amount fit. Null when not yet decided. */
  amountSoughtGbp: number | null;
}

export interface FunderAwards {
  funderId: string;
  funderName: string;
  awards: readonly Award[];
}

export type AmountFit = 'within_typical' | 'below_typical' | 'above_typical' | 'unknown';

export interface Prospect {
  funderId: string;
  funderName: string;
  tier: ProspectTier;
  totalAwards: number;
  /** Awards matching both area and cause. */
  matchingAwards: Award[];
  /**
   * Of those, the ones whose own text is the work the applicant described.
   *
   * The strongest evidence this module can offer, and separate from
   * `matchingAwards` because a label match and a description match are not
   * equal: "Children and young people" is a category, "a community tree
   * nursery growing native saplings" is the same work. The ordering uses it,
   * and the card can say so.
   */
  workAwards: Award[];
  /** How the project's amount sits against this funder's usual range. */
  amountFit: AmountFit;
  /** Null when there are too few awards to characterise. */
  medianAwardGbp: number | null;
  /**
   * The full spread, for the distribution chart. Null for the same reason the
   * median is: below the floor we decline to describe the funder at all, and a
   * chart drawn over three grants would imply a shape that is not there.
   */
  amounts: AmountSummary | null;
  lastAwardedOn: string | null;
  monthsSinceLastAward: number | null;
  /** True when nothing has been published for a long time. Reported, not used to exclude. */
  mayBeDormant: boolean;
  /** Plain English, each line pointing at something countable. */
  reasons: string[];
}

/** Meaningful tokens of a label, lowercased and de-pluralised. */
function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, ' ')
      .trim()
      .split(' ')
      .filter((word) => word.length > 2 && !PROSPECT_CONSTANTS.stopwords.has(word))
      .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word)),
  );
}

/**
 * Whether a funder's classification label describes the same kind of work as
 * one of the applicant's beneficiary groups.
 *
 * Token overlap rather than string equality, because funders publish
 * "Children and young people" where an applicant writes "young people". It is
 * deliberately loose in one direction only: a shared meaningful token is
 * enough, and the user sees the matching grants and can dismiss a bad match in
 * one glance. A missed match costs them a funder they would have wanted.
 */
export function labelsOverlap(a: string, b: string): boolean {
  const left = tokens(a);
  for (const token of tokens(b)) if (left.has(token)) return true;
  return false;
}

/** Region names match loosely, since "Somerset" and "Somerset County" are one place. */
export function regionsMatch(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (left === '' || right === '') return false;
  return left === right || left.includes(right) || right.includes(left);
}

/**
 * Whether this grant is for the kind of work the applicant does.
 *
 * Two ways of being so, and either is enough:
 *
 *   - Its CLASSIFICATION overlaps one of their beneficiary groups. This was
 *     the only test, and it is the weaker one: the labels are a short
 *     published list, so every environmental grant in the corpus says
 *     "Environment" — a word no applicant describes themselves with.
 *   - Its own TEXT contains one of the words they used for their work.
 *     "Community tree nursery" against "a community tree nursery growing
 *     native saplings from locally collected seed" is the match a person
 *     would make in a second, and the label could never make.
 *
 * A single work word is enough, for the reason `labelsOverlap` is loose: the
 * applicant sees the grants behind the claim and can dismiss a bad match at a
 * glance, where a missed match costs them a funder they wanted. The words are
 * already the applicant's own most-repeated few rather than every word in
 * their description, which is what keeps "community" from matching the whole
 * corpus on its own — it is one of five, and the tier is only the first of
 * three orderings.
 */
function matchesLabel(award: Award, groups: readonly string[]): boolean {
  return award.tags.some((tag) => groups.some((group) => labelsOverlap(tag, group)));
}

/**
 * The stronger of the two: the funder's own words for this grant describe the
 * work the applicant described.
 *
 * Kept separate from the label match rather than folded in, because the two
 * are not equal evidence and the ordering needs to know which is which. A
 * youth trust whose grants are labelled "Children and young people"
 * legitimately matches a tree nursery that ticked "young people" — and
 * seventeen such grants outranked the four grants that were literally
 * community tree nurseries until this was pulled apart.
 *
 * ## TWO words, not one
 *
 * One word is a coincidence; two are a description. On "community tree
 * nursery, we grow native trees", a single word was enough to call a
 * food-growing funder's grants "the work you described" — their market garden
 * project says "growing", and that is all it took. A tree nursery grant says
 * tree AND nursery AND usually native or seed; a food project says grow and
 * nothing else of ours. The applicant's own words are already reduced to
 * their most-used few and filtered against the corpus, so requiring two of
 * them is a low bar for a real match and an impossible one for an accident.
 *
 * An applicant whose description yields fewer than two usable words matches
 * nothing here, which is honest: they have not told us enough to match on,
 * and the beneficiary labels remain what they always were.
 */
export const MIN_WORK_MATCHES = 2;

function matchesWorkText(award: Award, workWords: readonly string[]): boolean {
  if (workWords.length < MIN_WORK_MATCHES) return false;
  const text = `${award.title ?? ''} ${award.description ?? ''}`.toLowerCase();
  if (text.trim() === '') return false;
  let hits = 0;
  for (const word of workWords) {
    const needle = word.trim().toLowerCase();
    if (needle.length > 2 && text.includes(needle)) hits += 1;
    if (hits >= MIN_WORK_MATCHES) return true;
  }
  return false;
}

function matchesCause(
  award: Award,
  groups: readonly string[],
  workWords: readonly string[] = [],
): boolean {
  return matchesLabel(award, groups) || matchesWorkText(award, workWords);
}

/** An award in the applicant's own county or city. The stronger claim. */
function matchesRegion(award: Award, applicant: ProspectApplicant): boolean {
  return regionsMatch(award.region, applicant.region);
}

/**
 * An award somewhere the applicant could plausibly be funded from — the same
 * nation, or UK-wide. Weaker than a region match and worded differently,
 * because "they fund in Devon" is not "they fund in your area".
 */
function matchesNation(award: Award, applicant: ProspectApplicant): boolean {
  if (award.jurisdiction === null || applicant.jurisdiction === null) return false;
  return award.jurisdiction === 'uk_wide' || award.jurisdiction === applicant.jurisdiction;
}

function matchesArea(award: Award, applicant: ProspectApplicant): boolean {
  return matchesRegion(award, applicant) || matchesNation(award, applicant);
}

function monthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months;
}

function money(value: number): string {
  return `£${Math.round(value).toLocaleString('en-GB')}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Assess one funder against the applicant.
 *
 * `asOf` is injected so the result is deterministic and a whole page reasons
 * against one date.
 */
export function assessProspect(
  funder: FunderAwards,
  applicant: ProspectApplicant,
  asOf: string,
): Prospect {
  const awards = [...funder.awards].toSorted((a, b) => a.awardedOn.localeCompare(b.awardedOn));
  const last = awards.at(-1) ?? null;
  const monthsSinceLastAward = last === null ? null : monthsBetween(last.awardedOn, asOf);

  const base = {
    funderId: funder.funderId,
    funderName: funder.funderName,
    totalAwards: awards.length,
    lastAwardedOn: last?.awardedOn ?? null,
    monthsSinceLastAward,
    mayBeDormant:
      monthsSinceLastAward !== null &&
      monthsSinceLastAward > PROSPECT_CONSTANTS.dormantAfterMonths,
  };

  if (awards.length < MIN_AWARDS_TO_CHARACTERISE) {
    return {
      ...base,
      tier: 'not_characterised',
      matchingAwards: [],
      workAwards: [],
      amountFit: 'unknown',
      medianAwardGbp: null,
      amounts: null,
      reasons: [
        awards.length === 0
          ? 'They publish no grants at all, so there is nothing to go on.'
          : `Only ${plural(awards.length, 'published grant', 'published grants')} — too few to say anything about what this funder does.`,
      ],
    };
  }

  const sorted = awards.map((a) => a.amountGbp).toSorted((a, b) => a - b);
  const medianAwardGbp = percentile(sorted, 0.5);
  const lower = percentile(sorted, 0.25);
  const upper = percentile(sorted, 0.75);
  const amounts: AmountSummary = {
    min: sorted[0] as number,
    lowerQuartile: lower,
    median: medianAwardGbp,
    upperQuartile: upper,
    max: sorted.at(-1) as number,
  };

  const amountFit: AmountFit =
    applicant.amountSoughtGbp === null
      ? 'unknown'
      : applicant.amountSoughtGbp < lower
        ? 'below_typical'
        : applicant.amountSoughtGbp > upper
          ? 'above_typical'
          : 'within_typical';

  const causeAwards = awards.filter((a) =>
    matchesCause(a, applicant.beneficiaryGroups, applicant.workWords ?? []),
  );
  const workMatches = awards.filter((a) => matchesWorkText(a, applicant.workWords ?? []));
  const areaAwards = awards.filter((a) => matchesArea(a, applicant));
  const bothAwards = causeAwards.filter((a) => areaAwards.includes(a));

  const tier: ProspectTier =
    bothAwards.length > 0
      ? 'area_and_cause'
      : causeAwards.length > 0
        ? 'cause'
        : areaAwards.length > 0
          ? 'area'
          : 'no_overlap';

  const reasons: string[] = [];
  if (bothAwards.length > 0) {
    // Only claim "in your area" for grants actually made in it. A nation-level
    // match is real evidence but a weaker claim, and saying "in your area" of a
    // grant made 80 miles away is the kind of small dishonesty that costs trust
    // the moment someone opens the list and looks.
    const inRegion = bothAwards.filter((a) => matchesRegion(a, applicant));
    // "For the work you described" where the funder's own sentences match it,
    // and "work like yours" where only the classification does. The reader can
    // open both, and the difference is why one funder is above another.
    const strong = (list: readonly Award[]): boolean =>
      list.length > 0 && list.every((a) => matchesWorkText(a, applicant.workWords ?? []));
    // BOTH NUMBERS when they differ, because the ordering uses the wider one.
    // This said "4 grants for the work you described, in your area" while
    // sorting on the seventeen such grants the funder had made across the
    // nation — so a funder above another on evidence the card did not show.
    // The module's rule is that every key is visible on the card.
    const elsewhere = bothAwards.length - inRegion.length;
    reasons.push(
      inRegion.length > 0
        ? `${plural(inRegion.length, 'grant', 'grants')} ${
            strong(inRegion) ? 'for the work you described' : 'to work like yours'
          }, in your area${
            elsewhere > 0 ? `, and ${elsewhere} more elsewhere in your nation` : ''
          }.`
        : `${plural(bothAwards.length, 'grant', 'grants')} ${
            strong(bothAwards) ? 'for the work you described' : 'to work like yours'
          }, elsewhere in your nation.`,
    );
  } else if (causeAwards.length > 0) {
    reasons.push(
      `${plural(causeAwards.length, 'grant', 'grants')} to work like yours, though not in your area.`,
    );
  } else if (areaAwards.length > 0) {
    const inRegion = areaAwards.filter((a) => matchesRegion(a, applicant));
    reasons.push(
      inRegion.length > 0
        ? `${plural(inRegion.length, 'grant', 'grants')} in your area, for other kinds of work.`
        : `${plural(areaAwards.length, 'grant', 'grants')} in your nation, for other kinds of work.`,
    );
  } else {
    reasons.push('None of their published grants overlap with what you do or where you are.');
  }

  reasons.push(
    `${plural(awards.length, 'published grant', 'published grants')} in total, typically ${money(medianAwardGbp)}.`,
  );

  if (amountFit === 'within_typical' && applicant.amountSoughtGbp !== null) {
    reasons.push(`Your ${money(applicant.amountSoughtGbp)} sits inside their usual range.`);
  } else if (amountFit === 'above_typical' && applicant.amountSoughtGbp !== null) {
    reasons.push(
      `Your ${money(applicant.amountSoughtGbp)} is above most of what they give — ${money(upper)} covers three quarters of their grants.`,
    );
  } else if (amountFit === 'below_typical' && applicant.amountSoughtGbp !== null) {
    reasons.push(
      `Your ${money(applicant.amountSoughtGbp)} is below most of what they give; some funders will not process a small application.`,
    );
  }

  if (base.mayBeDormant && last !== null) {
    reasons.push(
      `Nothing published since ${formatDate(last.awardedOn)}. That may mean they have stopped giving, or simply stopped publishing — worth checking before you spend time on them.`,
    );
  }

  const matchingAwards =
    bothAwards.length > 0 ? bothAwards : causeAwards.length > 0 ? causeAwards : areaAwards;

  return {
    ...base,
    tier,
    matchingAwards,
    // Only the ones actually on the card, so a count the reader cannot open
    // never drives the order.
    workAwards: (() => {
      // A Set, because `includes` over the matching list is quadratic and a
      // funder with thousands of awards is ordinary.
      const strongEnough = new Set(workMatches);
      return matchingAwards.filter((a) => strongEnough.has(a));
    })(),
    amountFit,
    medianAwardGbp,
    amounts,
    reasons,
  };
}

/**
 * Order prospects for reading.
 *
 * Lexicographic and stated, not a weighted score: tier first, then how much
 * evidence put it in that tier, then recency. Every step is something the user
 * can see on the card, so the order is checkable rather than trusted.
 */
export function byRelevance(a: Prospect, b: Prospect): number {
  const tier = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier);
  if (tier !== 0) return tier;

  // A funder that may have stopped giving reads after one that clearly has not.
  if (a.mayBeDormant !== b.mayBeDormant) return a.mayBeDormant ? 1 : -1;

  // THE STRONGER EVIDENCE FIRST.
  //
  // Inside a tier this was the raw count of matching grants, and on a tree
  // nursery's list that put a youth trust with seventeen label matches above
  // the woodland funder with four grants that were literally community tree
  // nurseries. A grant whose own words are the applicant's work is better
  // evidence than a grant sharing a category with them, so it is compared
  // first — and both counts are on the card.
  const work = b.workAwards.length - a.workAwards.length;
  if (work !== 0) return work;

  const evidence = b.matchingAwards.length - a.matchingAwards.length;
  if (evidence !== 0) return evidence;

  const recency = (a.monthsSinceLastAward ?? Infinity) - (b.monthsSinceLastAward ?? Infinity);
  if (recency !== 0) return recency;

  return a.funderName.localeCompare(b.funderName);
}

export function findProspects(
  funders: readonly FunderAwards[],
  applicant: ProspectApplicant,
  asOf: string,
): Prospect[] {
  return funders.map((funder) => assessProspect(funder, applicant, asOf)).toSorted(byRelevance);
}
