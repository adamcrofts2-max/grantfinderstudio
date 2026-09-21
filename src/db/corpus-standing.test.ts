/**
 * What the grant record is doing, and why two clocks are needed to say.
 *
 * The bug this covers was visible on the applicant's search screen: "We are
 * building the grant record now … come back in a few minutes and there will be
 * more", shown for as long as a load had started and not finished — so for
 * ever, if it could never finish.
 */

import { describe, expect, it } from 'vitest';

import {
  corpusStanding,
  isLoading,
  isStalled,
  STALLED_AFTER_HOURS,
  type CorpusProgress,
} from './corpus.js';

const NOW = new Date('2026-09-21T12:00:00.000Z');
const ago = (hours: number): string =>
  new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

const progress = (over: Partial<CorpusProgress> = {}): CorpusProgress => ({
  cursor: 12,
  fundersTotal: 200,
  fundersDone: 12,
  awardsWritten: 4_000,
  fundersUnlicensed: 0,
  fundersTruncated: 0,
  awardsDiscarded: 40,
  fundersFailed: 1,
  failedOrgIds: ['GB-CHC-999'],
  startedAt: ago(48),
  updatedAt: ago(1),
  progressedAt: ago(1),
  finishedAt: null,
  lastError: null,
  lastOrgId: 'GB-CHC-1',
  ...over,
});

describe('what the grant record is doing', () => {
  it('has never started when there is no start', () => {
    expect(corpusStanding(progress({ startedAt: null }), NOW)).toBe('never_started');
  });

  it('is complete once the walk reached the end', () => {
    expect(corpusStanding(progress({ finishedAt: ago(2) }), NOW)).toBe('complete');
  });

  it('is filling while it is making progress', () => {
    expect(corpusStanding(progress({ progressedAt: ago(2) }), NOW)).toBe('filling');
    expect(isLoading(progress({ progressedAt: ago(2) }), NOW)).toBe(true);
  });

  it('is STALLED when progress stops, however recently a step was attempted', () => {
    // The fault in one line. `updated_at` is written by the lease BEFORE the
    // work, and an ordinary page visit claims a step — so on any trafficked
    // deployment the attempt clock is always fresh and says nothing at all
    // about whether the load is moving.
    const stuck = progress({ updatedAt: ago(0.01), progressedAt: ago(72) });
    expect(corpusStanding(stuck, NOW)).toBe('stalled');
    expect(isStalled(stuck, NOW)).toBe(true);
    expect(isLoading(stuck, NOW)).toBe(false);
  });

  it('is filling for the first moments, before the first step lands', () => {
    // A load kicked off seconds ago has not stalled — its first step is in
    // flight — and "the record has stopped filling" would be its own lie.
    expect(
      corpusStanding(
        progress({ startedAt: ago(0.01), updatedAt: null, progressedAt: null }),
        NOW,
      ),
    ).toBe('filling');
  });

  it('is stalled when it started long ago and nothing ever happened', () => {
    expect(
      corpusStanding(progress({ startedAt: ago(96), updatedAt: null, progressedAt: null }), NOW),
    ).toBe('stalled');
  });

  it('gives a daily scheduled step the room it needs', () => {
    // `vercel.json` runs the step once a day, which is what the hosting plan
    // allows, so a healthy untrafficked deployment progresses every 24 hours.
    // A threshold under that would call it stalled every morning.
    expect(STALLED_AFTER_HOURS).toBeGreaterThan(24);
    expect(corpusStanding(progress({ progressedAt: ago(25) }), NOW)).toBe('filling');
    expect(corpusStanding(progress({ progressedAt: ago(STALLED_AFTER_HOURS + 1) }), NOW)).toBe(
      'stalled',
    );
  });

  it('falls back to the attempt clock before 0026 backfilled nothing', () => {
    // A record written before the progress column existed. Null is not
    // evidence of a stall; the attempt clock is all that is known, and using
    // it is the previous behaviour for one cycle rather than a guess.
    expect(corpusStanding(progress({ progressedAt: null, updatedAt: ago(2) }), NOW)).toBe(
      'filling',
    );
    expect(corpusStanding(progress({ progressedAt: null, updatedAt: ago(100) }), NOW)).toBe(
      'stalled',
    );
  });

  it('does not claim progress from a timestamp it cannot read', () => {
    expect(corpusStanding(progress({ progressedAt: 'not a date' }), NOW)).toBe('stalled');
  });

  it('prefers complete over everything, even with a stale clock', () => {
    // A finished walk is finished; its clocks stop moving by definition.
    expect(
      corpusStanding(progress({ finishedAt: ago(500), progressedAt: ago(500) }), NOW),
    ).toBe('complete');
  });
});
