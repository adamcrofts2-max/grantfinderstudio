/**
 * Deterministic eligibility engine.
 *
 * This is the most consequential code in the product. A wrong eligibility
 * verdict costs a volunteer twenty hours, or produces a submitted application
 * that was never eligible. It is therefore:
 *
 *   - a pure function of its inputs (no I/O, no clock, no randomness)
 *   - never AI-evaluated: the AI layer proposes structured criteria, a human
 *     verifies them, and this engine decides
 *   - explicit about not knowing: `unknown` is a first-class outcome and is
 *     never coerced to pass or fail
 */

import {
  hasShareCapital,
  isCic,
  isLimitedByGuarantee,
  type ApplicantProfile,
  type ProjectRequest,
} from '../types.js';
import type {
  Criterion,
  CriterionResult,
  EligibilityVerdict,
  EvaluationContext,
} from './types.js';

const ASK_THE_FUNDER =
  'Ask the funder directly — we can draft that email for you.';

/** Whole months elapsed between two ISO dates. Negative if `to` precedes `from`. */
export function monthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months;
}

function formatGbp(value: number): string {
  return `£${value.toLocaleString('en-GB')}`;
}

function formatRange(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${formatGbp(min)}–${formatGbp(max)}`;
  if (min !== null) return `${formatGbp(min)} or more`;
  if (max !== null) return `up to ${formatGbp(max)}`;
  return 'any amount';
}

/**
 * Evaluate how a funder's legal-form rule applies to this applicant.
 *
 * For CIC applicants the `cicTreatment` value decides. For everyone else we
 * fall back to `permittedForms`, and report `unknown` when the funder has not
 * stated a list.
 */
function evaluateLegalForm(
  criterion: Extract<Criterion, { kind: 'legal_form' }>,
  applicant: ApplicantProfile,
): CriterionResult {
  const base = { criterionId: criterion.id, label: criterion.label };
  const form = applicant.legalForm;

  if (!isCic(form)) {
    const permitted = criterion.permittedForms;
    if (!permitted || permitted.length === 0) {
      return {
        ...base,
        outcome: 'unknown',
        reason: 'The funder has not stated which legal forms it accepts.',
        action: ASK_THE_FUNDER,
      };
    }
    return permitted.includes(form)
      ? { ...base, outcome: 'pass', reason: `${form} is on the funder's permitted list.` }
      : {
          ...base,
          outcome: 'fail',
          reason: `${form} is not on the funder's permitted list.`,
        };
  }

  // Applicant is a CIC. This is where competitors get it wrong in both
  // directions, so each pattern is handled explicitly.
  switch (criterion.cicTreatment) {
    case 'explicitly_permitted':
      return {
        ...base,
        outcome: 'pass',
        reason: 'The funder explicitly accepts Community Interest Companies.',
      };

    case 'charity_only':
      return {
        ...base,
        outcome: 'fail',
        reason:
          'The funder accepts registered charities only. A CIC is not a registered charity.',
      };

    case 'asset_locked_only':
      // Every CIC carries a statutory asset lock, whether limited by guarantee
      // or by shares, so this is unconditionally a pass on the CIC path. This
      // is exactly the case applicants most often get wrong, assuming the
      // requirement means "charity only".
      return {
        ...base,
        outcome: 'pass',
        reason:
          'The funder requires an asset-locked body. All CICs have a statutory asset lock.',
      };

    case 'limited_by_guarantee_only':
      return isLimitedByGuarantee(form)
        ? {
            ...base,
            outcome: 'pass',
            reason: 'The funder requires a body limited by guarantee, which you are.',
          }
        : {
            ...base,
            outcome: 'fail',
            reason:
              'The funder requires a body limited by guarantee. This CIC is limited by shares.',
          };

    case 'no_share_capital_only':
      return hasShareCapital(form)
        ? {
            ...base,
            outcome: 'fail',
            reason:
              'The funder requires an organisation with no share capital. This CIC is limited by shares.',
          }
        : {
            ...base,
            outcome: 'pass',
            reason: 'The funder requires no share capital. This CIC has none.',
          };

    case 'permitted_with_conditions':
      return {
        ...base,
        outcome: 'unknown',
        reason: criterion.conditions
          ? `CICs are accepted subject to conditions: ${criterion.conditions}`
          : 'CICs are accepted subject to conditions the funder has not detailed.',
        action: 'Confirm you meet these conditions before applying.',
      };

    case 'not_stated':
      return {
        ...base,
        outcome: 'unknown',
        reason:
          'The funder does not say whether it accepts CICs. This is common and is worth asking.',
        action: ASK_THE_FUNDER,
      };
  }
}

function evaluateCriterion(
  criterion: Criterion,
  applicant: ApplicantProfile,
  project: ProjectRequest,
  context: EvaluationContext,
): CriterionResult {
  const base = { criterionId: criterion.id, label: criterion.label };

  switch (criterion.kind) {
    case 'legal_form':
      return evaluateLegalForm(criterion, applicant);

    case 'jurisdiction': {
      const permitted = criterion.permitted;
      // A UK-wide fund accepts any jurisdiction; a UK-wide applicant can
      // deliver within any single jurisdiction.
      const ok =
        permitted.includes('uk_wide') ||
        applicant.jurisdiction === 'uk_wide' ||
        permitted.includes(applicant.jurisdiction);
      return ok
        ? { ...base, outcome: 'pass', reason: `${applicant.jurisdiction} is within the funder's area.` }
        : {
            ...base,
            outcome: 'fail',
            reason: `The funder covers ${permitted.join(', ')}, not ${applicant.jurisdiction}.`,
          };
    }

    case 'region': {
      if (applicant.region === null) {
        return {
          ...base,
          outcome: 'unknown',
          reason: 'We do not yet know which area you work in.',
          action: 'Add your area of operation to your profile.',
        };
      }
      const applicantRegion = applicant.region.trim().toLowerCase();
      const ok = criterion.permittedRegions.some(
        (r) => r.trim().toLowerCase() === applicantRegion,
      );
      return ok
        ? { ...base, outcome: 'pass', reason: `${applicant.region} is within the funder's area.` }
        : {
            ...base,
            outcome: 'fail',
            reason: `The funder covers ${criterion.permittedRegions.join(', ')}, not ${applicant.region}.`,
          };
    }

    case 'amount': {
      const amount = project.amountSoughtGbp;
      if (amount === null) {
        return {
          ...base,
          outcome: 'unknown',
          reason: 'We do not yet know how much you want to apply for.',
          action: 'Add the amount you are seeking.',
        };
      }
      if (criterion.minGbp !== null && amount < criterion.minGbp) {
        return {
          ...base,
          outcome: 'fail',
          reason: `You are asking for ${formatGbp(amount)}; the funder awards ${formatRange(criterion.minGbp, criterion.maxGbp)}.`,
        };
      }
      if (criterion.maxGbp !== null && amount > criterion.maxGbp) {
        return {
          ...base,
          outcome: 'fail',
          reason: `You are asking for ${formatGbp(amount)}; the funder awards ${formatRange(criterion.minGbp, criterion.maxGbp)}.`,
        };
      }
      return {
        ...base,
        outcome: 'pass',
        reason: `${formatGbp(amount)} is within the funder's range of ${formatRange(criterion.minGbp, criterion.maxGbp)}.`,
      };
    }

    case 'organisation_age': {
      if (applicant.incorporationDate === null) {
        return {
          ...base,
          outcome: 'unknown',
          reason: 'We do not yet know when your organisation was incorporated.',
          action: 'Add your company number so we can verify this automatically.',
        };
      }
      const age = monthsBetween(applicant.incorporationDate, context.asOf);
      return age >= criterion.minMonths
        ? {
            ...base,
            outcome: 'pass',
            reason: `The funder requires ${criterion.minMonths} months of trading; you have ${age}.`,
          }
        : {
            ...base,
            outcome: 'fail',
            reason: `The funder requires ${criterion.minMonths} months of trading; you have ${age}.`,
          };
    }

    case 'turnover': {
      const turnover = applicant.annualTurnoverGbp;
      if (turnover === null) {
        return {
          ...base,
          outcome: 'unknown',
          reason: 'We do not yet know your annual turnover.',
          action: 'Add your latest annual turnover.',
        };
      }
      const withinMin = criterion.minGbp === null || turnover >= criterion.minGbp;
      const withinMax = criterion.maxGbp === null || turnover <= criterion.maxGbp;
      return withinMin && withinMax
        ? {
            ...base,
            outcome: 'pass',
            reason: `Your turnover of ${formatGbp(turnover)} is within the funder's range of ${formatRange(criterion.minGbp, criterion.maxGbp)}.`,
          }
        : {
            ...base,
            outcome: 'fail',
            reason: `Your turnover of ${formatGbp(turnover)} is outside the funder's range of ${formatRange(criterion.minGbp, criterion.maxGbp)}.`,
          };
    }

    case 'match_funding': {
      if (!criterion.required) {
        return { ...base, outcome: 'pass', reason: 'The funder does not require match funding.' };
      }
      if (project.hasMatchFunding === null) {
        return {
          ...base,
          outcome: 'unknown',
          reason: 'The funder requires match funding and we do not know whether you have it.',
          action: 'Confirm whether you have match funding in place.',
        };
      }
      return project.hasMatchFunding
        ? { ...base, outcome: 'pass', reason: 'The funder requires match funding and you have it.' }
        : {
            ...base,
            outcome: 'fail',
            reason: 'The funder requires match funding and you do not have it.',
          };
    }

    case 'capital_revenue': {
      if (project.capitalOrRevenue === null) {
        return {
          ...base,
          outcome: 'unknown',
          reason: 'We do not yet know whether your costs are capital or revenue.',
          action: 'Tell us whether this is capital spending, running costs, or both.',
        };
      }
      // A mixed project needs both to be permitted.
      const ok =
        project.capitalOrRevenue === 'mixed'
          ? criterion.permitted.includes('capital') && criterion.permitted.includes('revenue')
          : criterion.permitted.includes(project.capitalOrRevenue);
      return ok
        ? {
            ...base,
            outcome: 'pass',
            reason: `The funder covers ${criterion.permitted.join(' and ')} costs.`,
          }
        : {
            ...base,
            outcome: 'fail',
            reason: `The funder covers ${criterion.permitted.join(' and ')} costs only.`,
          };
    }

    case 'beneficiary': {
      if (project.beneficiaryGroups.length === 0) {
        return {
          ...base,
          outcome: 'unknown',
          reason: 'We do not yet know who your project is for.',
          action: 'Add the groups your project supports.',
        };
      }
      const wanted = new Set(criterion.anyOf.map((b) => b.trim().toLowerCase()));
      const matched = project.beneficiaryGroups.filter((b) =>
        wanted.has(b.trim().toLowerCase()),
      );
      return matched.length > 0
        ? {
            ...base,
            outcome: 'pass',
            reason: `The funder prioritises ${matched.join(', ')}, which your project supports.`,
          }
        : {
            ...base,
            outcome: 'fail',
            reason: `The funder supports ${criterion.anyOf.join(', ')}; your project does not list any of these.`,
          };
    }

    case 'duration': {
      const duration = project.durationMonths;
      if (duration === null) {
        return {
          ...base,
          outcome: 'unknown',
          reason: 'We do not yet know how long your project will run.',
          action: 'Add the project duration in months.',
        };
      }
      const withinMin = criterion.minMonths === null || duration >= criterion.minMonths;
      const withinMax = criterion.maxMonths === null || duration <= criterion.maxMonths;
      return withinMin && withinMax
        ? {
            ...base,
            outcome: 'pass',
            reason: `A ${duration}-month project fits the funder's limits.`,
          }
        : {
            ...base,
            outcome: 'fail',
            reason: `A ${duration}-month project is outside the funder's limits.`,
          };
    }
  }
}

/**
 * Evaluate every criterion and combine the results.
 *
 * Combination rule, in order:
 *   any failure  -> ineligible  (a hard exclusion is decisive)
 *   any unknown  -> unknown     (never optimistically assume a pass)
 *   otherwise    -> eligible
 *
 * An empty criteria set yields `unknown`: knowing nothing about a funder's
 * rules is not the same as meeting them.
 */
export function evaluateEligibility(
  applicant: ApplicantProfile,
  project: ProjectRequest,
  criteria: readonly Criterion[],
  context: EvaluationContext,
): EligibilityVerdict {
  const results = criteria.map((c) =>
    evaluateCriterion(c, applicant, project, context),
  );
  const failures = results.filter((r) => r.outcome === 'fail');
  const unknowns = results.filter((r) => r.outcome === 'unknown');

  let verdict: EligibilityVerdict['verdict'];
  if (failures.length > 0) verdict = 'ineligible';
  else if (unknowns.length > 0 || results.length === 0) verdict = 'unknown';
  else verdict = 'eligible';

  return { verdict, results, unknowns, failures };
}
