import { describe, expect, it } from 'vitest';

import { CLAIM_VOCABULARY } from '../../ai/agents/extractor.js';
import {
  normaliseClaim,
  readableClaim,
  readSelfDeclaredFact,
  SUGGESTED_CLAIMS,
} from './self-declared.js';

describe('the claims we suggest', () => {
  it('all come from the extraction vocabulary', () => {
    // Otherwise a typed fact and a read one would land on different keys and
    // the organisation would hold two facts about the same thing.
    for (const claim of SUGGESTED_CLAIMS) {
      expect(CLAIM_VOCABULARY).toContain(claim);
    }
  });

  it('reads back as something a person would say', () => {
    expect(readableClaim('annual_turnover')).toBe('Annual turnover');
  });
});

describe('normalising a typed claim', () => {
  it('folds what somebody types onto the key the list uses', () => {
    expect(normaliseClaim('Annual Turnover')).toBe('annual_turnover');
    expect(normaliseClaim('  annual  turnover  ')).toBe('annual_turnover');
  });

  it('strips punctuation rather than keeping it in the key', () => {
    expect(normaliseClaim('Staff count (FTE)')).toBe('staff_count_fte');
  });

  it('gives back nothing for nothing', () => {
    expect(normaliseClaim('   ')).toBe('');
    expect(normaliseClaim('!!!')).toBe('');
  });
});

describe('a fact somebody types', () => {
  it('needs both halves', () => {
    const { fact, errors } = readSelfDeclaredFact({ claim: '', value: '' });
    expect(fact).toBeNull();
    expect(errors['claim']).toBeDefined();
    expect(errors['value']).toBeDefined();
  });

  it('accepts an ordinary one', () => {
    const { fact, errors } = readSelfDeclaredFact({
      claim: 'annual_turnover',
      value: '£118,400 for the year ending 31 March 2026',
    });
    expect(errors).toEqual({});
    expect(fact).toEqual({
      claim: 'annual_turnover',
      value: '£118,400 for the year ending 31 March 2026',
    });
  });

  it('refuses an essay in the box', () => {
    const { errors } = readSelfDeclaredFact({
      claim: 'mission',
      value: 'x'.repeat(2001),
    });
    expect(errors['value']).toContain('not the application');
  });
});
