import { describe, expect, it } from 'vitest';
import {
  assessAmountAgainstBehaviour,
  countAwardsInRegion,
  countAwardsWithAnyTag,
  MIN_AWARDS_TO_CHARACTERISE,
  percentile,
  summariseFunderBehaviour,
  type Award,
  type FunderBehaviour,
} from './behaviour.js';

const ASOF = '2026-09-06';

function award(overrides: Partial<Award> = {}): Award {
  return {
    id: 'a1',
    amountGbp: 20_000,
    awardedOn: '2025-06-01',
    recipientName: 'Fictional CIC',
    jurisdiction: 'england',
    region: 'Somerset',
    tags: ['young people'],
    ...overrides,
  };
}

/** Amounts 10k, 20k, 30k, 40k, 50k — chosen so quartiles are easy to reason about. */
const FIVE_AWARDS: Award[] = [10, 20, 30, 40, 50].map((k, i) =>
  award({ id: `a${i}`, amountGbp: k * 1000, awardedOn: `2025-0${i + 1}-01` }),
);

describe('percentile', () => {
  it('returns the only value for a single-element set', () => {
    expect(percentile([42], 0.5)).toBe(42);
  });

  it('returns the median of an odd-sized set', () => {
    expect(percentile([1, 2, 3], 0.5)).toBe(2);
  });

  it('interpolates the median of an even-sized set', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it('interpolates quartiles rather than picking the nearest element', () => {
    expect(percentile([10, 20, 30, 40, 50], 0.25)).toBe(20);
    expect(percentile([0, 10, 20, 30], 0.25)).toBe(7.5);
  });

  it('returns the extremes at 0 and 1', () => {
    expect(percentile([5, 9, 14], 0)).toBe(5);
    expect(percentile([5, 9, 14], 1)).toBe(14);
  });

  it('refuses an empty set rather than returning a misleading zero', () => {
    expect(() => percentile([], 0.5)).toThrow(/empty/);
  });
});

describe('summariseFunderBehaviour', () => {
  it('declines to characterise a funder with no data', () => {
    const r = summariseFunderBehaviour([], ASOF);
    expect(r.kind).toBe('too_few_awards');
    if (r.kind === 'too_few_awards') {
      expect(r.reason).toContain('no awarded-grants data');
    }
  });

  it('declines below the minimum rather than reporting a shaky median', () => {
    const r = summariseFunderBehaviour(FIVE_AWARDS.slice(0, 3), ASOF);
    expect(r.kind).toBe('too_few_awards');
    if (r.kind === 'too_few_awards') {
      expect(r.awardCount).toBe(3);
      expect(r.reason).toContain('too few');
    }
  });

  it('summarises at exactly the minimum', () => {
    expect(FIVE_AWARDS).toHaveLength(MIN_AWARDS_TO_CHARACTERISE);
    const r = summariseFunderBehaviour(FIVE_AWARDS, ASOF);
    expect(r.kind).toBe('summary');
  });

  it('reports the amount distribution', () => {
    const r = summariseFunderBehaviour(FIVE_AWARDS, ASOF);
    if (r.kind !== 'summary') throw new Error('expected a summary');
    expect(r.behaviour.amounts).toEqual({
      min: 10_000,
      lowerQuartile: 20_000,
      median: 30_000,
      upperQuartile: 40_000,
      max: 50_000,
    });
    expect(r.behaviour.awardCount).toBe(5);
  });

  it('measures recency from the most recent award, not the last in the list', () => {
    const awards = [
      award({ id: 'old', awardedOn: '2020-01-01' }),
      award({ id: 'recent', awardedOn: '2026-03-06' }),
      award({ id: 'mid', awardedOn: '2023-01-01' }),
      award({ id: 'x', awardedOn: '2021-01-01' }),
      award({ id: 'y', awardedOn: '2022-01-01' }),
    ];
    const r = summariseFunderBehaviour(awards, ASOF);
    if (r.kind !== 'summary') throw new Error('expected a summary');
    expect(r.behaviour.monthsSinceMostRecentAward).toBe(6);
  });

  it('tallies regions by frequency, then alphabetically', () => {
    const awards = [
      award({ id: '1', region: 'Devon' }),
      award({ id: '2', region: 'Somerset' }),
      award({ id: '3', region: 'Somerset' }),
      award({ id: '4', region: 'Cornwall' }),
      award({ id: '5', region: 'Devon' }),
    ];
    const r = summariseFunderBehaviour(awards, ASOF);
    if (r.kind !== 'summary') throw new Error('expected a summary');
    expect(r.behaviour.regions).toEqual([
      { value: 'Devon', count: 2 },
      { value: 'Somerset', count: 2 },
      { value: 'Cornwall', count: 1 },
    ]);
  });

  it('ignores null and blank values when tallying', () => {
    const awards = [
      award({ id: '1', region: null }),
      award({ id: '2', region: '  ' }),
      award({ id: '3', region: 'Somerset' }),
      award({ id: '4', region: null }),
      award({ id: '5', region: null }),
    ];
    const r = summariseFunderBehaviour(awards, ASOF);
    if (r.kind !== 'summary') throw new Error('expected a summary');
    expect(r.behaviour.regions).toEqual([{ value: 'Somerset', count: 1 }]);
  });

  it('tallies tags across awards', () => {
    const tagged = FIVE_AWARDS.map((a, i) =>
      award({ id: a.id, tags: i < 3 ? ['young people'] : ['environment'] }),
    );
    const r = summariseFunderBehaviour(tagged, ASOF);
    if (r.kind !== 'summary') throw new Error('expected a summary');
    expect(r.behaviour.tags).toEqual([
      { value: 'young people', count: 3 },
      { value: 'environment', count: 2 },
    ]);
  });
});

describe('assessAmountAgainstBehaviour', () => {
  const behaviour: FunderBehaviour = {
    awardCount: 5,
    amounts: { min: 10_000, lowerQuartile: 20_000, median: 30_000, upperQuartile: 40_000, max: 50_000 },
    monthsSinceMostRecentAward: 3,
    jurisdictions: [],
    regions: [],
    tags: [],
  };

  it('recognises an ask within the typical range', () => {
    const r = assessAmountAgainstBehaviour(30_000, behaviour);
    expect(r.fit).toBe('within_typical');
    expect(r.message).toContain('£20,000–£40,000');
  });

  it('flags an ask below typical without discouraging it', () => {
    const r = assessAmountAgainstBehaviour(15_000, behaviour);
    expect(r.fit).toBe('below_typical');
    expect(r.message).toContain('not a problem');
  });

  it('flags an ask above typical as needing justification', () => {
    const r = assessAmountAgainstBehaviour(45_000, behaviour);
    expect(r.fit).toBe('above_typical');
    expect(r.message).toContain('justify');
  });

  it('flags an ask outside the observed range entirely', () => {
    expect(assessAmountAgainstBehaviour(90_000, behaviour).fit).toBe('outside_range_entirely');
    expect(assessAmountAgainstBehaviour(500, behaviour).fit).toBe('outside_range_entirely');
  });

  it('treats the quartile boundaries as typical', () => {
    expect(assessAmountAgainstBehaviour(20_000, behaviour).fit).toBe('within_typical');
    expect(assessAmountAgainstBehaviour(40_000, behaviour).fit).toBe('within_typical');
  });

  it('never claims a likelihood of being funded', () => {
    for (const amount of [5_000, 20_000, 45_000, 90_000]) {
      const message = assessAmountAgainstBehaviour(amount, behaviour).message.toLowerCase();
      expect(message).not.toContain('likel');
      expect(message).not.toContain('chance');
      expect(message).not.toContain('probab');
    }
  });
});

describe('counting comparable awards', () => {
  const awards = [
    award({ id: '1', region: 'Somerset', tags: ['young people'] }),
    award({ id: '2', region: 'SOMERSET', tags: ['environment'] }),
    award({ id: '3', region: 'Devon', tags: ['Young People'] }),
    award({ id: '4', region: null, tags: [] }),
  ];

  it('counts by region, case-insensitively', () => {
    expect(countAwardsInRegion(awards, 'somerset')).toBe(2);
    expect(countAwardsInRegion(awards, 'Devon')).toBe(1);
    expect(countAwardsInRegion(awards, 'Cumbria')).toBe(0);
  });

  it('counts by tag, case-insensitively', () => {
    expect(countAwardsWithAnyTag(awards, ['young people'])).toBe(2);
    expect(countAwardsWithAnyTag(awards, ['environment', 'young people'])).toBe(3);
    expect(countAwardsWithAnyTag(awards, ['arts'])).toBe(0);
  });
});
