import { describe, expect, it } from 'vitest';

import { readManualFund, type ManualFundInput } from './manual.js';

const input = (over: Partial<ManualFundInput> = {}): ManualFundInput => ({
  funderName: 'The Wells Trust',
  title: 'Community Buildings Fund',
  summary: '',
  sourceUrl: '',
  jurisdiction: '',
  minAmountGbp: '',
  maxAmountGbp: '',
  deadline: '',
  deadlineKind: 'unknown',
  ...over,
});

describe('a fund entered by hand', () => {
  it('needs a funder and a title, and says which is missing', () => {
    const { fund, errors } = readManualFund(input({ funderName: ' ', title: '' }));
    expect(fund).toBeNull();
    expect(errors['funderName']).toBeDefined();
    expect(errors['title']).toBeDefined();
  });

  it('takes the two required fields alone', () => {
    const { fund, errors } = readManualFund(input());
    expect(errors).toEqual({});
    expect(fund?.funderName).toBe('The Wells Trust');
    expect(fund?.deadlineKind).toBe('unknown');
    expect(fund?.deadline).toBeNull();
  });

  it('reads an amount the way somebody would type it', () => {
    const { fund } = readManualFund(input({ minAmountGbp: '£5,000', maxAmountGbp: ' 25000 ' }));
    expect(fund?.minAmountGbp).toBe(5000);
    expect(fund?.maxAmountGbp).toBe(25000);
  });

  it('refuses a largest grant smaller than the smallest', () => {
    const { errors } = readManualFund(input({ minAmountGbp: '25000', maxAmountGbp: '5000' }));
    expect(errors['maxAmountGbp']).toContain('cannot be smaller');
  });

  it('refuses something that is not a number', () => {
    expect(readManualFund(input({ minAmountGbp: 'about five grand' })).errors['minAmountGbp'])
      .toBeDefined();
  });

  it('refuses a confirmed deadline with no date', () => {
    // The schema has the same constraint. "Confirmed" is the strongest thing
    // this product says about a date and it has to mean somebody saw one.
    const { errors } = readManualFund(input({ deadlineKind: 'confirmed', deadline: '' }));
    expect(errors['deadline']).toContain('needs the date');
  });

  it('allows a date with no confirmation, which is the common case', () => {
    const { fund, errors } = readManualFund(
      input({ deadlineKind: 'expected', deadline: '2026-11-30' }),
    );
    expect(errors).toEqual({});
    expect(fund?.deadline).toBe('2026-11-30');
    expect(fund?.deadlineKind).toBe('expected');
  });

  it('falls back to unknown rather than trusting an unrecognised kind', () => {
    expect(readManualFund(input({ deadlineKind: 'definitely' })).fund?.deadlineKind).toBe(
      'unknown',
    );
  });

  it('refuses a jurisdiction it does not know, instead of dropping it silently', () => {
    // Silently discarding it would leave a fund that looks UK-wide when
    // somebody meant to restrict it, and eligibility turns on exactly that.
    expect(readManualFund(input({ jurisdiction: 'cornwall' })).errors['jurisdiction'])
      .toBeDefined();
  });

  it('accepts a jurisdiction it does know', () => {
    expect(readManualFund(input({ jurisdiction: 'england' })).fund?.jurisdiction).toBe('england');
  });

  it('refuses something that is not a web address', () => {
    expect(readManualFund(input({ sourceUrl: 'wells trust dot org' })).errors['sourceUrl'])
      .toBeDefined();
  });

  it('accepts a real one', () => {
    expect(readManualFund(input({ sourceUrl: 'https://example.org/grants' })).fund?.sourceUrl)
      .toBe('https://example.org/grants');
  });

  it('turns an empty optional into null rather than an empty string', () => {
    const { fund } = readManualFund(input({ summary: '   ' }));
    expect(fund?.summary).toBeNull();
  });
});

describe('a deadline that contradicts itself', () => {
  /**
   * Found by walking the product: a fund saved as rolling WITH a date made the
   * tracker show "Tue, 1 Dec 2026" beside "No deadline" on one row. In a
   * product whose claim is never stating more certainty than it has, a row
   * contradicting itself is worse than a row missing something.
   */
  const base = {
    funderName: 'The Wells Trust',
    title: 'Small Grants Programme',
    sourceUrl: '',
    minAmountGbp: '',
    maxAmountGbp: '',
    deadlineKind: 'rolling',
    deadline: '2026-12-01',
    jurisdiction: '',
    summary: '',
  };

  it('refuses a rolling deadline that carries a date', () => {
    const result = readManualFund(base);
    expect(result.fund).toBeNull();
    expect(result.errors['deadline']).toMatch(/rolling/iu);
    expect(result.errors['deadline']).toMatch(/clear the date/iu);
  });

  it('accepts rolling with no date', () => {
    const result = readManualFund({ ...base, deadline: '' });
    expect(result.errors).toEqual({});
    expect(result.fund?.deadline).toBeNull();
  });

  it('accepts a date with a kind that admits one', () => {
    expect(readManualFund({ ...base, deadlineKind: 'confirmed' }).errors).toEqual({});
    expect(readManualFund({ ...base, deadlineKind: 'estimated' }).errors).toEqual({});
  });

  it('puts the message on the date, beside the box that caused it', () => {
    // Silently discarding the date would leave somebody believing it saved.
    expect(Object.keys(readManualFund(base).errors)).toEqual(['deadline']);
  });
});
