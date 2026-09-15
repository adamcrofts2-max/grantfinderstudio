/**
 * The corpus window.
 *
 * Small surface, but it decides what the product HAS, so the boundary is
 * pinned rather than assumed: a grant exactly on the cutoff is kept, a day
 * older is not, and the count of what was dropped is right.
 */

import { describe, expect, it } from 'vitest';

import {
  RECENT_WINDOW_LABEL,
  RECENT_YEARS,
  earliestKeptDate,
  isRecentAward,
  keepRecent,
} from './recency.js';

const NOW = new Date('2026-09-15T11:00:00Z');

describe('the cutoff date', () => {
  it('is exactly RECENT_YEARS back, to the day', () => {
    expect(earliestKeptDate(NOW)).toBe('2023-09-15');
  });

  it('does not move with the time of day', () => {
    // A publisher's award date is a DAY. Comparing a day against an instant
    // would make a grant on the boundary kept or dropped depending on what
    // time the ingest happened to run, so the same corpus would differ
    // between two runs an hour apart.
    expect(earliestKeptDate(new Date('2026-09-15T00:00:01Z'))).toBe(
      earliestKeptDate(new Date('2026-09-15T23:59:59Z')),
    );
  });

  it('handles a leap day without inventing the 29th of February', () => {
    // 2024-02-29 minus three years is not a date. Date.UTC normalises it
    // forward rather than throwing, and the only thing that matters is that
    // the answer is a real day near the right one.
    expect(earliestKeptDate(new Date('2027-02-28T12:00:00Z'), 3)).toBe('2024-02-28');
    expect(earliestKeptDate(new Date('2024-02-29T12:00:00Z'), 1)).toBe('2023-03-01');
  });
});

describe('whether one award is inside the window', () => {
  it('keeps a grant awarded on the cutoff itself', () => {
    expect(isRecentAward('2023-09-15', NOW)).toBe(true);
  });

  it('drops the day before the cutoff', () => {
    expect(isRecentAward('2023-09-14', NOW)).toBe(false);
  });

  it('keeps today', () => {
    expect(isRecentAward('2026-09-15', NOW)).toBe(true);
  });
});

const award = (awardedOn: string) => ({ awardedOn, id: awardedOn });

describe('splitting a fetched page', () => {
  it('returns the kept rows and the count dropped', () => {
    const { kept, discarded } = keepRecent(
      [award('2026-01-01'), award('2015-06-01'), award('2024-11-30'), award('2019-01-01')],
      NOW,
    );

    expect(kept.map((a) => a.id)).toEqual(['2026-01-01', '2024-11-30']);
    expect(discarded).toBe(2);
  });

  it('keeps the publisher’s order, because ordering is the caller’s business', () => {
    const { kept } = keepRecent([award('2024-01-01'), award('2026-01-01')], NOW);
    expect(kept.map((a) => a.id)).toEqual(['2024-01-01', '2026-01-01']);
  });

  it('does not hold on to what it dropped', () => {
    // A quarter of a million grants go through this in a serverless function
    // with a fixed memory ceiling. Nothing needs the old rows, so only the
    // count comes back — a second array of them is how a step dies of memory
    // instead of time.
    const result = keepRecent([award('2015-01-01')], NOW);
    expect(Object.keys(result).toSorted()).toEqual(['discarded', 'kept']);
    expect(result.kept).toEqual([]);
  });

  it('handles an empty page', () => {
    expect(keepRecent([], NOW)).toEqual({ kept: [], discarded: 0 });
  });
});

describe('the window as the product describes it', () => {
  it('says the same number the ingest uses', () => {
    // The banner, the admin panel and the ingest must not be able to disagree
    // about how far back the corpus goes: a screen that contradicts the data
    // is how people stop believing the figures on it.
    expect(RECENT_WINDOW_LABEL).toContain(String(RECENT_YEARS));
  });
});
