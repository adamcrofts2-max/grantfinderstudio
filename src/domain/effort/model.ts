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
 *
 * It prices two different jobs. Writing a grant answer from a blank box and
 * checking a draft the Writer has already grounded in your confirmed facts are
 * not the same task and must not carry the same rate — pricing every hour as
 * unassisted composition understates the product's own point, and would have
 * the tracker send people away from funds they could comfortably do.
 */

/**
 * How the answers will actually be produced.
 *
 * `unassisted` is the honest default: assume no help unless we know there is
 * some. Claiming an assisted rate the user cannot obtain would be worse than
 * the old over-estimate, because it fails in the direction of a missed
 * deadline rather than a wasted afternoon.
 */
export type DraftingMode = 'unassisted' | 'assisted';

/** What the organisation can actually bring to the drafting. */
export interface DraftingCapability {
  /** An Anthropic key is stored, so the Writer can be run at all. */
  writerAvailable: boolean;
  /** Confirmed, non-superseded facts the Writer may ground prose in. */
  usableFacts: number;
}

/**
 * Below this, the assisted rate is a promise the product cannot keep.
 *
 * The Writer refuses to invent: it drafts only from confirmed facts. With a
 * near-empty fact base it produces a few grounded sentences and a lot of gaps,
 * and the human writes the rest at the unassisted rate anyway. Same reasoning
 * as MIN_AWARDS_TO_CHARACTERISE — below a floor we decline to claim.
 */
export const MIN_FACTS_FOR_ASSISTED_DRAFTING = 5;

export function draftingMode(capability: DraftingCapability): DraftingMode {
  return capability.writerAvailable &&
    capability.usableFacts >= MIN_FACTS_FOR_ASSISTED_DRAFTING
    ? 'assisted'
    : 'unassisted';
}

/** Why the faster rate was not applied, for an interface that must explain itself. */
export type UnassistedReason = 'writer_unavailable' | 'too_few_facts' | null;

export function unassistedReason(capability: DraftingCapability): UnassistedReason {
  if (!capability.writerAvailable) return 'writer_unavailable';
  if (capability.usableFacts < MIN_FACTS_FOR_ASSISTED_DRAFTING) return 'too_few_facts';
  return null;
}

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
  /** Which rate the writing was priced at, so the interface can say so. */
  mode: DraftingMode;
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
   * Finished words per hour for a competent non-specialist writing from a
   * blank box, including thinking, drafting and editing. Grant prose is slow
   * prose.
   */
  wordsPerHour: 200,
  /**
   * Words per hour when the Writer has produced a grounded draft and the job
   * is to check and correct it.
   *
   * This is a substantive-editing rate, not a reading rate. The work is not
   * consuming the words — it is checking each claim against what you know,
   * cutting what does not sound like you, and confirming it answers the
   * question the funder actually asked. Trade rates for substantive editing
   * sit around 500-750 words an hour; 700 assumes the draft arrives already
   * grounded in confirmed facts, which is the only kind this product produces.
   *
   * It is deliberately not an order of magnitude. A draft you have not checked
   * is a liability in a funding application, and the product's whole position
   * is that a person stays responsible for every claim.
   */
  assistedWordsPerHour: 700,
  /**
   * Resolving one claim the Writer could not ground: find the evidence,
   * confirm the fact, or cut the sentence. This cost is created by assisted
   * drafting rather than removed by it, and the workspace already counts these
   * exactly, so it is measured rather than assumed.
   */
  hoursPerUnsupportedClaim: 0.25,
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

export function estimateEffort(
  features: ApplicationFeatures,
  mode: DraftingMode = 'unassisted',
): EffortEstimate {
  const c = EFFORT_CONSTANTS;
  const drivers: EffortDriver[] = [];

  drivers.push({ label: 'Reading the guidance', hours: c.baseHours });

  if (features.totalWordBudget > 0) {
    const words = features.totalWordBudget.toLocaleString('en-GB');
    drivers.push(
      mode === 'assisted'
        ? {
            label: `Checking and correcting ${words} drafted words`,
            hours: features.totalWordBudget / c.assistedWordsPerHour,
          }
        : {
            label: `Writing ${words} words`,
            hours: features.totalWordBudget / c.wordsPerHour,
          },
    );
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
  // Once the writing collapses, what is left is the paperwork the Writer
  // cannot touch: attachments, policies, accounts, match funding, the funder's
  // own budget template. Sorting by cost is what makes that visible.

  const band: EffortBand =
    hours <= c.lowBandMaxHours
      ? 'low'
      : hours <= c.moderateBandMaxHours
        ? 'moderate'
        : 'high';

  drivers.sort((a, b) => b.hours - a.hours);
  for (const driver of drivers) driver.hours = roundHalf(driver.hours);

  return { hours, band, mode, drivers };
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
