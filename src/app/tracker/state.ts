/**
 * Presentation vocabulary for the tracker.
 *
 * Separate from the page because a 'use server' module may export only async
 * functions, and separate from the domain because these are labels and
 * groupings, not scheduling rules.
 */

import {
  EFFORT_CONSTANTS,
  MIN_FACTS_FOR_ASSISTED_DRAFTING,
  type DraftingMode,
  type UnassistedReason,
} from '@/domain/effort/model';
import type { TrackerState } from '@/domain/tracker/schedule';
import type { TimelineTone } from '@/app/viz/Timeline';

export const STATE_LABEL = {
  overdue: { label: 'Deadline passed', className: 'badge badge-negative', mark: '✕' },
  start_now: { label: 'Start now', className: 'badge badge-negative', mark: '!' },
  behind: { label: 'Behind', className: 'badge badge-caution', mark: '⚠' },
  // "Size unknown" read as the size of the GRANT — which the applicant has
  // usually just typed in — where it means the size of the WORK: nobody has
  // pasted the funder's questions yet, so there is nothing to schedule back
  // from the deadline. The row's own sentence says so; the badge is what gets
  // scanned.
  effort_unknown: { label: 'Effort unknown', className: 'badge badge-caution', mark: '?' },
  on_track: { label: 'On track', className: 'badge badge-positive', mark: '✓' },
  no_clock: { label: 'No deadline', className: 'badge badge-neutral', mark: '·' },
  submitted: { label: 'Submitted', className: 'badge badge-accent', mark: '✓' },
} as const satisfies Record<TrackerState, { label: string; className: string; mark: string }>;

/**
 * Which status colour a timeline track wears.
 *
 * Deliberately the same four colours as the badge beside it: a row that says
 * "Behind" in amber and draws its track in green would be the product
 * disagreeing with itself, and the reader would trust neither.
 */
export const STATE_TONE = {
  overdue: 'negative',
  start_now: 'negative',
  behind: 'caution',
  effort_unknown: 'caution',
  on_track: 'positive',
  no_clock: 'neutral',
  submitted: 'neutral',
} as const satisfies Record<TrackerState, TimelineTone>;

export type Group =
  | 'attention'
  | 'ahead'
  | 'open'
  | 'watching'
  | 'ruled_out'
  | 'done'
  | 'answered';

export const GROUPS: ReadonlyArray<{ id: Group; title: string; blurb: string }> = [
  {
    id: 'attention',
    title: 'Needs you this week',
    blurb:
      'Either the deadline has passed, or the work left no longer fits the time left at your usual pace.',
  },
  {
    id: 'ahead',
    title: 'In hand',
    blurb:
      'Applications you have opened, with room still in the calendar. Each shows the last day you could leave it.',
  },
  {
    id: 'open',
    title: 'No fixed deadline',
    blurb:
      'Rolling funds and undated ones. No cliff edge, which is exactly why they slide — pick these up in a quiet week.',
  },
  {
    id: 'watching',
    title: 'Not started',
    blurb: 'Opportunities you have not opened an application for. The clock runs on these too.',
  },
  {
    id: 'ruled_out',
    title: 'Ruled out',
    blurb:
      'The eligibility check says you do not qualify, so these are kept out of the way rather than chased. Open one to see which rule fails — if the funder tells you otherwise, that answer wins.',
  },
  { id: 'done', title: 'Submitted', blurb: 'Waiting on the funder.' },
  {
    id: 'answered',
    title: 'Answered',
    blurb:
      'The funder came back. Kept rather than archived: your own results are the only evidence you own outright, and they are what the next application argues from.',
  },
];

/**
 * Shown instead of the schedule badge when the engine has ruled the applicant
 * out. Urgency computed from a deadline is irrelevant once you cannot apply,
 * and showing both would have the card argue with its own heading.
 */
export const RULED_OUT_BADGE = {
  label: 'Not eligible',
  className: 'badge badge-negative',
  mark: '✕',
} as const;

/**
 * What `recordDecisionAction` hands back.
 *
 * `applicationId` is on it so a message from one row does not appear under
 * every other row's form: the tracker renders many of these at once, and a
 * shared error banner would blame the wrong application.
 */
export interface DecisionFormState {
  ok: boolean;
  message: string;
  applicationId: string | null;
  /** Which box to point at, where the complaint is about one. */
  field?: string;
}

export const EMPTY_DECISION: DecisionFormState = {
  ok: false,
  message: '',
  applicationId: null,
};

/** "in 9 days" / "9 days ago" / "today". */
export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  const n = Math.abs(days);
  const unit = n === 1 ? 'day' : 'days';
  return days > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

/**
 * Explain which writing rate was used and, when it is the slow one, the single
 * thing the user could do about it.
 *
 * This matters more than it looks. The product's claim is that drafting from
 * confirmed facts is much faster than writing from a blank box; if the tracker
 * quietly prices every hour as unassisted, it argues against its own product,
 * and the user never learns that confirming a handful of facts is the
 * highest-leverage half hour they could spend.
 */
export function paceNote(
  mode: DraftingMode,
  reason: UnassistedReason,
  usableFacts: number,
): string {
  if (mode === 'assisted') {
    return `Assumes you draft each answer with the Writer and then check its work — about ${EFFORT_CONSTANTS.assistedWordsPerHour} words an hour rather than the ${EFFORT_CONSTANTS.wordsPerHour} it takes to write one from scratch. Checking is still your job, so it is not free.`;
  }
  if (reason === 'writer_unavailable') {
    return `Assumes you write every answer yourself, at about ${EFFORT_CONSTANTS.wordsPerHour} words an hour. Add an Anthropic key in Settings and the Writer drafts from your confirmed facts, which cuts the writing time roughly to a third.`;
  }
  return `Assumes you write every answer yourself, at about ${EFFORT_CONSTANTS.wordsPerHour} words an hour. The Writer drafts only from confirmed facts and you have ${usableFacts} — confirm at least ${MIN_FACTS_FOR_ASSISTED_DRAFTING} in Your organisation and these estimates drop sharply.`;
}

/** The date the whole page reasons against, so one render is internally consistent. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
