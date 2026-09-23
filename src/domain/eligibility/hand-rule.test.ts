import { describe, expect, it } from 'vitest';

import { HAND_RULE_KINDS, readHandRule, type HandRuleInput } from './hand-rule.js';

/** A form submission: single values, and checkbox groups as arrays. */
function form(fields: Record<string, string | string[]>): HandRuleInput {
  return {
    one: (name) => {
      const value = fields[name];
      return typeof value === 'string' ? value : '';
    },
    all: (name) => {
      const value = fields[name];
      return Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    },
  };
}

describe('readHandRule', () => {
  it('refuses a kind it does not know', () => {
    // The kind comes from the browser.
    expect(readHandRule(form({ kind: 'anything' })).errors['kind']).toBeDefined();
    expect(readHandRule(form({})).rule).toBeNull();
  });

  it('keeps the CIC treatment in its own column, as extraction does', () => {
    const { rule } = readHandRule(form({ kind: 'legal_form', cicTreatment: 'charity_only' }));
    expect(rule?.cicHandling).toBe('charity_only');
    expect(rule?.label).toBe('Registered charities only');
  });

  it('asks what the conditions are when there are conditions', () => {
    const read = readHandRule(form({ kind: 'legal_form', cicTreatment: 'permitted_with_conditions' }));
    expect(read.errors['conditions']).toBeDefined();
    const ok = readHandRule(
      form({ kind: 'legal_form', cicTreatment: 'permitted_with_conditions', conditions: 'Asset lock in articles' }),
    );
    expect(ok.rule?.params).toEqual({ conditions: 'Asset lock in articles', permittedForms: null });
  });

  it('turns years into the months the engine counts in', () => {
    expect(readHandRule(form({ kind: 'organisation_age', minYears: '2' })).rule).toMatchObject({
      params: { minMonths: 24 },
      label: 'Existing for at least 2 years',
    });
    expect(readHandRule(form({ kind: 'organisation_age', minYears: '1.5' })).rule?.label).toBe(
      'Existing for at least 18 months',
    );
    expect(readHandRule(form({ kind: 'organisation_age', minYears: 'two' })).errors['minYears'])
      .toBeDefined();
  });

  it('reads a UK-wide fund as UK-wide, whatever else was ticked', () => {
    const { rule } = readHandRule(form({ kind: 'jurisdiction', nations: ['wales', 'uk_wide'] }));
    expect(rule?.params).toEqual({ permitted: ['uk_wide'] });
  });

  it('never stores a nation it does not know', () => {
    const { rule } = readHandRule(form({ kind: 'jurisdiction', nations: ['wales', 'atlantis'] }));
    expect(rule?.params).toEqual({ permitted: ['wales'] });
    expect(readHandRule(form({ kind: 'jurisdiction', nations: ['atlantis'] })).errors['nations'])
      .toBeDefined();
  });

  it('splits a typed list of areas however it was typed', () => {
    const { rule } = readHandRule(form({ kind: 'region', regions: 'Somerset, Devon\nDorset;somerset' }));
    expect(rule?.params).toEqual({ permittedRegions: ['Somerset', 'Devon', 'Dorset'] });
    expect(rule?.label).toBe('Only in Somerset, Devon and Dorset');
  });

  it('refuses a range with no ends, or with its ends the wrong way round', () => {
    expect(readHandRule(form({ kind: 'amount' })).errors['max']).toBeDefined();
    expect(readHandRule(form({ kind: 'amount', min: '£20,000', max: '5000' })).errors['min'])
      .toBeDefined();
    expect(readHandRule(form({ kind: 'amount', max: '£25,000' })).rule).toMatchObject({
      params: { minGbp: null, maxGbp: 25000 },
      label: 'Grants of up to £25,000',
    });
  });

  it('counts a project length in whole months, within reason', () => {
    expect(readHandRule(form({ kind: 'duration', max: '1.5' })).errors['max']).toBeDefined();
    expect(readHandRule(form({ kind: 'duration', max: '999' })).errors['max']).toBeDefined();
    expect(readHandRule(form({ kind: 'duration', min: '6', max: '24' })).rule?.label).toBe(
      'Projects from 6 months to 2 years',
    );
  });

  it('only accepts capital and revenue as kinds of cost', () => {
    const { rule } = readHandRule(form({ kind: 'capital_revenue', spend: ['capital', 'wishes'] }));
    expect(rule?.params).toEqual({ permitted: ['capital'] });
    expect(rule?.label).toBe('Capital costs only');
  });

  it('keeps the funder’s own words when given, and bounds them', () => {
    const quoted = readHandRule(
      form({ kind: 'match_funding', sourceSpan: '  You must show 20% match funding. ' }),
    );
    expect(quoted.rule?.sourceSpan).toBe('You must show 20% match funding.');
    expect(
      readHandRule(form({ kind: 'match_funding', sourceSpan: 'x'.repeat(5000) })).errors['sourceSpan'],
    ).toBeDefined();
  });

  it('offers every kind the engine evaluates', () => {
    // A kind the engine knows and the form does not is a rule nobody without
    // an API key can ever have.
    expect([...HAND_RULE_KINDS].toSorted()).toEqual(
      [
        'amount',
        'beneficiary',
        'capital_revenue',
        'duration',
        'jurisdiction',
        'legal_form',
        'match_funding',
        'organisation_age',
        'region',
        'turnover',
      ],
    );
  });
});
