import { describe, expect, it } from 'vitest';

import {
  addDays,
  formatDate,
  byUrgency,
  daysBetween,
  daysOfWorkNeeded,
  latestStartDate,
  needsAttention,
  remainingHours,
  schedule,
  SCHEDULE_CONSTANTS,
  type Schedule,
  type TrackedItem,
} from './schedule.js';

const TODAY = '2026-09-07';

function item(overrides: Partial<TrackedItem> = {}): TrackedItem {
  return {
    deadline: '2026-11-30',
    deadlineKind: 'confirmed',
    hoursRemaining: 4,
    started: false,
    submittedOn: null,
    ...overrides,
  };
}

describe('daysBetween', () => {
  it('counts whole days forward', () => {
    expect(daysBetween('2026-09-07', '2026-09-14')).toBe(7);
  });

  it('is negative once the date has passed', () => {
    expect(daysBetween('2026-09-07', '2026-09-01')).toBe(-6);
  });

  it('crosses a month boundary', () => {
    expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1);
  });

  it('crosses a leap day', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('is unaffected by British Summer Time ending', () => {
    // 25 October 2026 has 25 hours locally. Days must still be days.
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('rejects a value that is not an ISO date', () => {
    expect(() => daysBetween('30/11/2026', TODAY)).toThrow(RangeError);
  });
});

describe('addDays', () => {
  it('moves forward', () => {
    expect(addDays('2026-09-07', 10)).toBe('2026-09-17');
  });

  it('moves backward across a month boundary', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });
});

describe('remainingHours', () => {
  it('is unknown when no questions have been pasted in', () => {
    // Not zero: an empty form is unmeasured, not finished.
    expect(remainingHours([])).toBeNull();
  });

  it('is zero when everything is answered', () => {
    expect(
      remainingHours([
        { wordLimit: 500, answered: true },
        { wordLimit: 300, answered: true },
      ]),
    ).toBe(0);
  });

  it('counts only unanswered questions', () => {
    const all = remainingHours([
      { wordLimit: 400, answered: false },
      { wordLimit: 400, answered: false },
    ]);
    const half = remainingHours([
      { wordLimit: 400, answered: true },
      { wordLimit: 400, answered: false },
    ]);
    expect(half).toBeLessThan(all as number);
  });

  it('includes the cost of reading the guidance only while nothing is answered', () => {
    const fresh = remainingHours([
      { wordLimit: 400, answered: false },
      { wordLimit: 400, answered: false },
    ]) as number;
    const underway = remainingHours([
      { wordLimit: 400, answered: false },
      { wordLimit: 400, answered: false },
      { wordLimit: 0, answered: true },
    ]) as number;
    // The second has strictly more outstanding words yet costs less, because
    // the one-off orientation cost has already been paid.
    expect(underway).toBe(fresh - 1);
  });

  it('assumes a length for a question the funder set no limit on', () => {
    const unlimited = remainingHours([{ wordLimit: null, answered: false }]) as number;
    const equivalent = remainingHours([
      { wordLimit: SCHEDULE_CONSTANTS.assumedWordsPerUnlimitedQuestion, answered: false },
    ]) as number;
    expect(unlimited).toBe(equivalent);
    expect(unlimited).toBeGreaterThan(0);
  });
});

describe('daysOfWorkNeeded', () => {
  it('converts hours to calendar days at the given pace', () => {
    // 8 hours at 4 a week is two weeks.
    expect(daysOfWorkNeeded(8, 4)).toBe(14);
  });

  it('rounds part weeks up, because a part week still occupies it', () => {
    expect(daysOfWorkNeeded(5, 4)).toBe(9);
  });

  it('is zero when there is no work', () => {
    expect(daysOfWorkNeeded(0, 4)).toBe(0);
  });

  it('refuses a pace of zero rather than returning infinity', () => {
    expect(() => daysOfWorkNeeded(4, 0)).toThrow(RangeError);
  });
});

describe('latestStartDate', () => {
  it('works back from the deadline including the buffer', () => {
    // 8 hours at 4/week = 14 days, plus 2 days buffer = 16 days before.
    expect(latestStartDate('2026-11-30', 8, 4)).toBe('2026-11-14');
  });

  it('returns a date in the past when the work no longer fits', () => {
    expect(latestStartDate('2026-09-10', 40, 4)).toBe('2026-06-30');
  });
});

describe('formatDate', () => {
  it('writes a date the way a sentence needs it', () => {
    expect(formatDate('2026-11-21')).toBe('21 November 2026');
    expect(formatDate('2026-01-01')).toBe('1 January 2026');
    expect(formatDate('2026-12-31')).toBe('31 December 2026');
  });

  it('hands back anything it cannot parse rather than inventing a date', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('schedule', () => {
  it('stops the clock once submitted', () => {
    const result = schedule(item({ submittedOn: '2026-09-01' }), TODAY);
    expect(result.state).toBe('submitted');
    expect(result.daysRemaining).toBeNull();
    expect(result.reason).toContain('1 September 2026');
  });

  it('treats a rolling fund as having no cliff edge', () => {
    const result = schedule(item({ deadline: null, deadlineKind: 'rolling' }), TODAY);
    expect(result.state).toBe('no_clock');
    expect(result.bucket).toBe('no_clock');
    expect(result.reason).toContain('Rolling');
  });

  it('ignores a date recorded against a rolling fund', () => {
    // A rolling fund with a date in the row is still rolling. Manufacturing
    // urgency from it would be the tracker inventing a deadline.
    const result = schedule(
      item({ deadline: '2026-09-08', deadlineKind: 'rolling', hoursRemaining: 40 }),
      TODAY,
    );
    expect(result.state).toBe('no_clock');
  });

  it('says so plainly when there is no date at all', () => {
    const result = schedule(item({ deadline: null, deadlineKind: 'unknown' }), TODAY);
    expect(result.state).toBe('no_clock');
    expect(result.reason).toContain('No deadline recorded');
  });

  it('flags an unsubmitted application whose deadline has passed', () => {
    const result = schedule(item({ deadline: '2026-09-01' }), TODAY);
    expect(result.state).toBe('overdue');
    expect(result.daysRemaining).toBe(-6);
    expect(result.bucket).toBe('overdue');
    expect(result.reason).toContain('6 days ago');
  });

  it('reports unknown effort as unknown rather than assuming none', () => {
    const result = schedule(item({ hoursRemaining: null }), TODAY);
    expect(result.state).toBe('effort_unknown');
    expect(result.daysNeeded).toBeNull();
    expect(result.reason).toContain("funder's questions");
  });

  it('is on track when the work comfortably fits', () => {
    const result = schedule(item({ hoursRemaining: 4 }), TODAY);
    expect(result.state).toBe('on_track');
    expect(result.latestStart).toBe('2026-11-21');
    expect(result.reason).toContain('21 November 2026');
  });

  it('tells an unstarted application to begin once the latest start has arrived', () => {
    // 40 hours at 4/week needs 70 days, plus 2 buffer, against 84 remaining.
    const comfortable = schedule(item({ hoursRemaining: 40 }), TODAY);
    expect(comfortable.state).toBe('on_track');

    const tight = schedule(item({ hoursRemaining: 47 }), TODAY);
    expect(tight.state).toBe('start_now');
  });

  it('treats the exact latest start day as start-now, not on-track', () => {
    // 4 hours at 4/week = 7 days, +2 buffer = 9. Deadline 9 days out.
    const result = schedule(
      item({ deadline: '2026-09-16', hoursRemaining: 4, started: false }),
      TODAY,
    );
    expect(result.state).toBe('start_now');
    expect(result.latestStart).toBe(TODAY);
    expect(result.reason).toContain('last day you can start');
  });

  it('distinguishes an application already underway from one not begun', () => {
    const tight = { deadline: '2026-09-14', hoursRemaining: 20 } as const;
    expect(schedule(item({ ...tight, started: false }), TODAY).state).toBe('start_now');
    expect(schedule(item({ ...tight, started: true }), TODAY).state).toBe('behind');
  });

  it('says the writing is done when every question is answered', () => {
    const result = schedule(item({ hoursRemaining: 0, started: true }), TODAY);
    expect(result.state).toBe('on_track');
    expect(result.latestStart).toBeNull();
    expect(result.reason).toContain('submit');
  });

  it('marks an estimated date as not firm so urgency is not overstated', () => {
    const estimated = schedule(item({ deadlineKind: 'estimated' }), TODAY);
    expect(estimated.dateIsFirm).toBe(false);
    expect(schedule(item({ deadlineKind: 'expected' }), TODAY).dateIsFirm).toBe(false);
    expect(schedule(item(), TODAY).dateIsFirm).toBe(true);
  });

  it('still schedules against a soft date rather than ignoring it', () => {
    // An estimate is weak evidence, not no evidence.
    const result = schedule(
      item({ deadline: '2026-09-14', deadlineKind: 'estimated', hoursRemaining: 20 }),
      TODAY,
    );
    expect(result.state).toBe('start_now');
    expect(result.dateIsFirm).toBe(false);
  });

  it('buckets by how soon the date falls', () => {
    expect(schedule(item({ deadline: '2026-09-10' }), TODAY).bucket).toBe('this_week');
    expect(schedule(item({ deadline: '2026-09-30' }), TODAY).bucket).toBe('this_month');
    expect(schedule(item({ deadline: '2026-12-30' }), TODAY).bucket).toBe('later');
  });

  it('respects a different weekly pace', () => {
    const slow = schedule(item({ deadline: '2026-10-05', hoursRemaining: 12 }), TODAY, 2);
    const fast = schedule(item({ deadline: '2026-10-05', hoursRemaining: 12 }), TODAY, 20);
    expect(slow.state).toBe('start_now');
    expect(fast.state).toBe('on_track');
    expect(slow.reason).toContain('2 hours a week');
  });

  it('never leaves an ISO date in a sentence', () => {
    const reasons = [
      schedule(item(), TODAY).reason,
      schedule(item({ hoursRemaining: 60 }), TODAY).reason,
      schedule(item({ hoursRemaining: 60, started: true }), TODAY).reason,
      schedule(item({ submittedOn: '2026-09-01' }), TODAY).reason,
      schedule(item({ deadline: '2026-09-16', hoursRemaining: 4 }), TODAY).reason,
    ];
    for (const reason of reasons) expect(reason).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
  });

  it('starts every reason as a sentence', () => {
    const reasons = [
      schedule(item(), TODAY),
      schedule(item({ hoursRemaining: 60 }), TODAY),
      schedule(item({ hoursRemaining: 60, started: true }), TODAY),
      schedule(item({ hoursRemaining: 0, started: true }), TODAY),
      schedule(item({ hoursRemaining: null }), TODAY),
      schedule(item({ deadline: '2026-09-01' }), TODAY),
      schedule(item({ deadline: null, deadlineKind: 'rolling' }), TODAY),
      schedule(item({ submittedOn: '2026-09-01' }), TODAY),
      schedule(item({ deadline: '2026-09-16', hoursRemaining: 4 }), TODAY),
    ].map((s) => s.reason);
    for (const reason of reasons) expect(reason[0]).toBe(reason[0]?.toUpperCase());
  });

  it('never claims a probability of success', () => {
    const reasons = [
      schedule(item(), TODAY).reason,
      schedule(item({ hoursRemaining: 60, started: true }), TODAY).reason,
      schedule(item({ deadline: '2026-09-01' }), TODAY).reason,
    ];
    for (const reason of reasons) {
      expect(reason).not.toMatch(/chance|likelihood|probability|% ?likely/iu);
    }
  });
});

describe('needsAttention', () => {
  it('covers the states that should pull someone in today', () => {
    expect(needsAttention('overdue')).toBe(true);
    expect(needsAttention('start_now')).toBe(true);
    expect(needsAttention('behind')).toBe(true);
    expect(needsAttention('on_track')).toBe(false);
    expect(needsAttention('no_clock')).toBe(false);
    expect(needsAttention('submitted')).toBe(false);
  });
});

describe('byUrgency', () => {
  it('puts the most pressing state first', () => {
    const states: Schedule['state'][] = [
      'submitted',
      'on_track',
      'overdue',
      'behind',
      'start_now',
      'no_clock',
      'effort_unknown',
    ];
    const sorted = states
      .map((state) => ({ state, daysRemaining: 1 }) as Schedule)
      .toSorted(byUrgency)
      .map((s) => s.state);
    expect(sorted).toEqual([
      'overdue',
      'start_now',
      'behind',
      'effort_unknown',
      'on_track',
      'no_clock',
      'submitted',
    ]);
  });

  it('breaks ties on how little time is left', () => {
    const sorted = [
      { state: 'on_track', daysRemaining: 40 },
      { state: 'on_track', daysRemaining: 3 },
      { state: 'on_track', daysRemaining: 12 },
    ]
      .map((s) => s as Schedule)
      .toSorted(byUrgency)
      .map((s) => s.daysRemaining);
    expect(sorted).toEqual([3, 12, 40]);
  });
});
