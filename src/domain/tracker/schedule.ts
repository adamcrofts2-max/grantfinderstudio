/**
 * Deadline scheduling for tracked funding work.
 *
 * The observation this module is built on: a deadline on its own is close to
 * useless to a small organisation. Everyone already knows when the money is
 * due. What nobody knows is the last day they can still realistically begin —
 * and that is where applications are actually lost, quietly, weeks before the
 * date anyone was watching.
 *
 * So the number this module exists to produce is the LATEST START DATE:
 * the deadline, minus the time the remaining work takes at the pace the
 * organisation actually has. Everything else here supports that.
 *
 * Three rules hold throughout:
 *   - No score. We state hours needed and days left and let the arithmetic
 *     speak, for the same reason the assessment module refuses a composite.
 *   - An unconfirmed date never generates confident urgency. `dateIsFirm`
 *     travels with every judgement so the interface can say so.
 *   - Unknown work is reported as unknown, never as zero. An application with
 *     no questions pasted in yet is not "nothing to do".
 */

import { EFFORT_CONSTANTS } from '../effort/model.js';
import type { DeadlineType } from '../types.js';

export const SCHEDULE_CONSTANTS = {
  /**
   * Hours a week the organisation can give to funding work.
   *
   * Four is the honest default for a CIC where applications are written
   * around delivery, in evenings and gaps. It is an assumption, shown to the
   * user as one, and passed in rather than read here so it can become a
   * per-organisation setting without touching this logic.
   */
  defaultHoursPerWeek: 4,
  /**
   * Words assumed for a question the funder has set no limit on. Unlimited
   * questions are not shorter than limited ones; treating them as zero would
   * make long forms look free.
   */
  assumedWordsPerUnlimitedQuestion: 250,
  /**
   * Days of margin before the deadline. Nobody should be planning to submit
   * at 23:59 on the closing day, and portals fail on closing days.
   */
  bufferDays: 2,
  /** Boundaries for grouping by how soon a date falls. */
  thisWeekDays: 7,
  thisMonthDays: 30,
} as const;

/** A whole number of days from `from` to `to`, both ISO `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new RangeError(`Not an ISO date: ${Number.isNaN(start) ? from : to}`);
  }
  return Math.round((end - start) / 86_400_000);
}

/** Shift an ISO date by a whole number of days, returning an ISO date. */
export function addDays(date: string, offset: number): string {
  const base = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(base)) throw new RangeError(`Not an ISO date: ${date}`);
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

/** One question of a funder's form, and whether it has been answered. */
export interface QuestionProgress {
  wordLimit: number | null;
  answered: boolean;
}

/**
 * Hours of work still to do on an application.
 *
 * Null when the funder's questions have not been pasted in yet: at that point
 * the size of the form is genuinely unknown, and inventing a number would put
 * a confident schedule on top of no information.
 *
 * The one-off cost of reading the guidance is counted only while nothing has
 * been answered — once drafting has started, it has been paid.
 */
export function remainingHours(questions: readonly QuestionProgress[]): number | null {
  if (questions.length === 0) return null;

  const outstanding = questions.filter((q) => !q.answered);
  if (outstanding.length === 0) return 0;

  const words = outstanding.reduce(
    (total, q) => total + (q.wordLimit ?? SCHEDULE_CONSTANTS.assumedWordsPerUnlimitedQuestion),
    0,
  );

  const nothingStarted = questions.every((q) => !q.answered);
  const hours =
    (nothingStarted ? EFFORT_CONSTANTS.baseHours : 0) +
    words / EFFORT_CONSTANTS.wordsPerHour +
    outstanding.length * EFFORT_CONSTANTS.hoursPerQuestion;

  return Math.round(hours * 2) / 2;
}

/** Calendar days the remaining work needs at the given weekly pace. */
export function daysOfWorkNeeded(hours: number, hoursPerWeek: number): number {
  if (hoursPerWeek <= 0) throw new RangeError('hoursPerWeek must be positive');
  if (hours <= 0) return 0;
  return Math.ceil((hours / hoursPerWeek) * 7);
}

/**
 * The last day work can begin and still finish before the deadline, with the
 * buffer intact. May be in the past — that is the useful answer, not an error.
 */
export function latestStartDate(
  deadline: string,
  hours: number,
  hoursPerWeek: number,
): string {
  return addDays(deadline, -(daysOfWorkNeeded(hours, hoursPerWeek) + SCHEDULE_CONSTANTS.bufferDays));
}

export type TrackerState =
  | 'submitted'
  | 'overdue'
  | 'start_now'
  | 'behind'
  | 'effort_unknown'
  | 'on_track'
  | 'no_clock';

/** Grouping by how soon the date falls, for a timeline view. */
export type TimeBucket = 'overdue' | 'this_week' | 'this_month' | 'later' | 'no_clock';

export interface TrackedItem {
  deadline: string | null;
  deadlineKind: DeadlineType;
  /** Null when the size of the form is not yet known. */
  hoursRemaining: number | null;
  /** Whether any drafting has happened. */
  started: boolean;
  submittedOn: string | null;
}

export interface Schedule {
  state: TrackerState;
  /** Negative once the deadline has passed. Null when there is no date. */
  daysRemaining: number | null;
  /** Calendar days the remaining work needs. Null when the work is unknown. */
  daysNeeded: number | null;
  /** Null when there is no date, no known effort, or the work is finished. */
  latestStart: string | null;
  /**
   * False whenever the date is an estimate, an expectation, or unstated.
   * The interface must not present urgency from a soft date as a hard cliff.
   */
  dateIsFirm: boolean;
  bucket: TimeBucket;
  /** Plain English, built from the numbers above. Never a score. */
  reason: string;
}

/** Rolling and unknown funds have no cliff edge, whatever date is recorded. */
function hasClock(item: TrackedItem): boolean {
  if (item.deadline === null) return false;
  return item.deadlineKind !== 'rolling' && item.deadlineKind !== 'unknown';
}

function bucketFor(daysRemaining: number): TimeBucket {
  if (daysRemaining < 0) return 'overdue';
  if (daysRemaining <= SCHEDULE_CONSTANTS.thisWeekDays) return 'this_week';
  if (daysRemaining <= SCHEDULE_CONSTANTS.thisMonthDays) return 'this_month';
  return 'later';
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * "16 November 2026". Deterministic and locale-free: this string ends up
 * inside sentences the user reads, and an ISO date there reads like a leak.
 */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const name = MONTHS[Number(month) - 1];
  if (year === undefined || day === undefined || name === undefined) return isoDate;
  return `${Number(day)} ${name} ${year}`;
}

/** Capitalise a phrase that has become the start of a sentence. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function days(count: number): string {
  const n = Math.abs(count);
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

function hoursPhrase(hours: number): string {
  if (hours === 0) return 'no writing left';
  const rounded = Math.round(hours * 2) / 2;
  return `about ${rounded} ${rounded === 1 ? 'hour' : 'hours'} of work left`;
}

/**
 * Work out where a tracked application stands.
 *
 * `today` is passed in rather than read from the clock so the result is
 * deterministic and testable, and so a whole page renders against one date.
 */
export function schedule(
  item: TrackedItem,
  today: string,
  hoursPerWeek: number = SCHEDULE_CONSTANTS.defaultHoursPerWeek,
): Schedule {
  const dateIsFirm = item.deadlineKind === 'confirmed';

  if (item.submittedOn !== null) {
    return {
      state: 'submitted',
      daysRemaining: null,
      daysNeeded: null,
      latestStart: null,
      dateIsFirm,
      bucket: 'no_clock',
      reason: `Submitted on ${formatDate(item.submittedOn)}. Nothing further to do until the funder replies.`,
    };
  }

  if (!hasClock(item)) {
    return {
      state: 'no_clock',
      daysRemaining: null,
      daysNeeded: null,
      latestStart: null,
      dateIsFirm,
      bucket: 'no_clock',
      reason:
        item.deadlineKind === 'rolling'
          ? 'Rolling deadline — no cliff edge, so this can wait for a week when you have the time.'
          : 'No deadline recorded, so there is no date to work back from.',
    };
  }

  // hasClock() guarantees a date; narrowing for the type system.
  const deadline = item.deadline as string;
  const daysRemaining = daysBetween(today, deadline);

  if (daysRemaining < 0) {
    return {
      state: 'overdue',
      daysRemaining,
      daysNeeded: null,
      latestStart: null,
      dateIsFirm,
      bucket: 'overdue',
      reason: `The deadline passed ${days(daysRemaining)} ago and this was never marked submitted.`,
    };
  }

  if (item.hoursRemaining === null) {
    return {
      state: 'effort_unknown',
      daysRemaining,
      daysNeeded: null,
      latestStart: null,
      dateIsFirm,
      bucket: bucketFor(daysRemaining),
      reason: `${days(daysRemaining)} until the deadline. Paste the funder's questions in to see whether that is enough time.`,
    };
  }

  const daysNeeded = daysOfWorkNeeded(item.hoursRemaining, hoursPerWeek);
  const start = latestStartDate(deadline, item.hoursRemaining, hoursPerWeek);
  const slack = daysRemaining - (daysNeeded + SCHEDULE_CONSTANTS.bufferDays);
  const pace = `${hoursPerWeek} hours a week`;

  if (item.hoursRemaining === 0) {
    return {
      state: 'on_track',
      daysRemaining,
      daysNeeded: 0,
      latestStart: null,
      dateIsFirm,
      bucket: bucketFor(daysRemaining),
      reason: `Every question is answered and there are ${days(daysRemaining)} left. Check it over and submit.`,
    };
  }

  if (slack < 0) {
    return item.started
      ? {
          state: 'behind',
          daysRemaining,
          daysNeeded,
          latestStart: start,
          dateIsFirm,
          bucket: bucketFor(daysRemaining),
          reason: `${sentence(hoursPhrase(item.hoursRemaining))} but only ${days(daysRemaining)} to go. At ${pace} that work needs about ${days(daysNeeded)}, so either find more time or drop something.`,
        }
      : {
          state: 'start_now',
          daysRemaining,
          daysNeeded,
          latestStart: start,
          dateIsFirm,
          bucket: bucketFor(daysRemaining),
          reason: `${sentence(hoursPhrase(item.hoursRemaining))} and ${days(daysRemaining)} to go. At ${pace} you needed to start by ${formatDate(start)} — begin today or let this one go.`,
        };
  }

  if (slack === 0 && !item.started) {
    return {
      state: 'start_now',
      daysRemaining,
      daysNeeded,
      latestStart: start,
      dateIsFirm,
      bucket: bucketFor(daysRemaining),
      reason: `${sentence(hoursPhrase(item.hoursRemaining))}. At ${pace}, today is the last day you can start and still finish comfortably.`,
    };
  }

  return {
    state: 'on_track',
    daysRemaining,
    daysNeeded,
    latestStart: start,
    dateIsFirm,
    bucket: bucketFor(daysRemaining),
    reason: `${sentence(hoursPhrase(item.hoursRemaining))} and ${days(daysRemaining)} to go. At ${pace} you could leave this until ${formatDate(start)}.`,
  };
}

/** States that should pull a person's attention today, most pressing first. */
export const ATTENTION_STATES: readonly TrackerState[] = ['overdue', 'start_now', 'behind'];

export function needsAttention(state: TrackerState): boolean {
  return ATTENTION_STATES.includes(state);
}

const STATE_ORDER: Record<TrackerState, number> = {
  overdue: 0,
  start_now: 1,
  behind: 2,
  effort_unknown: 3,
  on_track: 4,
  no_clock: 5,
  submitted: 6,
};

/**
 * Sort most-pressing first: by state, then by how little time is left.
 * Items with no clock keep their incoming order.
 */
export function byUrgency(a: Schedule, b: Schedule): number {
  const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (byState !== 0) return byState;
  if (a.daysRemaining === null || b.daysRemaining === null) return 0;
  return a.daysRemaining - b.daysRemaining;
}
