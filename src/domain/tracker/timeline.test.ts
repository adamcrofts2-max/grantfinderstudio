import { describe, expect, it } from 'vitest';

import type { Schedule } from './schedule.js';
import { horizonFor, timeline, TIMELINE_CONSTANTS } from './timeline.js';

function sched(overrides: Partial<Schedule> = {}): Schedule {
  return {
    state: 'on_track',
    daysRemaining: 40,
    daysNeeded: 10,
    latestStart: '2026-10-08',
    dateIsFirm: true,
    bucket: 'later',
    reason: 'irrelevant here',
    ...overrides,
  };
}

describe('horizonFor', () => {
  it('is null when nothing can be plotted', () => {
    expect(horizonFor([sched({ bucket: 'no_clock', daysRemaining: null })])).toBeNull();
    expect(horizonFor([sched({ state: 'submitted' })])).toBeNull();
    expect(horizonFor([])).toBeNull();
  });

  it('reaches to the furthest live deadline', () => {
    const horizon = horizonFor([sched({ daysRemaining: 12 }), sched({ daysRemaining: 45 })]);
    expect(horizon).toEqual({ days: 45, clipped: false });
  });

  it('never collapses below the minimum, so a tight deadline is still a bar', () => {
    expect(horizonFor([sched({ daysRemaining: 2 })])?.days).toBe(
      TIMELINE_CONSTANTS.minHorizonDays,
    );
  });

  it('does not let a distant deadline set the scale, and says it clipped it', () => {
    const horizon = horizonFor([sched({ daysRemaining: 30 }), sched({ daysRemaining: 700 })]);
    expect(horizon).toEqual({ days: 30, clipped: true });
  });

  it('does not let an overdue item stretch the axis', () => {
    // An application three months late would otherwise push every live
    // deadline into the first inch of the track.
    const horizon = horizonFor([sched({ daysRemaining: -90 }), sched({ daysRemaining: 20 })]);
    expect(horizon).toEqual({ days: 20, clipped: false });
  });
});

describe('timeline', () => {
  it('has no place for rolling funds or submitted work', () => {
    expect(timeline(sched({ bucket: 'no_clock', daysRemaining: null }), 30)).toBeNull();
    expect(timeline(sched({ state: 'submitted' }), 30)).toBeNull();
  });

  it('puts the deadline in proportion and works the block backwards from it', () => {
    const drawn = timeline(sched({ daysRemaining: 30, daysNeeded: 10 }), 60);
    expect(drawn).toEqual({
      deadlineAt: 50,
      worksFrom: 33.3,
      overrunsTo: null,
      overruns: false,
      overdue: false,
      workUnknown: false,
      beyond: false,
    });
  });

  it('plots where the work would actually finish when it no longer fits', () => {
    // Clamping the block to end at the deadline would draw a perfect fit,
    // which is the opposite of what is true. 25 days of work on a 40-day axis
    // runs to 62.5%, well past the deadline at 25%.
    const drawn = timeline(sched({ state: 'behind', daysRemaining: 10, daysNeeded: 25 }), 40);
    expect(drawn?.worksFrom).toBe(0);
    expect(drawn?.deadlineAt).toBe(25);
    expect(drawn?.overrunsTo).toBe(62.5);
    expect(drawn?.overruns).toBe(true);
  });

  it('stops the overrun at the end of the axis rather than running off it', () => {
    const drawn = timeline(sched({ state: 'behind', daysRemaining: 5, daysNeeded: 400 }), 40);
    expect(drawn?.overrunsTo).toBe(100);
  });

  it('draws no block when the size of the form is unknown', () => {
    const drawn = timeline(sched({ state: 'effort_unknown', daysNeeded: null }), 40);
    expect(drawn?.workUnknown).toBe(true);
    expect(drawn?.overrunsTo).toBeNull();
    // No width: an unmeasured form must not look like a small one.
    expect(drawn?.worksFrom).toBe(drawn?.deadlineAt);
  });

  it('leaves the block empty when there is nothing left to write', () => {
    const drawn = timeline(sched({ daysRemaining: 20, daysNeeded: 0 }), 40);
    expect(drawn?.worksFrom).toBe(50);
    expect(drawn?.deadlineAt).toBe(50);
    expect(drawn?.overruns).toBe(false);
  });

  it('parks a deadline beyond the axis at the far end and says so', () => {
    const drawn = timeline(sched({ daysRemaining: 300, daysNeeded: 5 }), 60);
    expect(drawn?.beyond).toBe(true);
    expect(drawn?.deadlineAt).toBe(100);
  });

  it('marks a passed deadline as overdue rather than plotting it off the axis', () => {
    const drawn = timeline(sched({ state: 'overdue', daysRemaining: -4, daysNeeded: 3 }), 40);
    expect(drawn).toEqual({
      deadlineAt: 0,
      worksFrom: 0,
      overrunsTo: null,
      overruns: true,
      overdue: true,
      workUnknown: false,
      beyond: false,
    });
  });

  it('never lets the work block start after the deadline it ends at', () => {
    const drawn = timeline(sched({ daysRemaining: 500, daysNeeded: 1 }), 30);
    expect(drawn?.worksFrom).toBeLessThanOrEqual(drawn?.deadlineAt ?? 0);
  });
});
