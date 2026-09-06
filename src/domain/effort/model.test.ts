import { describe, expect, it } from 'vitest';
import {
  estimateEffort,
  recommend,
  VALUE_THRESHOLDS,
  type ApplicationFeatures,
} from './model.js';

const minimal: ApplicationFeatures = {
  questionCount: 0,
  totalWordBudget: 0,
  requiredAttachments: 0,
  requiresLatestAccounts: false,
  requiredPolicies: [],
  requiresMatchFunding: false,
  requiresBudgetTemplate: false,
};

describe('estimateEffort', () => {
  it('charges only the base cost for an empty form', () => {
    const e = estimateEffort(minimal);
    expect(e.hours).toBe(1);
    expect(e.band).toBe('low');
    expect(e.drivers).toHaveLength(1);
  });

  it('converts the word budget at the stated rate', () => {
    const e = estimateEffort({ ...minimal, totalWordBudget: 2000 });
    // 1 base + 2000/200 = 11
    expect(e.hours).toBe(11);
    expect(e.band).toBe('moderate');
  });

  it('adds per-question overhead', () => {
    const e = estimateEffort({ ...minimal, questionCount: 8 });
    expect(e.hours).toBe(3);
  });

  it('accumulates attachments, accounts and policies', () => {
    const e = estimateEffort({
      ...minimal,
      requiredAttachments: 3,
      requiresLatestAccounts: true,
      requiredPolicies: ['safeguarding', 'equal opportunities'],
    });
    // 1 + 1.5 + 0.5 + 1.0
    expect(e.hours).toBe(4);
  });

  it('charges for match funding and a budget template', () => {
    const e = estimateEffort({
      ...minimal,
      requiresMatchFunding: true,
      requiresBudgetTemplate: true,
    });
    expect(e.hours).toBe(4.5);
  });

  it('bands a large application as high effort', () => {
    const e = estimateEffort({
      ...minimal,
      questionCount: 20,
      totalWordBudget: 4000,
      requiredAttachments: 4,
    });
    expect(e.band).toBe('high');
    expect(e.hours).toBeGreaterThan(15);
  });

  it('lists drivers in descending order of cost', () => {
    const e = estimateEffort({ ...minimal, totalWordBudget: 2400, questionCount: 8 });
    const hours = e.drivers.map((d) => d.hours);
    expect([...hours].sort((a, b) => b - a)).toEqual(hours);
    expect(e.drivers[0]?.label).toContain('2,400 words');
  });

  it('rounds to the nearest half hour', () => {
    const e = estimateEffort({ ...minimal, totalWordBudget: 250 });
    // 1 + 1.25 = 2.25 -> 2.5
    expect(e.hours).toBe(2.5);
  });

  it('is deterministic for identical input', () => {
    const f = { ...minimal, totalWordBudget: 1500, questionCount: 6 };
    expect(estimateEffort(f)).toEqual(estimateEffort(f));
  });

  it('bands exactly at the low boundary as low', () => {
    // 1 base + 1000/200 = 6
    const e = estimateEffort({ ...minimal, totalWordBudget: 1000 });
    expect(e.hours).toBe(6);
    expect(e.band).toBe('low');
  });

  it('bands exactly at the moderate boundary as moderate', () => {
    // 1 base + 2800/200 = 15
    const e = estimateEffort({ ...minimal, totalWordBudget: 2800 });
    expect(e.hours).toBe(15);
    expect(e.band).toBe('moderate');
  });
});

describe('recommend', () => {
  const nineHours = estimateEffort({
    ...minimal,
    questionCount: 8,
    totalWordBudget: 1200,
    requiredAttachments: 3,
  });

  it('never recommends an ineligible opportunity', () => {
    const r = recommend('ineligible', 100_000, nineHours);
    expect(r.recommendation).toBe('not_recommended');
    expect(r.reason).toContain('not eligible');
  });

  it('asks for unknowns to be resolved before the work starts', () => {
    const r = recommend('unknown', 50_000, nineHours);
    expect(r.recommendation).toBe('conditional');
    expect(r.reason).toContain('unresolved');
  });

  it('rates a large grant for modest effort as strong', () => {
    const r = recommend('eligible', 30_000, nineHours);
    expect(r.recommendation).toBe('strong');
    expect(r.valuePerHour).toBeGreaterThan(VALUE_THRESHOLDS.strong);
  });

  it('rates a small grant for heavy effort as not worth it', () => {
    const heavy = estimateEffort({
      ...minimal,
      questionCount: 25,
      totalWordBudget: 5000,
      requiredAttachments: 5,
      requiresMatchFunding: true,
    });
    const r = recommend('eligible', 10_000, heavy);
    expect(r.recommendation).toBe('not_recommended');
    expect(r.reason).toContain('better spent');
  });

  it('reproduces the brief’s trade-off: £25k/10h beats £10k/30h', () => {
    const tenHours = estimateEffort({ ...minimal, totalWordBudget: 1800 });
    expect(tenHours.hours).toBe(10);
    const good = recommend('eligible', 25_000, tenHours);
    expect(good.recommendation).toBe('strong');

    const thirtyHours = estimateEffort({ ...minimal, totalWordBudget: 5800 });
    expect(thirtyHours.hours).toBe(30);
    const poor = recommend('eligible', 10_000, thirtyHours);
    expect(poor.recommendation).toBe('not_recommended');
  });

  it('flags a marginal opportunity as conditional', () => {
    const twentyHours = estimateEffort({ ...minimal, totalWordBudget: 3800 });
    const r = recommend('eligible', 10_000, twentyHours);
    expect(r.recommendation).toBe('conditional');
    expect(r.reason).toContain('strategically');
  });

  it('rates a mid-value opportunity as worth considering', () => {
    const r = recommend('eligible', 10_000, nineHours);
    expect(r.recommendation).toBe('worth_considering');
  });

  it('cannot weigh value without an amount', () => {
    const r = recommend('eligible', null, nineHours);
    expect(r.recommendation).toBe('conditional');
    expect(r.valuePerHour).toBeNull();
    expect(r.reason).toContain('amount you are seeking');
  });

  it('never claims a probability of success', () => {
    const r = recommend('eligible', 30_000, nineHours);
    expect(r.reason.toLowerCase()).not.toContain('chance');
    expect(r.reason.toLowerCase()).not.toContain('likel');
    expect(r.reason.toLowerCase()).not.toContain('probab');
  });
});
