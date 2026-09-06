import { describe, expect, it } from 'vitest';
import {
  budgetTotal,
  validateBudget,
  type BudgetLine,
  type FunderRestrictions,
} from './validate.js';

const permissive: FunderRestrictions = {
  excludedCategories: [],
  maxOverheadPercent: null,
  capitalPermitted: true,
  revenuePermitted: true,
  minTotalGbp: null,
  maxTotalGbp: null,
};

const lines: BudgetLine[] = [
  { id: 'l1', category: 'staff', description: 'Project worker', amountGbp: 24_000 },
  { id: 'l2', category: 'materials', description: 'Tools and materials', amountGbp: 4_000 },
  { id: 'l3', category: 'overheads', description: 'Overheads', amountGbp: 2_000 },
];

function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code);
}

describe('budgetTotal', () => {
  it('sums the lines', () => {
    expect(budgetTotal(lines)).toBe(30_000);
  });

  it('is zero for an empty budget', () => {
    expect(budgetTotal([])).toBe(0);
  });
});

describe('validateBudget', () => {
  it('accepts a consistent budget', () => {
    const v = validateBudget(lines, permissive, 30_000);
    expect(v.isSubmittable).toBe(true);
    expect(v.findings).toHaveLength(0);
    expect(v.totalGbp).toBe(30_000);
  });

  it('rejects an empty budget', () => {
    const v = validateBudget([], permissive, 30_000);
    expect(v.isSubmittable).toBe(false);
    expect(codes(v.findings)).toContain('budget_empty');
  });

  it('catches a total that does not match the amount requested', () => {
    const v = validateBudget(lines, permissive, 25_000);
    expect(codes(v.findings)).toContain('total_mismatch');
    expect(v.findings[0]?.message).toContain('£30,000');
    expect(v.findings[0]?.message).toContain('£25,000');
  });

  it('tolerates rounding to the penny', () => {
    const v = validateBudget(lines, permissive, 30_000.004);
    expect(codes(v.findings)).not.toContain('total_mismatch');
  });

  it('warns rather than errors when the amount requested is unknown', () => {
    const v = validateBudget(lines, permissive, null);
    expect(v.isSubmittable).toBe(true);
    expect(codes(v.findings)).toContain('amount_requested_unknown');
  });

  it('rejects a non-positive line', () => {
    const bad = [...lines, { id: 'l4', category: 'travel' as const, description: 'Travel', amountGbp: 0 }];
    const v = validateBudget(bad, permissive, 30_000);
    expect(codes(v.findings)).toContain('line_not_positive');
  });

  it('rejects an excluded category and names the line', () => {
    const restricted = { ...permissive, excludedCategories: ['overheads' as const] };
    const v = validateBudget(lines, restricted, 30_000);
    const finding = v.findings.find((f) => f.code === 'category_excluded');
    expect(finding?.lineId).toBe('l3');
    expect(finding?.message).toContain('Overheads');
  });

  it('enforces an overhead cap', () => {
    // Overheads are 2,000 of 30,000 = 6.67%
    const capped = { ...permissive, maxOverheadPercent: 5 };
    const v = validateBudget(lines, capped, 30_000);
    const finding = v.findings.find((f) => f.code === 'overheads_exceed_cap');
    expect(finding?.message).toContain('6.7%');
    expect(finding?.message).toContain('5%');
  });

  it('allows overheads within the cap', () => {
    const capped = { ...permissive, maxOverheadPercent: 10 };
    expect(validateBudget(lines, capped, 30_000).isSubmittable).toBe(true);
  });

  it('does not divide by zero when the total is zero', () => {
    const capped = { ...permissive, maxOverheadPercent: 5 };
    const v = validateBudget([], capped, null);
    expect(codes(v.findings)).not.toContain('overheads_exceed_cap');
  });

  it('rejects capital lines for a revenue-only funder', () => {
    const revenueOnly = { ...permissive, capitalPermitted: false };
    const withCapital = [
      ...lines,
      { id: 'l4', category: 'equipment' as const, description: 'Minibus', amountGbp: 1 },
    ];
    const v = validateBudget(withCapital, revenueOnly, 30_001);
    const finding = v.findings.find((f) => f.code === 'capital_not_permitted');
    expect(finding?.lineId).toBe('l4');
  });

  it('rejects running costs for a capital-only funder', () => {
    const capitalOnly = { ...permissive, revenuePermitted: false };
    const v = validateBudget(lines, capitalOnly, 30_000);
    expect(codes(v.findings)).toContain('revenue_not_permitted');
  });

  it('enforces a minimum total', () => {
    const v = validateBudget(lines, { ...permissive, minTotalGbp: 50_000 }, 30_000);
    expect(codes(v.findings)).toContain('total_below_minimum');
  });

  it('enforces a maximum total', () => {
    const v = validateBudget(lines, { ...permissive, maxTotalGbp: 20_000 }, 30_000);
    expect(codes(v.findings)).toContain('total_above_maximum');
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const hostile: FunderRestrictions = {
      excludedCategories: ['overheads'],
      maxOverheadPercent: 1,
      capitalPermitted: true,
      revenuePermitted: true,
      minTotalGbp: 40_000,
      maxTotalGbp: null,
    };
    const v = validateBudget(lines, hostile, 25_000);
    expect(codes(v.findings)).toEqual(
      expect.arrayContaining([
        'category_excluded',
        'overheads_exceed_cap',
        'total_below_minimum',
        'total_mismatch',
      ]),
    );
    expect(v.isSubmittable).toBe(false);
  });
});
