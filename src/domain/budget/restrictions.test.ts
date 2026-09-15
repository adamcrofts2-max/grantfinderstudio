/**
 * Where a funder's budget rules may honestly come from.
 *
 * The interface `validateBudget` takes is wider than anything we can know, so
 * the job of these tests is to pin the gap shut: what the verified criteria
 * supply, what they cannot, and that the unknown half is never guessed.
 */
import { describe, expect, it } from 'vitest';

import { restrictionsFromCriteria } from './restrictions.js';
import type { Criterion } from '../eligibility/types.js';

const amount = (minGbp: number | null, maxGbp: number | null): Criterion => ({
  kind: 'amount',
  id: 'a',
  label: 'Amount',
  minGbp,
  maxGbp,
});

describe('with nothing verified', () => {
  const result = restrictionsFromCriteria([]);

  it('permits both capital and running costs', () => {
    // `unknown` is never coerced to a fail. Refusing every line because the
    // funder published no cost-type rule would be inventing a restriction.
    expect(result.restrictions.capitalPermitted).toBe(true);
    expect(result.restrictions.revenuePermitted).toBe(true);
  });

  it('sets no total bounds', () => {
    expect(result.restrictions.minTotalGbp).toBeNull();
    expect(result.restrictions.maxTotalGbp).toBeNull();
  });

  it('claims to know nothing', () => {
    expect(result.known).toEqual([]);
  });

  it('says what it could not check', () => {
    expect(result.unknown).toContain('the size of grant they give');
    expect(result.unknown).toContain('whether they fund capital or running costs');
  });
});

describe('with an amount criterion', () => {
  it('takes the funder’s own range', () => {
    const { restrictions, known } = restrictionsFromCriteria([amount(5000, 50_000)]);
    expect(restrictions.minTotalGbp).toBe(5000);
    expect(restrictions.maxTotalGbp).toBe(50_000);
    expect(known).toContain('they give between £5,000 and £50,000');
  });

  it('reads a one-sided range as one-sided', () => {
    expect(restrictionsFromCriteria([amount(null, 10_000)]).known).toContain(
      'they give up to £10,000',
    );
    expect(restrictionsFromCriteria([amount(1000, null)]).known).toContain(
      'they give at least £1,000',
    );
  });

  it('stops listing the grant size as unknown', () => {
    expect(restrictionsFromCriteria([amount(5000, 50_000)]).unknown).not.toContain(
      'the size of grant they give',
    );
  });
});

const costType = (permitted: Array<'capital' | 'revenue' | 'mixed'>): Criterion => ({
  kind: 'capital_revenue',
  id: 'c',
  label: 'Cost type',
  permitted,
});

describe('with a cost-type criterion', () => {
  it('refuses capital for a revenue-only funder', () => {
    const { restrictions, known } = restrictionsFromCriteria([costType(['revenue'])]);
    expect(restrictions.capitalPermitted).toBe(false);
    expect(restrictions.revenuePermitted).toBe(true);
    expect(known).toContain('they fund running costs only');
  });

  it('refuses running costs for a capital-only funder', () => {
    const { restrictions, known } = restrictionsFromCriteria([costType(['capital'])]);
    expect(restrictions.capitalPermitted).toBe(true);
    expect(restrictions.revenuePermitted).toBe(false);
    expect(known).toContain('they fund capital costs only');
  });

  it('treats "mixed" as permitting each on its own', () => {
    // A funder who will take a budget containing both will take either.
    const { restrictions } = restrictionsFromCriteria([costType(['mixed'])]);
    expect(restrictions.capitalPermitted).toBe(true);
    expect(restrictions.revenuePermitted).toBe(true);
  });
});

describe('what is never known', () => {
  /**
   * These two have no criterion kind behind them, so `validateBudget`'s
   * `category_excluded` and `overheads_exceed_cap` checks cannot fire. That
   * is a fact about the product, not a bug in this function — and it has to
   * stay visible, because a card implying overheads had been checked against
   * a cap would be worse than one that says nothing.
   */
  const everything: Criterion[] = [
    amount(1000, 2000),
    { kind: 'capital_revenue', id: 'c', label: 'Cost type', permitted: ['mixed'] },
    { kind: 'legal_form', id: 'l', label: 'Legal form', cicTreatment: 'explicitly_permitted' },
    { kind: 'jurisdiction', id: 'j', label: 'Area', permitted: ['england'] },
  ];

  it('never fills excluded categories, even with every criterion verified', () => {
    expect(restrictionsFromCriteria(everything).restrictions.excludedCategories).toEqual([]);
  });

  it('never fills an overhead cap', () => {
    expect(restrictionsFromCriteria(everything).restrictions.maxOverheadPercent).toBeNull();
  });

  it('says both are unchecked every time', () => {
    const { unknown } = restrictionsFromCriteria(everything);
    expect(unknown).toContain('which cost categories they refuse to pay for');
    expect(unknown).toContain('any cap on overheads');
  });
});
