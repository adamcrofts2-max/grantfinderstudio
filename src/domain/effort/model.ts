/**
 * Deterministic application-effort model.
 *
 * A CIC's scarcest resource is time, not ambition. This model estimates what
 * an application would actually cost in hours, from features that can be
 * observed in the funder's own form and guidance.
 *
 * It is deliberately arithmetic rather than machine-learned:
 *   - every number is explainable to the user
 *   - it needs no training data, which we do not have
 *   - it degrades honestly when a feature is unknown
 *
 * It does NOT estimate probability of success. We have no outcome data that
 * would justify one, and a fabricated probability is worse than no number.
 */

/** Observable features of an application form. */
export interface ApplicationFeatures {
  questionCount: number;
  /** Total words the applicant must write across all questions. */
  totalWordBudget: number;
  /** Documents to attach (business plan, project plan, quotes, and so on). */
  requiredAttachments: number;
  requiresLatestAccounts: boolean;
  /** Named policies, e.g. safeguarding, equal opportunities. */
  requiredPolicies: readonly string[];
  requiresMatchFunding: boolean;
  requiresBudgetTemplate: boolean;
}

export type EffortBand = 'low' | 'moderate' | 'high';

export interface EffortDriver {
  label: string;
  hours: number;
}

export interface EffortEstimate {
  hours: number;
  band: EffortBand;
  /** Ordered by descending cost, so the UI can show what dominates. */
  drivers: EffortDriver[];
}

/**
 * Calibration constants.
 *
 * These are transparent heuristics, not measurements. They are collected here
 * so they can be tuned from real usage data once we have it, rather than being
 * scattered through the code.
 */
export const EFFORT_CONSTANTS = {
  /** Reading guidance, registering, orienting. */
  baseHours: 1,
  /**
   * Finished words per hour for a competent non-specialist, including
   * thinking, drafting and editing. Grant prose is slow prose.
   */
  wordsPerHour: 200,
  /** Understanding what each question is actually asking. */
  hoursPerQuestion: 0.25,
  /** Locating, preparing or updating each attachment. */
  hoursPerAttachment: 0.5,
  hoursForAccounts: 0.5,
  /** Finding or writing each named policy. */
  hoursPerPolicy: 0.5,
  /** Securing and evidencing match funding. */
  hoursForMatchFunding: 2,
  /** Completing a funder's own budget spreadsheet. */
  hoursForBudgetTemplate: 1.5,
  /** Band boundaries, in hours. */
  lowBandMaxHours: 6,
  moderateBandMaxHours: 15,
} as const;

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export function estimateEffort(features: ApplicationFeatures): EffortEstimate {
  const c = EFFORT_CONSTANTS;
  const drivers: EffortDriver[] = [];

  drivers.push({ label: 'Reading the guidance', hours: c.baseHours });

  if (features.totalWordBudget > 0) {
    drivers.push({
      label: `Writing ${features.totalWordBudget.toLocaleString('en-GB')} words`,
      hours: features.totalWordBudget / c.wordsPerHour,
    });
  }

  if (features.questionCount > 0) {
    drivers.push({
      label: `Working through ${features.questionCount} questions`,
      hours: features.questionCount * c.hoursPerQuestion,
    });
  }

  if (features.requiredAttachments > 0) {
    drivers.push({
      label: `Preparing ${features.requiredAttachments} attachments`,
      hours: features.requiredAttachments * c.hoursPerAttachment,
    });
  }

  if (features.requiresLatestAccounts) {
    drivers.push({ label: 'Providing latest accounts', hours: c.hoursForAccounts });
  }

  if (features.requiredPolicies.length > 0) {
    drivers.push({
      label: `Providing policies (${features.requiredPolicies.join(', ')})`,
      hours: features.requiredPolicies.length * c.hoursPerPolicy,
    });
  }

  if (features.requiresMatchFunding) {
    drivers.push({ label: 'Securing and evidencing match funding', hours: c.hoursForMatchFunding });
  }

  if (features.requiresBudgetTemplate) {
    drivers.push({ label: "Completing the funder's budget template", hours: c.hoursForBudgetTemplate });
  }

  const total = drivers.reduce((sum, d) => sum + d.hours, 0);
  const hours = roundHalf(total);

  const band: EffortBand =
    hours <= c.lowBandMaxHours
      ? 'low'
      : hours <= c.moderateBandMaxHours
        ? 'moderate'
        : 'high';

  drivers.sort((a, b) => b.hours - a.hours);

  return {
    hours,
    band,
    drivers: drivers.map((d) => ({ ...d, hours: roundHalf(d.hours) })),
  };
}

export type Recommendation =
  | 'strong'
  | 'worth_considering'
  | 'conditional'
  | 'not_recommended';

export interface RecommendationResult {
  recommendation: Recommendation;
  /** Funding per hour of effort. Null when the amount is unknown. */
  valuePerHour: number | null;
  reason: string;
}

/**
 * Value-per-hour thresholds, in £ per hour of application effort.
 *
 * Calibrated against the trade-off in the brief: £10,000 for 30 hours
 * (£333/hr) should read as poor value, while £25,000 for 10 hours
 * (£2,500/hr) should read as strong.
 */
export const VALUE_THRESHOLDS = {
  strong: 2000,
  worthConsidering: 800,
  conditional: 350,
} as const;

/**
 * Combine eligibility, amount and effort into a single recommendation.
 *
 * Eligibility dominates: no amount of funding justifies applying for something
 * you cannot win, and an unresolved unknown is resolved before, not after,
 * twenty hours of writing.
 */
export function recommend(
  verdict: 'eligible' | 'ineligible' | 'unknown',
  amountGbp: number | null,
  effort: EffortEstimate,
): RecommendationResult {
  const valuePerHour =
    amountGbp === null || effort.hours === 0 ? null : amountGbp / effort.hours;

  if (verdict === 'ineligible') {
    return {
      recommendation: 'not_recommended',
      valuePerHour,
      reason: 'You are not eligible for this fund, so the effort would be wasted.',
    };
  }

  if (verdict === 'unknown') {
    return {
      recommendation: 'conditional',
      valuePerHour,
      reason:
        'Some eligibility questions are unresolved. Settle those before investing time in an application.',
    };
  }

  if (valuePerHour === null) {
    return {
      recommendation: 'conditional',
      valuePerHour,
      reason: 'You are eligible, but we need the amount you are seeking to weigh it against the effort.',
    };
  }

  const perHour = `£${Math.round(valuePerHour).toLocaleString('en-GB')} per hour of work`;

  if (valuePerHour >= VALUE_THRESHOLDS.strong) {
    return {
      recommendation: 'strong',
      valuePerHour,
      reason: `You are eligible and this is a strong use of your time — about ${perHour}.`,
    };
  }
  if (valuePerHour >= VALUE_THRESHOLDS.worthConsidering) {
    return {
      recommendation: 'worth_considering',
      valuePerHour,
      reason: `You are eligible and this is reasonable value — about ${perHour}.`,
    };
  }
  if (valuePerHour >= VALUE_THRESHOLDS.conditional) {
    return {
      recommendation: 'conditional',
      valuePerHour,
      reason: `You are eligible, but at about ${perHour} this is only worth it if the funder matters to you strategically.`,
    };
  }
  return {
    recommendation: 'not_recommended',
    valuePerHour,
    reason: `At about ${perHour}, your time is likely better spent on a larger or simpler opportunity.`,
  };
}
