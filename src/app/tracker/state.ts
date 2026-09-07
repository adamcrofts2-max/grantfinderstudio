/**
 * Presentation vocabulary for the tracker.
 *
 * Separate from the page because a 'use server' module may export only async
 * functions, and separate from the domain because these are labels and
 * groupings, not scheduling rules.
 */

import type { TrackerState } from '@/domain/tracker/schedule';

export const STATE_LABEL = {
  overdue: { label: 'Deadline passed', className: 'badge badge-negative', mark: '✕' },
  start_now: { label: 'Start now', className: 'badge badge-negative', mark: '!' },
  behind: { label: 'Behind', className: 'badge badge-caution', mark: '⚠' },
  effort_unknown: { label: 'Size unknown', className: 'badge badge-caution', mark: '?' },
  on_track: { label: 'On track', className: 'badge badge-positive', mark: '✓' },
  no_clock: { label: 'No deadline', className: 'badge badge-neutral', mark: '·' },
  submitted: { label: 'Submitted', className: 'badge badge-accent', mark: '✓' },
} as const satisfies Record<TrackerState, { label: string; className: string; mark: string }>;

export type Group = 'attention' | 'ahead' | 'open' | 'watching' | 'ruled_out' | 'done';

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

/** A date a British reader can scan: "Mon 30 Nov 2026". */
export function humanDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "in 9 days" / "9 days ago" / "today". */
export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  const n = Math.abs(days);
  const unit = n === 1 ? 'day' : 'days';
  return days > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

/** The date the whole page reasons against, so one render is internally consistent. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
