/**
 * Reading a list of funders, once the grants have been grouped by who gave them.
 *
 * The grouping itself is a query; this is the part that has to be defensible to
 * the person reading it. Two rules run through it:
 *
 *  - **Every position is explainable in a sentence.** The score is a small
 *    integer built from countable things, and `whyThisFunder` says the same
 *    things in words. A ranking nobody can check is worse than no ranking.
 *  - **Nothing is described that cannot be described.** A median over three
 *    grants is not a policy, and `src/domain/funder/behaviour.ts` already sets
 *    the bar — `MIN_AWARDS_TO_CHARACTERISE`. Below it the figures are given as
 *    what they are: a couple of grants, named, not a pattern.
 */

import { MIN_AWARDS_TO_CHARACTERISE } from '../funder/behaviour.js';

/**
 * Pounds, to the nearest pound, for a clause in a sentence.
 *
 * Here rather than from `app/components` because this module is domain code
 * and must not import from the app. The figures it names are grant amounts —
 * whole pounds, no pence, which is how every funder publishes them.
 */
function money(value: number): string {
  return `£${Math.round(value).toLocaleString('en-GB')}`;
}

export interface RankableFunder {
  funderId: string;
  matching: number;
  inYourRegion: number;
  amounts: { lowerQuartile: number; median: number; upperQuartile: number; min: number; max: number };
  lastAwardedOn: string | null;
}

export interface FunderRankContext {
  /** The applicant's own area, if they have told us. */
  region: string | null;
  amountSoughtGbp: number | null;
  /** Today, injected so the ordering is testable. */
  asOf: string;
}

/** Years after which a funder's published giving stops being evidence of much. */
const STALE_AFTER_YEARS = 3;

export function yearsSince(date: string | null, asOf: string): number | null {
  if (date === null) return null;
  const then = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${asOf.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then) || Number.isNaN(now)) return null;
  return (now - then) / (365.25 * 24 * 60 * 60 * 1000);
}

/**
 * How well a funder answers "would they fund us", 0 upwards.
 *
 * Weighted towards evidence rather than fit: that they have given to work like
 * this REPEATEDLY, in the applicant's AREA, RECENTLY, and at a size the
 * applicant is asking for. In that order, because eligibility and habit beat
 * a good keyword match.
 */
export function funderScore(funder: RankableFunder, context: FunderRankContext): number {
  let score = 0;

  // Repeated giving. Capped, so one enormous publisher cannot dominate a list
  // by volume alone — the point is "more than once", not "most of all".
  score += Math.min(funder.matching, 10);

  // Their own area, which is often the difference between eligible and not.
  if (context.region !== null && funder.inYourRegion > 0) score += 8;

  // Still giving.
  const years = yearsSince(funder.lastAwardedOn, context.asOf);
  if (years !== null) {
    if (years <= 2) score += 6;
    else if (years <= STALE_AFTER_YEARS) score += 2;
  }

  // A size they actually give at. The interquartile range is "typical"; the
  // full range is "possible", and both are worth something.
  const ask = context.amountSoughtGbp;
  if (ask !== null && ask > 0) {
    if (ask >= funder.amounts.lowerQuartile && ask <= funder.amounts.upperQuartile) score += 6;
    else if (ask >= funder.amounts.min && ask <= funder.amounts.max) score += 3;
  }

  return score;
}

export function rankFunders<T extends RankableFunder>(
  funders: readonly T[],
  context: FunderRankContext,
): T[] {
  // `toSorted`, and the query's order as the tie-break, so the same data always
  // renders in the same order.
  return funders
    .map((funder, index) => ({ funder, score: funderScore(funder, context), index }))
    .toSorted((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.funder);
}

/** Whether there is enough here to describe what a funder typically gives. */
export function canCharacterise(matching: number): boolean {
  return matching >= MIN_AWARDS_TO_CHARACTERISE;
}

/**
 * Why this funder is on the list, in the words the score is made of.
 *
 * Each clause corresponds to a term in `funderScore`, so the explanation and
 * the ordering cannot drift apart. Returned as parts rather than a sentence so
 * the screen can lay them out; joined with a middot they read as one line.
 */
export function whyThisFunder(
  funder: RankableFunder,
  context: FunderRankContext,
): string[] {
  const parts: string[] = [];

  parts.push(
    funder.matching === 1
      ? '1 grant like yours'
      : `${funder.matching.toLocaleString('en-GB')} grants like yours`,
  );

  if (context.region !== null && funder.inYourRegion > 0) {
    parts.push(
      funder.inYourRegion === funder.matching
        ? `all in ${context.region}`
        : `${funder.inYourRegion} in ${context.region}`,
    );
  }

  const years = yearsSince(funder.lastAwardedOn, context.asOf);
  if (years !== null) {
    if (years < 1) parts.push('gave within the last year');
    else if (years <= 2) parts.push('gave within 2 years');
    else if (years <= STALE_AFTER_YEARS) parts.push(`last gave about ${Math.round(years)} years ago`);
    else parts.push(`nothing published for ${Math.round(years)} years`);
  }

  /**
   * BELOW THE BAR, NAME THE GRANTS INSTEAD OF SUMMARISING THEM.
   *
   * This module's own rule, from the top of the file: "Below it the figures
   * are given as what they are: a couple of grants, named, not a pattern."
   * The rule was written down and not implemented, and a walk showed what
   * that cost. A precise search — "community tree nursery" — matches one or
   * two grants per funder, so `canCharacterise` refused to summarise and
   * nothing took its place: fourteen rows reading "1 grant like yours · gave
   * within the last year", nine of them identical, and NOT ONE AMOUNT on the
   * screen. The first thing anybody needs in order to decide whether to
   * approach a funder, for a grant we hold the figure for.
   *
   * Naming the amounts makes no statistical claim — that is the whole point
   * of the restraint — and lets the reader do the comparison the median would
   * have done for them.
   */
  if (!canCharacterise(funder.matching)) {
    const { min, max } = funder.amounts;
    if (Number.isFinite(min) && min > 0) {
      parts.push(min === max ? money(min) : `${money(min)} to ${money(max)}`);
    }
  }

  const ask = context.amountSoughtGbp;
  if (ask !== null && ask > 0 && canCharacterise(funder.matching)) {
    if (ask >= funder.amounts.lowerQuartile && ask <= funder.amounts.upperQuartile) {
      parts.push('your ask is a typical size for them');
    } else if (ask >= funder.amounts.min && ask <= funder.amounts.max) {
      parts.push('your ask is within their range, but not typical');
    } else {
      parts.push('your ask is outside anything they have given here');
    }
  }

  return parts;
}
