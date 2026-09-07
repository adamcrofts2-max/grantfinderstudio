import { describe, expect, it } from 'vitest';
import type { Award } from '../funder/behaviour.js';
import type { ApplicationFeatures } from '../effort/model.js';
import type { Criterion } from '../eligibility/types.js';
import type { ApplicantProfile, ProjectRequest } from '../types.js';
import {
  assessOpportunity,
  describeDeadline,
  describeFreshness,
  toOpenQuestion,
  VERIFY_NOTICE,
  type AssessmentInput,
  type OpportunitySummary,
} from './assess.js';

const ASOF = '2026-09-06';

const applicant: ApplicantProfile = {
  legalForm: 'cic_limited_by_guarantee',
  jurisdiction: 'england',
  region: 'Somerset',
  incorporationDate: '2020-01-15',
  annualTurnoverGbp: 120_000,
};

const project: ProjectRequest = {
  amountSoughtGbp: 30_000,
  durationMonths: 12,
  beneficiaryGroups: ['young people'],
  capitalOrRevenue: 'revenue',
  hasMatchFunding: false,
};

const opportunity: OpportunitySummary = {
  id: 'opp_1',
  title: 'Fictional Youth Fund',
  funderName: 'The Fictional Trust',
  deadline: '2026-11-30',
  deadlineType: 'confirmed',
  freshness: 'current',
  retrievedAt: '2026-09-01T00:00:00Z',
};

const features: ApplicationFeatures = {
  questionCount: 8,
  totalWordBudget: 1200,
  requiredAttachments: 3,
  requiresLatestAccounts: false,
  requiredPolicies: [],
  requiresMatchFunding: false,
  requiresBudgetTemplate: false,
};

const awards: Award[] = [8000, 15_000, 22_000, 31_000, 40_000].map((amount, i) => ({
  id: `aw${i}`,
  amountGbp: amount,
  awardedOn: `2025-0${i + 1}-01`,
  recipientName: 'Fictional CIC',
  jurisdiction: 'england',
  region: 'Somerset',
  tags: ['young people'],
}));

const eligibleCriteria: Criterion[] = [
  { kind: 'legal_form', id: 'lf', label: 'Legal form', cicTreatment: 'explicitly_permitted' },
  { kind: 'jurisdiction', id: 'j', label: 'Area', permitted: ['england'] },
  { kind: 'amount', id: 'a', label: 'Amount', minGbp: 5_000, maxGbp: 50_000 },
];

function input(overrides: Partial<AssessmentInput> = {}): AssessmentInput {
  return { applicant, project, opportunity, criteria: eligibleCriteria, awards, features, asOf: ASOF, ...overrides };
}

describe('assessOpportunity', () => {
  it('produces three separate signals rather than one score', () => {
    const a = assessOpportunity(input());
    expect(a.eligibility.verdict).toBe('eligible');
    expect(a.funderBehaviour.kind).toBe('summary');
    expect(a.effort.hours).toBeGreaterThan(0);
    // There is deliberately no composite score field.
    expect(a).not.toHaveProperty('score');
    expect(a).not.toHaveProperty('fitScore');
  });

  it('answers "is this worth my time?" in the headline', () => {
    const a = assessOpportunity(input());
    expect(a.headline).toContain('£30,000');
    expect(a.headline).toContain('hours of work');
    expect(a.headline).toContain('every criterion we can check');
  });

  it('leads with the reason when the applicant is ineligible', () => {
    const a = assessOpportunity(
      input({
        criteria: [
          { kind: 'legal_form', id: 'lf', label: 'Legal form', cicTreatment: 'charity_only' },
        ],
      }),
    );
    expect(a.headline).toContain('Not eligible');
    expect(a.headline).toContain('not a registered charity');
    expect(a.recommendation.recommendation).toBe('not_recommended');
  });

  it('counts the open questions in the headline when eligibility is unresolved', () => {
    const a = assessOpportunity(
      input({
        criteria: [
          { kind: 'legal_form', id: 'lf', label: 'Legal form', cicTreatment: 'not_stated' },
        ],
      }),
    );
    expect(a.headline).toContain('1 open question');
    expect(a.recommendation.recommendation).toBe('conditional');
  });

  it('turns each unknown into a question with an action', () => {
    const a = assessOpportunity(
      input({
        criteria: [
          { kind: 'legal_form', id: 'lf', label: 'Legal form', cicTreatment: 'not_stated' },
          { kind: 'turnover', id: 't', label: 'Turnover', minGbp: 1, maxGbp: null },
        ],
        applicant: { ...applicant, annualTurnoverGbp: null },
      }),
    );
    expect(a.openQuestions).toHaveLength(2);
    for (const q of a.openQuestions) {
      expect(q.action.length).toBeGreaterThan(0);
      expect(q.reason.length).toBeGreaterThan(0);
    }
    expect(a.openQuestions[0]?.action).toContain('Ask the funder');
  });

  it('compares the ask against what the funder actually awards', () => {
    // Awards are 8k/15k/22k/31k/40k, so the typical range is £15,000-£31,000
    // and a £30,000 ask sits inside it.
    const a = assessOpportunity(input());
    expect(a.amountAssessment?.fit).toBe('within_typical');
    expect(a.amountAssessment?.message).toContain('£15,000–£31,000');
  });

  it('flags an ask above what the funder typically awards', () => {
    const a = assessOpportunity(
      input({ project: { ...project, amountSoughtGbp: 38_000 } }),
    );
    expect(a.amountAssessment?.fit).toBe('above_typical');
    expect(a.amountAssessment?.message).toContain('justify');
  });

  it('offers no amount comparison when there is too little award data', () => {
    const a = assessOpportunity(input({ awards: awards.slice(0, 2) }));
    expect(a.funderBehaviour.kind).toBe('too_few_awards');
    expect(a.amountAssessment).toBeNull();
  });

  it('offers no amount comparison when the ask is unknown', () => {
    const a = assessOpportunity(
      input({ project: { ...project, amountSoughtGbp: null } }),
    );
    expect(a.amountAssessment).toBeNull();
  });

  it('always tells the user to verify with the funder', () => {
    expect(assessOpportunity(input()).verifyNotice).toBe(VERIFY_NOTICE);
  });

  it('never predicts success anywhere in its output', () => {
    const a = assessOpportunity(input());
    const text = JSON.stringify(a).toLowerCase();
    expect(text).not.toContain('probab');
    expect(text).not.toContain('chance of');
    expect(text).not.toContain('likely to succeed');
  });
});

describe('describeDeadline', () => {
  it('states a confirmed deadline plainly', () => {
    const n = describeDeadline('2026-11-30', 'confirmed');
    expect(n.tone).toBe('neutral');
    expect(n.text).toContain('confirmed by the funder');
  });

  it('flags a confirmed deadline with no date as a problem', () => {
    expect(describeDeadline(null, 'confirmed').tone).toBe('caution');
  });

  it('never lets an estimate read as confirmed', () => {
    const n = describeDeadline('2026-11-30', 'estimated');
    expect(n.tone).toBe('caution');
    expect(n.text).toContain('our estimate, not a published date');
    expect(n.text).not.toContain('confirmed');
  });

  it('marks an expected deadline as unconfirmed', () => {
    expect(describeDeadline('2026-11-30', 'expected').text).toContain('not confirmed');
    expect(describeDeadline(null, 'expected').text).toContain('not been announced');
  });

  it('handles rolling and unknown', () => {
    expect(describeDeadline(null, 'rolling').tone).toBe('neutral');
    expect(describeDeadline(null, 'unknown').tone).toBe('caution');
    expect(describeDeadline(null, 'estimated').text).toContain('no deadline');
  });
});

describe('describeFreshness', () => {
  const on = '2026-09-01T00:00:00Z';

  it('treats current and recently verified as neutral', () => {
    expect(describeFreshness('current', on).tone).toBe('neutral');
    expect(describeFreshness('recently_verified', on).tone).toBe('neutral');
  });

  it('cautions on everything else', () => {
    for (const state of ['needs_verification', 'stale', 'closed', 'unknown'] as const) {
      expect(describeFreshness(state, on).tone, state).toBe('caution');
    }
  });

  it('says plainly when a fund is closed', () => {
    expect(describeFreshness('closed', on).text).toContain('closed to applications');
  });

  it('shows the retrieval date so the user can judge for themselves', () => {
    expect(describeFreshness('stale', on).text).toContain('2026-09-01');
  });
});

describe('toOpenQuestion', () => {
  it('keeps the criterion’s own action when it has one', () => {
    const q = toOpenQuestion({
      criterionId: 'c',
      label: 'Legal form',
      outcome: 'unknown',
      reason: 'Not stated.',
      action: 'Ask the funder.',
    });
    expect(q.action).toBe('Ask the funder.');
  });

  it('supplies a fallback so no question is left with nothing to do', () => {
    const q = toOpenQuestion({
      criterionId: 'c',
      label: 'Something',
      outcome: 'unknown',
      reason: 'Unclear.',
    });
    expect(q.action).toBe('Confirm this before applying.');
  });
});

describe('headline edge cases', () => {
  it('says the amount is unknown rather than showing a blank', () => {
    const a = assessOpportunity(
      input({
        project: { ...project, amountSoughtGbp: null },
        criteria: [
          { kind: 'legal_form', id: 'lf', label: 'Legal form', cicTreatment: 'explicitly_permitted' },
        ],
      }),
    );
    expect(a.eligibility.verdict).toBe('eligible');
    expect(a.headline).toContain('An unknown amount');
  });

  it('uses the singular for a one-hour application', () => {
    const a = assessOpportunity(
      input({
        features: {
          questionCount: 0,
          totalWordBudget: 0,
          requiredAttachments: 0,
          requiresLatestAccounts: false,
          requiredPolicies: [],
          requiresMatchFunding: false,
          requiresBudgetTemplate: false,
        },
      }),
    );
    expect(a.effort.hours).toBe(1);
    expect(a.headline).toContain('about 1 hour of work');
    expect(a.headline).not.toContain('1 hours');
  });
});

describe('an opportunity whose form nobody has seen', () => {
  it('reports the effort as unknown rather than as one hour', () => {
    // A pasted fund has no known question set. estimateEffort over empty
    // features returns the base hour for reading the guidance, and presenting
    // that as real produced "£30,000 for about 1 hour of work" — a spectacular
    // value-per-hour derived entirely from ignorance.
    const result = assessOpportunity(input({ featuresKnown: false }));
    expect(result.effortKnown).toBe(false);
    expect(result.headline).toContain('an unknown amount of work');
    expect(result.headline).not.toMatch(/about \d+ hours?/u);
  });

  it('makes no claim about value per hour', () => {
    const result = assessOpportunity(input({ featuresKnown: false }));
    expect(result.recommendation.valuePerHour).toBeNull();
    expect(result.recommendation.reason).toContain('no honest way to weigh');
    expect(result.recommendation.reason).not.toMatch(/per hour/u);
  });

  it('still rules out a fund the applicant cannot apply for', () => {
    // Not knowing how long the form is does not make a hard exclusion
    // uncertain. Eligibility decides regardless.
    const ineligible = assessOpportunity(
      input({
        featuresKnown: false,
        criteria: [
          {
            kind: 'legal_form',
            id: 'c_charity',
            label: 'Registered charities only',
            cicTreatment: 'charity_only',
            permittedForms: null,
          },
        ],
      }),
    );
    expect(ineligible.eligibility.verdict).toBe('ineligible');
    expect(ineligible.recommendation.recommendation).toBe('not_recommended');
  });

  it('treats a known form as known, which is the default', () => {
    expect(assessOpportunity(input()).effortKnown).toBe(true);
  });
});
