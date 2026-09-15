/**
 * Ordering funders, and saying why, with no database in sight.
 *
 * The property that matters most is not the order itself but that the order
 * and the explanation are made of the same parts. A ranking a person cannot
 * check is worse than no ranking, and the only way that stays true is if the
 * two are tested together.
 */

import { describe, expect, it } from 'vitest';

import {
  canCharacterise,
  funderScore,
  rankFunders,
  whyThisFunder,
  yearsSince,
  type FunderRankContext,
  type RankableFunder,
} from './funders.js';

const ASOF = '2026-09-15';

const funder = (over: Partial<RankableFunder> = {}): RankableFunder => ({
  funderId: 'f1',
  matching: 6,
  inYourRegion: 0,
  amounts: { min: 5_000, lowerQuartile: 10_000, median: 20_000, upperQuartile: 35_000, max: 90_000 },
  lastAwardedOn: '2026-03-01',
  ...over,
});

const context = (over: Partial<FunderRankContext> = {}): FunderRankContext => ({
  region: null,
  amountSoughtGbp: null,
  asOf: ASOF,
  ...over,
});

describe('how long ago', () => {
  it('counts years between two dates', () => {
    expect(yearsSince('2025-09-15', ASOF)).toBeCloseTo(1, 1);
    expect(yearsSince('2016-09-15', ASOF)).toBeCloseTo(10, 1);
  });

  it('is null when there is no date, rather than zero', () => {
    // Zero would read as "gave today", which is the opposite of the truth.
    expect(yearsSince(null, ASOF)).toBeNull();
    expect(yearsSince('not a date', ASOF)).toBeNull();
  });
});

describe('scoring a funder', () => {
  it('rewards giving more than once', () => {
    expect(funderScore(funder({ matching: 8 }), context())).toBeGreaterThan(
      funderScore(funder({ matching: 2 }), context()),
    );
  });

  it('caps repetition, so volume alone cannot dominate', () => {
    // Otherwise the largest publisher in the corpus tops every list, whatever
    // the applicant does.
    expect(funderScore(funder({ matching: 5_000 }), context())).toBe(
      funderScore(funder({ matching: 10 }), context()),
    );
  });

  it('puts the applicant’s own area above almost everything', () => {
    const local = funder({ matching: 1, inYourRegion: 1 });
    const prolific = funder({ matching: 10, inYourRegion: 0 });
    const where = context({ region: 'Somerset' });
    expect(funderScore(local, where)).toBeGreaterThan(0);
    // Eligibility beats habit: one grant in your county is worth more than
    // nine somewhere you cannot apply.
    expect(funderScore(local, where) + 1).toBeGreaterThan(funderScore(prolific, where) - 8);
  });

  it('ignores a region match when the applicant has no region', () => {
    const scored = funder({ inYourRegion: 3 });
    expect(funderScore(scored, context())).toBe(funderScore(funder({ inYourRegion: 0 }), context()));
  });

  it('rewards recency and discounts staleness', () => {
    const recent = funderScore(funder({ lastAwardedOn: '2026-06-01' }), context());
    const older = funderScore(funder({ lastAwardedOn: '2024-06-01' }), context());
    const stale = funderScore(funder({ lastAwardedOn: '2015-06-01' }), context());
    expect(recent).toBeGreaterThan(older);
    expect(older).toBeGreaterThan(stale);
  });

  it('rewards an ask that is a typical size for them more than one that is merely possible', () => {
    const typical = funderScore(funder(), context({ amountSoughtGbp: 20_000 }));
    const possible = funderScore(funder(), context({ amountSoughtGbp: 80_000 }));
    const outside = funderScore(funder(), context({ amountSoughtGbp: 900_000 }));
    expect(typical).toBeGreaterThan(possible);
    expect(possible).toBeGreaterThan(outside);
  });
});

describe('ordering', () => {
  it('is stable, so the same data always renders the same way', () => {
    const same = [funder({ funderId: 'a' }), funder({ funderId: 'b' }), funder({ funderId: 'c' })];
    expect(rankFunders(same, context()).map((f) => f.funderId)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the array it was given', () => {
    const list = [funder({ funderId: 'a', matching: 1 }), funder({ funderId: 'b', matching: 9 })];
    rankFunders(list, context());
    expect(list.map((f) => f.funderId)).toEqual(['a', 'b']);
  });

  it('puts a local, recent, right-sized funder first', () => {
    const ranked = rankFunders(
      [
        funder({ funderId: 'stale', matching: 9, lastAwardedOn: '2014-01-01' }),
        funder({ funderId: 'elsewhere', matching: 9 }),
        funder({ funderId: 'local', matching: 3, inYourRegion: 3 }),
      ],
      context({ region: 'Somerset', amountSoughtGbp: 20_000 }),
    );
    expect(ranked[0]?.funderId).toBe('local');
    expect(ranked.at(-1)?.funderId).toBe('stale');
  });
});

describe('saying why', () => {
  it('says the same things the score is made of', () => {
    const why = whyThisFunder(
      funder({ matching: 6, inYourRegion: 2 }),
      context({ region: 'Somerset', amountSoughtGbp: 20_000 }),
    );
    expect(why.join(' · ')).toContain('6 grants like yours');
    expect(why.join(' · ')).toContain('2 in Somerset');
    expect(why.join(' · ')).toContain('typical size');
  });

  it('says "all in" when every matching grant went there', () => {
    const why = whyThisFunder(
      funder({ matching: 4, inYourRegion: 4 }),
      context({ region: 'Somerset' }),
    );
    expect(why).toContain('all in Somerset');
  });

  it('counts one grant in the singular', () => {
    expect(whyThisFunder(funder({ matching: 1 }), context())[0]).toBe('1 grant like yours');
  });

  it('names staleness plainly rather than hiding it', () => {
    // A funder with nothing published for a decade should say so on its own
    // row. Leaving it out would make the list look better than it is.
    const why = whyThisFunder(funder({ lastAwardedOn: '2014-01-01' }), context());
    expect(why.join(' · ')).toMatch(/nothing published for 1\d years/u);
  });

  it('will not describe a typical size from too few grants', () => {
    // A median over three grants is not a policy. The bar is the one
    // funder/behaviour.ts already sets.
    const why = whyThisFunder(funder({ matching: 3 }), context({ amountSoughtGbp: 20_000 }));
    expect(why.join(' · ')).not.toContain('typical');
    expect(canCharacterise(3)).toBe(false);
    expect(canCharacterise(5)).toBe(true);
  });

  it('says when the ask is outside everything they have given', () => {
    const why = whyThisFunder(funder(), context({ amountSoughtGbp: 900_000 }));
    expect(why.join(' · ')).toContain('outside anything they have given');
  });
});
