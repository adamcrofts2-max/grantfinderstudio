/**
 * Funder behaviour, derived from awarded-grants data.
 *
 * The product's central claim is that what a funder has actually funded
 * predicts fit better than what its priorities page says. This module turns a
 * list of past awards into the few numbers a CIC can act on: what this funder
 * typically gives, to whom, where, and how recently.
 *
 * Two honesty rules are built in rather than left to the UI:
 *
 *   - Below MIN_AWARDS_TO_CHARACTERISE, no summary is produced at all. Three
 *     grants do not describe a funder's habits, and a median of three numbers
 *     invites more confidence than it deserves.
 *   - Nothing here is a prediction. It describes the past, and the caller is
 *     expected to present it as such, with its source and licence.
 */

import type { Jurisdiction } from '../types.js';

export interface Award {
  id: string;
  amountGbp: number;
  /** ISO date (YYYY-MM-DD). */
  awardedOn: string;
  recipientName: string | null;
  jurisdiction: Jurisdiction | null;
  region: string | null;
  /** Free-form classification labels as published by the funder. */
  tags: readonly string[];
}

/**
 * Fewer awards than this and we decline to characterise the funder.
 * Chosen so that quartiles are computed over a meaningful spread rather than
 * a handful of points.
 */
export const MIN_AWARDS_TO_CHARACTERISE = 5;

export interface AmountSummary {
  min: number;
  /** 25th percentile. */
  lowerQuartile: number;
  median: number;
  /** 75th percentile. */
  upperQuartile: number;
  max: number;
}

export interface Tally {
  value: string;
  count: number;
}

export interface FunderBehaviour {
  awardCount: number;
  amounts: AmountSummary;
  /** Months between the most recent award and the reference date. */
  monthsSinceMostRecentAward: number;
  /** Descending by count. */
  jurisdictions: Tally[];
  regions: Tally[];
  tags: Tally[];
}

export type BehaviourResult =
  | { kind: 'summary'; behaviour: FunderBehaviour }
  | { kind: 'too_few_awards'; awardCount: number; reason: string };

/**
 * Linear-interpolated percentile over a sorted ascending array.
 *
 * Interpolating rather than picking the nearest element matters for small
 * samples, where nearest-rank would report an actual award amount as though it
 * were a typical one.
 */
export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) throw new Error('percentile of an empty set');
  if (sortedAscending.length === 1) return sortedAscending[0]!;
  const position = (sortedAscending.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedAscending[lower]!;
  const weight = position - lower;
  return sortedAscending[lower]! * (1 - weight) + sortedAscending[upper]! * weight;
}

function tally(values: readonly (string | null)[]): Tally[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value === null || value.trim() === '') continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    // Descending by count, then alphabetically so the output is stable.
    .toSorted((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function formatGbp(value: number): string {
  return `£${Math.round(value).toLocaleString('en-GB')}`;
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

/**
 * Summarise a funder's awards.
 *
 * `asOf` is injected rather than read from the clock, so the result is
 * deterministic and testable.
 */
export function summariseFunderBehaviour(
  awards: readonly Award[],
  asOf: string,
): BehaviourResult {
  if (awards.length < MIN_AWARDS_TO_CHARACTERISE) {
    return {
      kind: 'too_few_awards',
      awardCount: awards.length,
      reason:
        awards.length === 0
          ? 'We have no awarded-grants data for this funder.'
          : `We only have ${awards.length} awards for this funder — too few to describe what it typically funds.`,
    };
  }

  const amounts = awards.map((a) => a.amountGbp).toSorted((a, b) => a - b);
  const mostRecent = awards
    .map((a) => a.awardedOn)
    .reduce((latest, date) => (date > latest ? date : latest));

  return {
    kind: 'summary',
    behaviour: {
      awardCount: awards.length,
      amounts: {
        min: amounts[0]!,
        lowerQuartile: percentile(amounts, 0.25),
        median: percentile(amounts, 0.5),
        upperQuartile: percentile(amounts, 0.75),
        max: amounts.at(-1)!,
      },
      monthsSinceMostRecentAward: monthsBetween(mostRecent, asOf),
      jurisdictions: tally(awards.map((a) => a.jurisdiction)),
      regions: tally(awards.map((a) => a.region)),
      tags: tally(awards.flatMap((a) => a.tags)),
    },
  };
}

export type AmountFit =
  | 'within_typical'
  | 'above_typical'
  | 'below_typical'
  | 'outside_range_entirely';

export interface AmountAssessment {
  fit: AmountFit;
  message: string;
}

/**
 * Compare an intended ask against what this funder typically awards.
 *
 * "Typical" is the interquartile range — the middle half of awards. Asking
 * outside it is not a reason not to apply; it is a reason to be deliberate,
 * and the message says so rather than discouraging.
 */
export function assessAmountAgainstBehaviour(
  amountSoughtGbp: number,
  behaviour: FunderBehaviour,
): AmountAssessment {
  const { lowerQuartile, upperQuartile, min, max } = behaviour.amounts;
  const typical = `${formatGbp(lowerQuartile)}–${formatGbp(upperQuartile)}`;

  if (amountSoughtGbp < min || amountSoughtGbp > max) {
    return {
      fit: 'outside_range_entirely',
      message: `This funder's awards in our data run from ${formatGbp(min)} to ${formatGbp(max)}. Your ask of ${formatGbp(amountSoughtGbp)} falls outside that range entirely.`,
    };
  }
  if (amountSoughtGbp < lowerQuartile) {
    return {
      fit: 'below_typical',
      message: `Your ask of ${formatGbp(amountSoughtGbp)} is below this funder's typical ${typical}. That is not a problem, but check there is no minimum.`,
    };
  }
  if (amountSoughtGbp > upperQuartile) {
    return {
      fit: 'above_typical',
      message: `Your ask of ${formatGbp(amountSoughtGbp)} is above this funder's typical ${typical}. Expect to justify the size of the request.`,
    };
  }
  return {
    fit: 'within_typical',
    message: `Your ask of ${formatGbp(amountSoughtGbp)} sits within this funder's typical ${typical}.`,
  };
}

/** Count awards matching a region, case-insensitively. */
export function countAwardsInRegion(
  awards: readonly Award[],
  region: string,
): number {
  const target = region.trim().toLowerCase();
  return awards.filter((a) => a.region?.trim().toLowerCase() === target).length;
}

/** Count awards carrying any of the given tags, case-insensitively. */
export function countAwardsWithAnyTag(
  awards: readonly Award[],
  tags: readonly string[],
): number {
  const wanted = new Set(tags.map((t) => t.trim().toLowerCase()));
  return awards.filter((a) =>
    a.tags.some((t) => wanted.has(t.trim().toLowerCase())),
  ).length;
}
