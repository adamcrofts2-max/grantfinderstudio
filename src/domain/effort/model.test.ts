import { describe, expect, it } from 'vitest';
import {
  draftingMode,
  estimateEffort,
  MIN_FACTS_FOR_ASSISTED_DRAFTING,
  unassistedReason,
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
    expect(hours.toSorted((a, b) => b - a)).toEqual(hours);
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

describe('drafting mode', () => {
  const capable = { writerAvailable: true, usableFacts: 20 };

  it('is assisted only when the Writer is available and has facts to work from', () => {
    expect(draftingMode(capable)).toBe('assisted');
  });

  it('falls back to unassisted with no Writer, however many facts are confirmed', () => {
    expect(draftingMode({ writerAvailable: false, usableFacts: 500 })).toBe('unassisted');
    expect(unassistedReason({ writerAvailable: false, usableFacts: 500 })).toBe(
      'writer_unavailable',
    );
  });

  it('falls back to unassisted when there is almost nothing to ground prose in', () => {
    // The Writer refuses to invent, so with a near-empty fact base the human
    // writes most of it anyway. Claiming the fast rate here would be a promise
    // the product cannot keep.
    const thin = { writerAvailable: true, usableFacts: MIN_FACTS_FOR_ASSISTED_DRAFTING - 1 };
    expect(draftingMode(thin)).toBe('unassisted');
    expect(unassistedReason(thin)).toBe('too_few_facts');
  });

  it('gives no reason when the fast rate does apply', () => {
    expect(unassistedReason(capable)).toBeNull();
  });

  it('treats exactly the threshold as enough', () => {
    expect(
      draftingMode({ writerAvailable: true, usableFacts: MIN_FACTS_FOR_ASSISTED_DRAFTING }),
    ).toBe('assisted');
  });
});

describe('estimateEffort with drafting help', () => {
  const form = { ...minimal, totalWordBudget: 3500, questionCount: 10 };

  it('defaults to unassisted, never assuming help the user may not have', () => {
    expect(estimateEffort(form).mode).toBe('unassisted');
    expect(estimateEffort(form)).toEqual(estimateEffort(form, 'unassisted'));
  });

  it('prices checking a draft well below writing from scratch', () => {
    const unaided = estimateEffort(form, 'unassisted');
    const assisted = estimateEffort(form, 'assisted');
    expect(assisted.hours).toBeLessThan(unaided.hours);
    expect(assisted.mode).toBe('assisted');
  });

  it('does not pretend the writing becomes free', () => {
    // A draft nobody checked is a liability in a funding application. The
    // saving must be a real multiple, not an order of magnitude.
    const unaided = estimateEffort(form, 'unassisted').hours;
    const assisted = estimateEffort(form, 'assisted').hours;
    expect(assisted).toBeGreaterThan(unaided / 6);
  });

  it('says what the hours are for, so the label matches the rate', () => {
    const unaided = estimateEffort(form, 'unassisted');
    const assisted = estimateEffort(form, 'assisted');
    expect(unaided.drivers.some((d) => d.label.startsWith('Writing'))).toBe(true);
    expect(assisted.drivers.some((d) => d.label.startsWith('Checking and correcting'))).toBe(true);
  });

  it('leaves the paperwork untouched — the Writer cannot file your accounts', () => {
    const paperwork = {
      ...minimal,
      requiredAttachments: 4,
      requiresLatestAccounts: true,
      requiredPolicies: ['safeguarding', 'equal opportunities'],
      requiresMatchFunding: true,
      requiresBudgetTemplate: true,
    };
    const assisted = estimateEffort(paperwork, 'assisted');
    const unaided = estimateEffort(paperwork, 'unassisted');
    // Only the mode label differs — there are no words to draft here.
    expect(assisted.hours).toBe(unaided.hours);
    expect(assisted.drivers).toEqual(unaided.drivers);
  });

  it('lets the paperwork overtake the prose once the writing collapses', () => {
    // The useful consequence, and it is about the total rather than the single
    // biggest line: on a form with real paperwork, drafting help moves the
    // majority of the remaining cost from the words to the attachments,
    // policies, match funding and budget template — none of which the Writer
    // can touch. That is what the applicant should be planning around.
    const heavy = {
      ...form,
      requiredAttachments: 5,
      requiresMatchFunding: true,
      requiresBudgetTemplate: true,
    };
    const split = (mode: 'assisted' | 'unassisted') => {
      const { drivers } = estimateEffort(heavy, mode);
      const prose = drivers.find(
        (d) => d.label.startsWith('Writing') || d.label.startsWith('Checking'),
      );
      const proseHours = prose?.hours ?? 0;
      const rest = drivers.reduce((sum, d) => sum + d.hours, 0) - proseHours;
      return { proseHours, rest };
    };

    const unaided = split('unassisted');
    expect(unaided.proseHours).toBeGreaterThan(unaided.rest);

    const assisted = split('assisted');
    expect(assisted.proseHours).toBeLessThan(assisted.rest);
  });

  it('can turn a fund that was poor value into a reasonable one', () => {
    // This is why the rate matters: priced as unassisted composition the
    // tracker sends people away from funds they could comfortably complete.
    // £7,000 against a 3,500-word form: 21 hours unaided (£333/hr, below the
    // conditional floor) against 8.5 with drafting help (£824/hr).
    const amount = 7_000;
    const unaided = recommend('eligible', amount, estimateEffort(form, 'unassisted'));
    const assisted = recommend('eligible', amount, estimateEffort(form, 'assisted'));
    expect(unaided.valuePerHour).toBeLessThan(assisted.valuePerHour as number);
    expect(unaided.recommendation).toBe('not_recommended');
    expect(assisted.recommendation).not.toBe('not_recommended');
  });
});
