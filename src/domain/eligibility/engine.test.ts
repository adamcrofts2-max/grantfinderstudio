import { describe, expect, it } from 'vitest';
import type { ApplicantProfile, ProjectRequest } from '../types.js';
import { evaluateEligibility, monthsBetween } from './engine.js';
import type { Criterion, EvaluationContext } from './types.js';

const CONTEXT: EvaluationContext = { asOf: '2026-09-06' };

const cicGuarantee: ApplicantProfile = {
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

function legalForm(overrides: Partial<Extract<Criterion, { kind: 'legal_form' }>> = {}) {
  return {
    kind: 'legal_form' as const,
    id: 'lf',
    label: 'Legal form',
    cicTreatment: 'explicitly_permitted' as const,
    ...overrides,
  };
}

describe('monthsBetween', () => {
  it('counts whole months', () => {
    expect(monthsBetween('2025-01-15', '2026-01-15')).toBe(12);
  });

  it('does not count a partial final month', () => {
    expect(monthsBetween('2025-01-20', '2026-01-15')).toBe(11);
  });

  it('returns zero within the same month', () => {
    expect(monthsBetween('2026-09-01', '2026-09-06')).toBe(0);
  });

  it('returns a negative value when the dates are reversed', () => {
    expect(monthsBetween('2026-09-06', '2026-03-06')).toBe(-6);
  });
});

describe('CIC legal-form treatment', () => {
  it('passes when CICs are explicitly permitted', () => {
    const v = evaluateEligibility(cicGuarantee, project, [legalForm()], CONTEXT);
    expect(v.verdict).toBe('eligible');
    expect(v.results[0]?.outcome).toBe('pass');
  });

  it('fails a CIC against a charity-only funder', () => {
    const v = evaluateEligibility(
      cicGuarantee,
      project,
      [legalForm({ cicTreatment: 'charity_only' })],
      CONTEXT,
    );
    expect(v.verdict).toBe('ineligible');
    expect(v.failures[0]?.reason).toContain('not a registered charity');
  });

  it('passes an asset-lock requirement because every CIC has one', () => {
    const v = evaluateEligibility(
      cicGuarantee,
      project,
      [legalForm({ cicTreatment: 'asset_locked_only' })],
      CONTEXT,
    );
    expect(v.verdict).toBe('eligible');
    expect(v.results[0]?.reason).toContain('statutory asset lock');
  });

  it('passes a CIC limited by shares on the asset-lock test', () => {
    const shares: ApplicantProfile = { ...cicGuarantee, legalForm: 'cic_limited_by_shares' };
    const v = evaluateEligibility(
      shares,
      project,
      [legalForm({ cicTreatment: 'asset_locked_only' })],
      CONTEXT,
    );
    expect(v.verdict).toBe('eligible');
  });

  it('fails a share-capital CIC against a limited-by-guarantee-only funder', () => {
    const shares: ApplicantProfile = { ...cicGuarantee, legalForm: 'cic_limited_by_shares' };
    const v = evaluateEligibility(
      shares,
      project,
      [legalForm({ cicTreatment: 'limited_by_guarantee_only' })],
      CONTEXT,
    );
    expect(v.verdict).toBe('ineligible');
  });

  it('passes a guarantee CIC against a limited-by-guarantee-only funder', () => {
    const v = evaluateEligibility(
      cicGuarantee,
      project,
      [legalForm({ cicTreatment: 'limited_by_guarantee_only' })],
      CONTEXT,
    );
    expect(v.verdict).toBe('eligible');
  });

  it('fails a share-capital CIC where no share capital is permitted', () => {
    const shares: ApplicantProfile = { ...cicGuarantee, legalForm: 'cic_limited_by_shares' };
    const v = evaluateEligibility(
      shares,
      project,
      [legalForm({ cicTreatment: 'no_share_capital_only' })],
      CONTEXT,
    );
    expect(v.verdict).toBe('ineligible');
  });

  it('passes a guarantee CIC where no share capital is permitted', () => {
    const v = evaluateEligibility(
      cicGuarantee,
      project,
      [legalForm({ cicTreatment: 'no_share_capital_only' })],
      CONTEXT,
    );
    expect(v.verdict).toBe('eligible');
  });

  it('returns unknown with the conditions when CICs are permitted conditionally', () => {
    const v = evaluateEligibility(
      cicGuarantee,
      project,
      [legalForm({ cicTreatment: 'permitted_with_conditions', conditions: 'must have an asset lock' })],
      CONTEXT,
    );
    expect(v.verdict).toBe('unknown');
    expect(v.unknowns[0]?.reason).toContain('must have an asset lock');
  });

  it('returns unknown when conditions are not detailed', () => {
    const v = evaluateEligibility(
      cicGuarantee,
      project,
      [legalForm({ cicTreatment: 'permitted_with_conditions' })],
      CONTEXT,
    );
    expect(v.unknowns[0]?.reason).toContain('has not detailed');
  });

  it('suggests asking the funder when CIC treatment is not stated', () => {
    const v = evaluateEligibility(
      cicGuarantee,
      project,
      [legalForm({ cicTreatment: 'not_stated' })],
      CONTEXT,
    );
    expect(v.verdict).toBe('unknown');
    expect(v.unknowns[0]?.action).toContain('Ask the funder');
  });
});

describe('non-CIC legal forms', () => {
  const charity: ApplicantProfile = { ...cicGuarantee, legalForm: 'charity' };

  it('passes when the form is on the permitted list', () => {
    const v = evaluateEligibility(
      charity,
      project,
      [legalForm({ permittedForms: ['charity', 'cic_limited_by_guarantee'] })],
      CONTEXT,
    );
    expect(v.verdict).toBe('eligible');
  });

  it('fails when the form is not on the permitted list', () => {
    const v = evaluateEligibility(
      charity,
      project,
      [legalForm({ permittedForms: ['community_benefit_society'] })],
      CONTEXT,
    );
    expect(v.verdict).toBe('ineligible');
  });

  it('returns unknown when no permitted list is stated', () => {
    const v = evaluateEligibility(charity, project, [legalForm()], CONTEXT);
    expect(v.verdict).toBe('unknown');
  });

  it('returns unknown when the permitted list is empty', () => {
    const v = evaluateEligibility(
      charity,
      project,
      [legalForm({ permittedForms: [] })],
      CONTEXT,
    );
    expect(v.verdict).toBe('unknown');
  });
});

describe('jurisdiction and region', () => {
  it('passes when the jurisdiction is permitted', () => {
    const c: Criterion = { kind: 'jurisdiction', id: 'j', label: 'Area', permitted: ['england'] };
    const v = evaluateEligibility(cicGuarantee, project, [c], CONTEXT);
    expect(v.verdict).toBe('eligible');
    // The reason is shown to the user, so it must read as English, not as an enum.
    expect(v.results[0]?.reason).toBe("England is within the funder's area.");
  });

  it('writes a mismatch reason in prose, not enum values', () => {
    const c: Criterion = {
      kind: 'jurisdiction', id: 'j', label: 'Area', permitted: ['scotland', 'northern_ireland'],
    };
    const v = evaluateEligibility(cicGuarantee, project, [c], CONTEXT);
    expect(v.failures[0]?.reason).toBe(
      'The funder covers Scotland and Northern Ireland, not England.',
    );
  });

  it('passes any jurisdiction for a UK-wide fund', () => {
    const scot: ApplicantProfile = { ...cicGuarantee, jurisdiction: 'scotland' };
    const c: Criterion = { kind: 'jurisdiction', id: 'j', label: 'Area', permitted: ['uk_wide'] };
    expect(evaluateEligibility(scot, project, [c], CONTEXT).verdict).toBe('eligible');
  });

  it('passes a UK-wide applicant against a single-jurisdiction fund', () => {
    const ukWide: ApplicantProfile = { ...cicGuarantee, jurisdiction: 'uk_wide' };
    const c: Criterion = { kind: 'jurisdiction', id: 'j', label: 'Area', permitted: ['wales'] };
    expect(evaluateEligibility(ukWide, project, [c], CONTEXT).verdict).toBe('eligible');
  });

  it('fails a mismatched jurisdiction', () => {
    const c: Criterion = { kind: 'jurisdiction', id: 'j', label: 'Area', permitted: ['scotland'] };
    expect(evaluateEligibility(cicGuarantee, project, [c], CONTEXT).verdict).toBe('ineligible');
  });

  it('matches region case-insensitively', () => {
    const c: Criterion = { kind: 'region', id: 'r', label: 'Region', permittedRegions: ['SOMERSET'] };
    expect(evaluateEligibility(cicGuarantee, project, [c], CONTEXT).verdict).toBe('eligible');
  });

  it('fails an unmatched region', () => {
    const c: Criterion = { kind: 'region', id: 'r', label: 'Region', permittedRegions: ['Cumbria'] };
    expect(evaluateEligibility(cicGuarantee, project, [c], CONTEXT).verdict).toBe('ineligible');
  });

  it('returns unknown when the region is not known', () => {
    const noRegion: ApplicantProfile = { ...cicGuarantee, region: null };
    const c: Criterion = { kind: 'region', id: 'r', label: 'Region', permittedRegions: ['Somerset'] };
    expect(evaluateEligibility(noRegion, project, [c], CONTEXT).verdict).toBe('unknown');
  });
});

describe('amount', () => {
  const range: Criterion = { kind: 'amount', id: 'a', label: 'Amount', minGbp: 10_000, maxGbp: 50_000 };

  it('passes within range', () => {
    expect(evaluateEligibility(cicGuarantee, project, [range], CONTEXT).verdict).toBe('eligible');
  });

  it('fails below the minimum', () => {
    const small = { ...project, amountSoughtGbp: 5_000 };
    expect(evaluateEligibility(cicGuarantee, small, [range], CONTEXT).verdict).toBe('ineligible');
  });

  it('fails above the maximum', () => {
    const big = { ...project, amountSoughtGbp: 90_000 };
    const v = evaluateEligibility(cicGuarantee, big, [range], CONTEXT);
    expect(v.verdict).toBe('ineligible');
    expect(v.failures[0]?.reason).toContain('£90,000');
  });

  it('returns unknown when the amount is not known', () => {
    const none = { ...project, amountSoughtGbp: null };
    expect(evaluateEligibility(cicGuarantee, none, [range], CONTEXT).verdict).toBe('unknown');
  });

  it('handles an open-ended upper bound', () => {
    const openMax: Criterion = { kind: 'amount', id: 'a', label: 'Amount', minGbp: 1_000, maxGbp: null };
    const v = evaluateEligibility(cicGuarantee, project, [openMax], CONTEXT);
    expect(v.verdict).toBe('eligible');
    expect(v.results[0]?.reason).toContain('or more');
  });

  it('handles an open-ended lower bound', () => {
    const openMin: Criterion = { kind: 'amount', id: 'a', label: 'Amount', minGbp: null, maxGbp: 50_000 };
    const v = evaluateEligibility(cicGuarantee, project, [openMin], CONTEXT);
    expect(v.results[0]?.reason).toContain('up to');
  });

  it('describes an unbounded range', () => {
    const open: Criterion = { kind: 'amount', id: 'a', label: 'Amount', minGbp: null, maxGbp: null };
    const v = evaluateEligibility(cicGuarantee, project, [open], CONTEXT);
    expect(v.results[0]?.reason).toContain('any amount');
  });
});

describe('organisation age', () => {
  const twoYears: Criterion = { kind: 'organisation_age', id: 'age', label: 'Trading history', minMonths: 24 };

  it('passes an established organisation', () => {
    expect(evaluateEligibility(cicGuarantee, project, [twoYears], CONTEXT).verdict).toBe('eligible');
  });

  it('fails a young organisation and states both numbers', () => {
    const young: ApplicantProfile = { ...cicGuarantee, incorporationDate: '2025-06-01' };
    const v = evaluateEligibility(young, project, [twoYears], CONTEXT);
    expect(v.verdict).toBe('ineligible');
    expect(v.failures[0]?.reason).toContain('24 months');
    expect(v.failures[0]?.reason).toContain('15');
  });

  it('returns unknown and asks for the company number when the date is missing', () => {
    const unknownDate: ApplicantProfile = { ...cicGuarantee, incorporationDate: null };
    const v = evaluateEligibility(unknownDate, project, [twoYears], CONTEXT);
    expect(v.verdict).toBe('unknown');
    expect(v.unknowns[0]?.action).toContain('company number');
  });
});

describe('turnover, match funding, capital/revenue, beneficiary, duration', () => {
  it('passes turnover within range', () => {
    const c: Criterion = { kind: 'turnover', id: 't', label: 'Turnover', minGbp: 50_000, maxGbp: 500_000 };
    expect(evaluateEligibility(cicGuarantee, project, [c], CONTEXT).verdict).toBe('eligible');
  });

  it('fails turnover outside range', () => {
    const c: Criterion = { kind: 'turnover', id: 't', label: 'Turnover', minGbp: null, maxGbp: 50_000 };
    expect(evaluateEligibility(cicGuarantee, project, [c], CONTEXT).verdict).toBe('ineligible');
  });

  it('returns unknown when turnover is not known', () => {
    const noTurnover: ApplicantProfile = { ...cicGuarantee, annualTurnoverGbp: null };
    const c: Criterion = { kind: 'turnover', id: 't', label: 'Turnover', minGbp: 1, maxGbp: null };
    expect(evaluateEligibility(noTurnover, project, [c], CONTEXT).verdict).toBe('unknown');
  });

  it('passes when match funding is not required', () => {
    const c: Criterion = { kind: 'match_funding', id: 'm', label: 'Match funding', required: false };
    expect(evaluateEligibility(cicGuarantee, project, [c], CONTEXT).verdict).toBe('eligible');
  });

  it('fails when match funding is required and absent', () => {
    const c: Criterion = { kind: 'match_funding', id: 'm', label: 'Match funding', required: true };
    expect(evaluateEligibility(cicGuarantee, project, [c], CONTEXT).verdict).toBe('ineligible');
  });

  it('passes when match funding is required and present', () => {
    const c: Criterion = { kind: 'match_funding', id: 'm', label: 'Match funding', required: true };
    const withMatch = { ...project, hasMatchFunding: true };
    expect(evaluateEligibility(cicGuarantee, withMatch, [c], CONTEXT).verdict).toBe('eligible');
  });

  it('returns unknown when match funding status is unknown', () => {
    const c: Criterion = { kind: 'match_funding', id: 'm', label: 'Match funding', required: true };
    const unsure = { ...project, hasMatchFunding: null };
    expect(evaluateEligibility(cicGuarantee, unsure, [c], CONTEXT).verdict).toBe('unknown');
  });

  it('passes revenue costs against a revenue funder', () => {
    const c: Criterion = { kind: 'capital_revenue', id: 'cr', label: 'Cost type', permitted: ['revenue'] };
    expect(evaluateEligibility(cicGuarantee, project, [c], CONTEXT).verdict).toBe('eligible');
  });

  it('fails revenue costs against a capital-only funder', () => {
    const c: Criterion = { kind: 'capital_revenue', id: 'cr', label: 'Cost type', permitted: ['capital'] };
    expect(evaluateEligibility(cicGuarantee, project, [c], CONTEXT).verdict).toBe('ineligible');
  });

  it('requires both permissions for a mixed project', () => {
    const c: Criterion = { kind: 'capital_revenue', id: 'cr', label: 'Cost type', permitted: ['revenue'] };
    const mixed = { ...project, capitalOrRevenue: 'mixed' as const };
    expect(evaluateEligibility(cicGuarantee, mixed, [c], CONTEXT).verdict).toBe('ineligible');
  });

  it('passes a mixed project when both are permitted', () => {
    const c: Criterion = {
      kind: 'capital_revenue', id: 'cr', label: 'Cost type', permitted: ['capital', 'revenue'],
    };
    const mixed = { ...project, capitalOrRevenue: 'mixed' as const };
    expect(evaluateEligibility(cicGuarantee, mixed, [c], CONTEXT).verdict).toBe('eligible');
  });

  it('returns unknown when the cost type is not known', () => {
    const c: Criterion = { kind: 'capital_revenue', id: 'cr', label: 'Cost type', permitted: ['revenue'] };
    const unsure = { ...project, capitalOrRevenue: null };
    expect(evaluateEligibility(cicGuarantee, unsure, [c], CONTEXT).verdict).toBe('unknown');
  });

  it('passes a matching beneficiary group', () => {
    const c: Criterion = { kind: 'beneficiary', id: 'b', label: 'Beneficiaries', anyOf: ['Young People'] };
    expect(evaluateEligibility(cicGuarantee, project, [c], CONTEXT).verdict).toBe('eligible');
  });

  it('fails when no beneficiary group matches', () => {
    const c: Criterion = { kind: 'beneficiary', id: 'b', label: 'Beneficiaries', anyOf: ['older people'] };
    expect(evaluateEligibility(cicGuarantee, project, [c], CONTEXT).verdict).toBe('ineligible');
  });

  it('returns unknown when no beneficiary groups are recorded', () => {
    const c: Criterion = { kind: 'beneficiary', id: 'b', label: 'Beneficiaries', anyOf: ['young people'] };
    const none = { ...project, beneficiaryGroups: [] };
    expect(evaluateEligibility(cicGuarantee, none, [c], CONTEXT).verdict).toBe('unknown');
  });

  it('passes a duration within limits', () => {
    const c: Criterion = { kind: 'duration', id: 'd', label: 'Duration', minMonths: 6, maxMonths: 24 };
    expect(evaluateEligibility(cicGuarantee, project, [c], CONTEXT).verdict).toBe('eligible');
  });

  it('fails a duration outside limits', () => {
    const c: Criterion = { kind: 'duration', id: 'd', label: 'Duration', minMonths: null, maxMonths: 6 };
    expect(evaluateEligibility(cicGuarantee, project, [c], CONTEXT).verdict).toBe('ineligible');
  });

  it('returns unknown when the duration is not known', () => {
    const c: Criterion = { kind: 'duration', id: 'd', label: 'Duration', minMonths: 6, maxMonths: null };
    const none = { ...project, durationMonths: null };
    expect(evaluateEligibility(cicGuarantee, none, [c], CONTEXT).verdict).toBe('unknown');
  });
});

describe('verdict combination', () => {
  it('treats an empty criteria set as unknown, not eligible', () => {
    const v = evaluateEligibility(cicGuarantee, project, [], CONTEXT);
    expect(v.verdict).toBe('unknown');
  });

  it('lets a failure dominate an unknown', () => {
    const criteria: Criterion[] = [
      legalForm({ cicTreatment: 'charity_only' }),
      { kind: 'region', id: 'r', label: 'Region', permittedRegions: ['Somerset'] },
      { kind: 'turnover', id: 't', label: 'Turnover', minGbp: 1, maxGbp: null },
    ];
    const noTurnover: ApplicantProfile = { ...cicGuarantee, annualTurnoverGbp: null };
    const v = evaluateEligibility(noTurnover, project, criteria, CONTEXT);
    expect(v.verdict).toBe('ineligible');
    expect(v.failures).toHaveLength(1);
    expect(v.unknowns).toHaveLength(1);
  });

  it('never coerces an unknown into a pass', () => {
    const criteria: Criterion[] = [
      legalForm(),
      { kind: 'amount', id: 'a', label: 'Amount', minGbp: 1_000, maxGbp: 100_000 },
      legalForm({ id: 'lf2', cicTreatment: 'not_stated' }),
    ];
    const v = evaluateEligibility(cicGuarantee, project, criteria, CONTEXT);
    expect(v.verdict).toBe('unknown');
    expect(v.results.filter((r) => r.outcome === 'pass')).toHaveLength(2);
  });

  it('returns eligible only when every criterion passes', () => {
    const criteria: Criterion[] = [
      legalForm(),
      { kind: 'jurisdiction', id: 'j', label: 'Area', permitted: ['england'] },
      { kind: 'amount', id: 'a', label: 'Amount', minGbp: 10_000, maxGbp: 50_000 },
      { kind: 'organisation_age', id: 'age', label: 'Age', minMonths: 24 },
    ];
    const v = evaluateEligibility(cicGuarantee, project, criteria, CONTEXT);
    expect(v.verdict).toBe('eligible');
    expect(v.results).toHaveLength(4);
    expect(v.failures).toHaveLength(0);
    expect(v.unknowns).toHaveLength(0);
  });

  it('gives every result a reason, including passes', () => {
    const criteria: Criterion[] = [
      legalForm(),
      { kind: 'jurisdiction', id: 'j', label: 'Area', permitted: ['england'] },
    ];
    const v = evaluateEligibility(cicGuarantee, project, criteria, CONTEXT);
    for (const r of v.results) expect(r.reason.length).toBeGreaterThan(0);
  });
});
