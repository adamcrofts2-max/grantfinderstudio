import { describe, expect, it } from 'vitest';

import type { Fact } from './facts.js';
import { citedFactClaim, sentenceLabel } from './sentence-label.js';

function fact(over: Partial<Fact>): Fact {
  return {
    id: 'f1',
    organisationId: 'org',
    claim: 'beneficiary_groups',
    value: 'Young people aged 14 to 19',
    sourceType: 'user',
    sourceRef: null,
    sourceSpan: null,
    retrievedAt: '2026-09-01T00:00:00Z',
    confidence: 'high',
    confirmedBy: 'user_a',
    confirmedAt: '2026-09-01T00:00:00Z',
    supersededBy: null,
    ...over,
  };
}

describe('sentenceLabel', () => {
  it('names the fact a supported sentence rests on, as the landing page shows it', () => {
    expect(sentenceLabel('supported', 'beneficiary_groups')).toEqual({
      tone: 'supported',
      text: 'Beneficiary groups · confirmed',
    });
  });

  it('flags a sentence with nothing confirmed behind it', () => {
    expect(sentenceLabel('unsupported', null).tone).toBe('unsupported');
    expect(sentenceLabel('unsupported', null).text).toMatch(/No confirmed fact/u);
  });

  it('marks a joining sentence as stating nothing, not as a problem', () => {
    const label = sentenceLabel('no_claim', null);
    expect(label.tone).toBe('join');
    expect(label.text).not.toMatch(/No confirmed fact/u);
  });
});

describe('citedFactClaim', () => {
  const facts = [
    fact({}),
    fact({ id: 'f2', claim: 'mission', confirmedBy: null, confirmedAt: null }),
    fact({ id: 'f3', claim: 'annual_turnover', supersededBy: 'f4' }),
  ];

  it('resolves by id or by claim, as claimStanding does', () => {
    expect(citedFactClaim('f1', facts)).toBe('beneficiary_groups');
    expect(citedFactClaim('beneficiary_groups', facts)).toBe('beneficiary_groups');
  });

  it('names nothing unconfirmed or superseded', () => {
    expect(citedFactClaim('f2', facts)).toBeNull();
    expect(citedFactClaim('f3', facts)).toBeNull();
    expect(citedFactClaim(null, facts)).toBeNull();
  });
});
