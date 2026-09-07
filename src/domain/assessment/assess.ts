/**
 * Opportunity assessment — the product's central output.
 *
 * This composes everything the domain knows into the one screen a CIC acts on.
 * It deliberately produces THREE SEPARATE SIGNALS rather than a single score:
 *
 *   1. Eligibility      deterministic, per-criterion, with explicit unknowns
 *   2. Funder behaviour  what this funder has actually funded, with its source
 *   3. Effort            what applying would cost in hours
 *
 * A composite "fit score" was considered and rejected. It cannot be validated
 * without outcome data we do not have, and blending a hard eligibility failure
 * with a soft preference into one number hides the only thing that is certain.
 * Three honest signals a user can check beat one number they must trust.
 *
 * Nothing here predicts success.
 */

import {
  assessAmountAgainstBehaviour,
  summariseFunderBehaviour,
  type AmountAssessment,
  type Award,
  type BehaviourResult,
} from '../funder/behaviour.js';
import {
  estimateEffort,
  recommend,
  type ApplicationFeatures,
  type DraftingMode,
  type EffortEstimate,
  type RecommendationResult,
} from '../effort/model.js';
import { evaluateEligibility } from '../eligibility/engine.js';
import type { Criterion, CriterionResult, EligibilityVerdict } from '../eligibility/types.js';
import type { ApplicantProfile, DeadlineType, Freshness, ProjectRequest } from '../types.js';

export interface OpportunitySummary {
  id: string;
  title: string;
  funderName: string;
  /** ISO date, or null when there is no dated deadline. */
  deadline: string | null;
  deadlineType: DeadlineType;
  freshness: Freshness;
  /** When the opportunity record was last retrieved from its source. */
  retrievedAt: string;
}

export interface AssessmentInput {
  applicant: ApplicantProfile;
  project: ProjectRequest;
  opportunity: OpportunitySummary;
  criteria: readonly Criterion[];
  /** Past awards by this funder, for behaviour intelligence. */
  awards: readonly Award[];
  features: ApplicationFeatures;
  /**
   * How the answers will be produced. Omitted means unassisted — never assume
   * help the organisation may not have.
   */
  drafting?: DraftingMode;
  /** ISO date. Injected so assessments are deterministic and testable. */
  asOf: string;
}

export interface OpenQuestion {
  label: string;
  reason: string;
  action: string;
}

export interface Notice {
  tone: 'neutral' | 'caution';
  text: string;
}

export interface OpportunityAssessment {
  opportunityId: string;
  eligibility: EligibilityVerdict;
  funderBehaviour: BehaviourResult;
  /** Null when there is too little award data, or no amount is known. */
  amountAssessment: AmountAssessment | null;
  effort: EffortEstimate;
  recommendation: RecommendationResult;
  /** One line answering "is this worth my time?". */
  headline: string;
  openQuestions: OpenQuestion[];
  deadlineNotice: Notice;
  freshnessNotice: Notice;
  /** Always shown. Funder-published requirements take precedence over ours. */
  verifyNotice: string;
}

export const VERIFY_NOTICE =
  'Always check the current requirements with the funder before you submit.';

/**
 * Map an unresolved criterion to a question with a next step.
 *
 * `action` is optional on CriterionResult, so a generic fallback is supplied
 * rather than showing the user a question with nothing to do about it.
 */
export function toOpenQuestion(result: CriterionResult): OpenQuestion {
  return {
    label: result.label,
    reason: result.reason,
    action: result.action ?? 'Confirm this before applying.',
  };
}

/**
 * Describe the deadline without ever letting an estimate read as confirmed.
 *
 * The deadline type is carried separately from the date precisely so this
 * distinction survives all the way to the screen.
 */
export function describeDeadline(
  deadline: string | null,
  type: DeadlineType,
): Notice {
  switch (type) {
    case 'confirmed':
      return deadline === null
        ? { tone: 'caution', text: 'The deadline is confirmed but we have no date for it.' }
        : { tone: 'neutral', text: `Deadline ${deadline}, confirmed by the funder.` };
    case 'rolling':
      return { tone: 'neutral', text: 'Applications are accepted on a rolling basis.' };
    case 'expected':
      return {
        tone: 'caution',
        text: deadline === null
          ? 'A deadline is expected but has not been announced.'
          : `A deadline around ${deadline} is expected but not confirmed. Check with the funder.`,
      };
    case 'estimated':
      return {
        tone: 'caution',
        text: deadline === null
          ? 'We have no deadline for this fund.'
          : `${deadline} is our estimate, not a published date. Do not plan around it without checking.`,
      };
    case 'unknown':
      return { tone: 'caution', text: 'We do not know this fund’s deadline.' };
  }
}

/** Say plainly how much to trust the record in front of you. */
export function describeFreshness(freshness: Freshness, retrievedAt: string): Notice {
  const on = retrievedAt.slice(0, 10);
  switch (freshness) {
    case 'current':
      return { tone: 'neutral', text: `Checked against the funder on ${on}.` };
    case 'recently_verified':
      return { tone: 'neutral', text: `Verified on ${on}.` };
    case 'needs_verification':
      return {
        tone: 'caution',
        text: `Last retrieved ${on} and due a re-check. Confirm the details with the funder.`,
      };
    case 'stale':
      return {
        tone: 'caution',
        text: `This record has not been checked since ${on} and may be out of date.`,
      };
    case 'closed':
      return { tone: 'caution', text: 'This fund is closed to applications.' };
    case 'unknown':
      return {
        tone: 'caution',
        text: 'We cannot tell how current this record is. Treat it as a starting point only.',
      };
  }
}

function buildHeadline(
  amountGbp: number | null,
  effort: EffortEstimate,
  eligibility: EligibilityVerdict,
): string {
  const money =
    amountGbp === null ? 'An unknown amount' : `£${amountGbp.toLocaleString('en-GB')}`;
  const hours = `about ${effort.hours} ${effort.hours === 1 ? 'hour' : 'hours'} of work`;

  // A verdict of 'ineligible' always carries at least one failure, so keying
  // off the failure rather than the verdict avoids an unreachable fallback.
  const firstFailure = eligibility.failures[0];
  if (firstFailure) {
    return `Not eligible: ${firstFailure.reason}`;
  }
  if (eligibility.verdict === 'unknown') {
    const count = eligibility.unknowns.length;
    return `${money} for ${hours}, with ${count} open ${count === 1 ? 'question' : 'questions'} to settle first.`;
  }
  return `${money} for ${hours}. You meet every criterion we can check.`;
}

export function assessOpportunity(input: AssessmentInput): OpportunityAssessment {
  const eligibility = evaluateEligibility(
    input.applicant,
    input.project,
    input.criteria,
    { asOf: input.asOf },
  );

  const funderBehaviour = summariseFunderBehaviour(input.awards, input.asOf);

  let amountAssessment: AmountAssessment | null = null;
  if (funderBehaviour.kind === 'summary' && input.project.amountSoughtGbp !== null) {
    amountAssessment = assessAmountAgainstBehaviour(
      input.project.amountSoughtGbp,
      funderBehaviour.behaviour,
    );
  }

  const effort = estimateEffort(input.features, input.drafting ?? 'unassisted');
  const recommendation = recommend(
    eligibility.verdict,
    input.project.amountSoughtGbp,
    effort,
  );

  return {
    opportunityId: input.opportunity.id,
    eligibility,
    funderBehaviour,
    amountAssessment,
    effort,
    recommendation,
    headline: buildHeadline(input.project.amountSoughtGbp, effort, eligibility),
    openQuestions: eligibility.unknowns.map(toOpenQuestion),
    deadlineNotice: describeDeadline(
      input.opportunity.deadline,
      input.opportunity.deadlineType,
    ),
    freshnessNotice: describeFreshness(
      input.opportunity.freshness,
      input.opportunity.retrievedAt,
    ),
    verifyNotice: VERIFY_NOTICE,
  };
}
