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

function matchesCause(award: Award, groups: readonly string[]): boolean {
  if (groups.length === 0) return false;
  return award.tags.some((tag) => groups.some((group) => labelsOverlap(tag, group)));
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

  const causeAwards = awards.filter((a) => matchesCause(a, applicant.beneficiaryGroups));
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
    reasons.push(
      inRegion.length > 0
        ? `${plural(inRegion.length, 'grant', 'grants')} to work like yours, in your area.`
        : `${plural(bothAwards.length, 'grant', 'grants')} to work like yours, elsewhere in your nation.`,
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
      `Nothing published since ${last.awardedOn}. That may mean they have stopped giving, or simply stopped publishing — worth checking before you spend time on them.`,
    );
  }

  return {
    ...base,
    tier,
    matchingAwards: bothAwards.length > 0 ? bothAwards : causeAwards.length > 0 ? causeAwards : areaAwards,
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
