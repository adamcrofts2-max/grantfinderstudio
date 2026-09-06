import { describe, expect, it } from 'vitest';
import { mapCriteria, mapCriterion, type CriterionRow } from './criteria-mapper.js';

function row(overrides: Partial<CriterionRow> = {}): CriterionRow {
  return {
    id: 'c1',
    kind: 'amount',
    label: 'Grant size',
    params: { minGbp: 5000, maxGbp: 50_000 },
    cic_handling: null,
    ...overrides,
  };
}

describe('mapCriterion', () => {
  it('maps an amount criterion with both bounds', () => {
    const r = mapCriterion(row());
    expect(r).toEqual({
      ok: true,
      criterion: { id: 'c1', label: 'Grant size', kind: 'amount', minGbp: 5000, maxGbp: 50_000 },
    });
  });

  it('accepts an explicit null bound', () => {
    const r = mapCriterion(row({ params: { minGbp: null, maxGbp: 50_000 } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.criterion).toMatchObject({ minGbp: null, maxGbp: 50_000 });
  });

  /**
   * The important one. A missing bound must not be read as "no limit" — that
   * would turn a hard exclusion into a pass.
   */
  it('rejects a missing bound rather than treating it as unlimited', () => {
    const r = mapCriterion(row({ params: { minGbp: 5000 } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('maxGbp');
  });

  it('rejects a bound of the wrong type', () => {
    expect(mapCriterion(row({ params: { minGbp: '5000', maxGbp: null } })).ok).toBe(false);
    expect(mapCriterion(row({ params: { minGbp: Number.NaN, maxGbp: null } })).ok).toBe(false);
  });

  it('maps a legal_form criterion using its cic_handling column', () => {
    const r = mapCriterion(
      row({ kind: 'legal_form', label: 'Legal form', params: {}, cic_handling: 'charity_only' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.criterion).toMatchObject({ kind: 'legal_form', cicTreatment: 'charity_only' });
  });

  it('rejects a legal_form criterion with no cic_handling', () => {
    const r = mapCriterion(row({ kind: 'legal_form', params: {}, cic_handling: null }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('cic_handling');
  });

  it('rejects an unrecognised cic_handling value', () => {
    const r = mapCriterion(row({ kind: 'legal_form', params: {}, cic_handling: 'maybe' }));
    expect(r.ok).toBe(false);
  });

  it('carries conditions and permitted forms when present', () => {
    const r = mapCriterion(
      row({
        kind: 'legal_form',
        params: { conditions: 'must be asset locked', permittedForms: ['charity'] },
        cic_handling: 'permitted_with_conditions',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.criterion).toMatchObject({
      conditions: 'must be asset locked',
      permittedForms: ['charity'],
    });
  });

  it.each([
    ['jurisdiction', { permitted: ['england'] }],
    ['region', { permittedRegions: ['Somerset'] }],
    ['organisation_age', { minMonths: 24 }],
    ['turnover', { minGbp: null, maxGbp: 500_000 }],
    ['match_funding', { required: true }],
    ['capital_revenue', { permitted: ['revenue'] }],
    ['beneficiary', { anyOf: ['young people'] }],
    ['duration', { minMonths: null, maxMonths: 24 }],
  ])('maps a %s criterion', (kind, params) => {
    const r = mapCriterion(row({ kind, params }));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.criterion.kind).toBe(kind);
  });

  it('rejects an empty list where one is required', () => {
    expect(mapCriterion(row({ kind: 'jurisdiction', params: { permitted: [] } })).ok).toBe(false);
    expect(mapCriterion(row({ kind: 'beneficiary', params: { anyOf: [] } })).ok).toBe(false);
  });

  it('rejects a list containing non-strings', () => {
    const r = mapCriterion(row({ kind: 'region', params: { permittedRegions: ['Somerset', 7] } }));
    expect(r.ok).toBe(false);
  });

  it('rejects a missing required boolean rather than defaulting it', () => {
    const r = mapCriterion(row({ kind: 'match_funding', params: {} }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('required');
  });

  it('rejects a missing required number', () => {
    expect(mapCriterion(row({ kind: 'organisation_age', params: {} })).ok).toBe(false);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'nope'],
  ])('rejects params that are %s', (_label, params) => {
    const r = mapCriterion(row({ params }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('params');
  });

  it('rejects an unknown kind', () => {
    const r = mapCriterion(row({ kind: 'vibes', params: {} }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('unknown criterion kind');
  });
});

describe('mapCriteria', () => {
  it('separates usable criteria from rejected rows', () => {
    const batch = mapCriteria([
      row({ id: 'good' }),
      row({ id: 'bad', params: { minGbp: 1 } }),
      row({ id: 'also-good', kind: 'match_funding', params: { required: false } }),
    ]);
    expect(batch.criteria.map((c) => c.id)).toEqual(['good', 'also-good']);
    expect(batch.rejected.map((r) => r.id)).toEqual(['bad']);
  });

  it('gives every rejection a reason', () => {
    const batch = mapCriteria([row({ id: 'x', kind: 'nonsense', params: {} })]);
    expect(batch.rejected[0]?.reason.length).toBeGreaterThan(0);
  });

  it('returns empty for no rows', () => {
    expect(mapCriteria([])).toEqual({ criteria: [], rejected: [] });
  });
});
