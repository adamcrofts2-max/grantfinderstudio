/**
 * Where tracked items sit on a shared time axis.
 *
 * The tracker's whole argument is that a deadline on its own tells you
 * nothing — what matters is the last day you can still start. That is a
 * position in time, and a sentence is a poor way to compare six of them. This
 * module turns a `Schedule` into coordinates so the interface can draw it.
 *
 * Pure and unit-free: percentages along an axis, never pixels, and never a
 * colour. Presentation decides what the marks look like.
 *
 * One axis is shared by every item in a group. Scaling each track to its own
 * deadline would make a fund due on Friday and one due in three months exactly
 * the same width, which defeats the point of drawing them at all.
 */

import type { Schedule } from './schedule';

export const TIMELINE_CONSTANTS = {
  /** Below this the track is a hairline and the marks land on top of one another. */
  minHorizonDays: 7,
  /**
   * Past roughly four months a shared axis stops discriminating: everything
   * urgent collapses into the first few pixels. Deadlines further out do not
   * get to set the scale — they are drawn at the end of the axis and the
   * overflow is said in words instead.
   */
  maxHorizonDays: 120,
} as const;

export interface Horizon {
  /** Days from today to the right-hand end of the axis. */
  days: number;
  /** At least one deadline falls past the end of the axis. */
  clipped: boolean;
}

export interface Timeline {
  /** Percent along the axis where the deadline falls. */
  deadlineAt: number;
  /**
   * Percent where the work has to begin — the latest start date. Equal to
   * `deadlineAt` when there is no writing left to do.
   */
  worksFrom: number;
  /**
   * Where the work would actually finish if it started today, as a percentage
   * — set only when that lands AFTER the deadline. Null when it fits.
   *
   * Drawing an overrun as a block ending neatly at the deadline, which is what
   * clamping gives you, says the exact opposite of what is true: it reads as a
   * perfect fit. The overshoot has to be visible.
   */
  overrunsTo: number | null;
  /** The work no longer fits before the deadline. It should already be running. */
  overruns: boolean;
  /** The deadline is behind us. */
  overdue: boolean;
  /** How big the form is has not been established, so no work block is drawn. */
  workUnknown: boolean;
  /** The deadline is further out than the axis reaches. */
  beyond: boolean;
}

/**
 * Rolling funds, undated ones and submitted applications have no position in
 * time worth drawing. Giving them a track anyway would invent a cliff edge
 * that the schedule itself refuses to claim.
 */
function plottable(item: Schedule): boolean {
  return item.state !== 'submitted' && item.bucket !== 'no_clock' && item.daysRemaining !== null;
}

/** Sub-pixel precision is noise in the DOM and noise in a test. */
function round(percent: number): number {
  return Math.round(percent * 10) / 10;
}

/**
 * The axis a set of items should share. Null when none of them can be plotted.
 *
 * Overdue items do not stretch the axis — an application three months late
 * would otherwise push every live deadline into the first inch of the track.
 */
export function horizonFor(schedules: readonly Schedule[]): Horizon | null {
  let plottableCount = 0;
  let longest = 0;
  for (const item of schedules) {
    if (!plottable(item)) continue;
    plottableCount += 1;
    const remaining = item.daysRemaining;
    if (remaining === null || remaining < 0) continue;
    if (remaining > TIMELINE_CONSTANTS.maxHorizonDays) continue;
    if (remaining > longest) longest = remaining;
  }
  if (plottableCount === 0) return null;

  const days = Math.max(longest, TIMELINE_CONSTANTS.minHorizonDays);
  const clipped = schedules.some(
    (item) => plottable(item) && item.daysRemaining !== null && item.daysRemaining > days,
  );
  return { days, clipped };
}

/** Coordinates for one item against a shared axis. Null when it has no place on one. */
export function timeline(item: Schedule, horizonDays: number): Timeline | null {
  if (!plottable(item)) return null;
  const remaining = item.daysRemaining;
  if (remaining === null) return null;
  const span = Math.max(horizonDays, 1);

  if (remaining < 0) {
    return {
      deadlineAt: 0,
      worksFrom: 0,
      overrunsTo: null,
      overruns: true,
      overdue: true,
      workUnknown: item.daysNeeded === null,
      beyond: false,
    };
  }

  const beyond = remaining > span;
  const deadlineAt = beyond ? 100 : round((remaining / span) * 100);

  const needed = item.daysNeeded;
  if (needed === null) {
    return {
      deadlineAt,
      worksFrom: deadlineAt,
      overrunsTo: null,
      overruns: false,
      overdue: false,
      workUnknown: true,
      beyond,
    };
  }

  // Work backwards from the deadline: the block ends there and is as long as
  // the work takes.
  const overruns = needed > remaining;
  if (!overruns) {
    return {
      deadlineAt,
      // Clamped to the deadline: a date beyond the axis sits at the far end,
      // and the work cannot be drawn starting to the right of where it ends.
      worksFrom: Math.min(round(((remaining - needed) / span) * 100), deadlineAt),
      overrunsTo: null,
      overruns: false,
      overdue: false,
      workUnknown: false,
      beyond,
    };
  }

  // It does not fit. Now the useful picture is the other way round: start
  // today and this is where you finish — past the date.
  return {
    deadlineAt,
    worksFrom: 0,
    overrunsTo: Math.min(round((needed / span) * 100), 100),
    overruns: true,
    overdue: false,
    workUnknown: false,
    beyond,
  };
}
