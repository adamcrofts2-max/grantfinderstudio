/**
 * Sharing one application, read-only, with a person the applicant names.
 *
 * ## Why this is not a toggle
 *
 * The roadmap's own words: "a named outsider reading tenant data is a
 * deliberate GDPR processor relationship, not a toggle". Four properties make
 * it that rather than a public link, and all four are enforced here or in the
 * table rather than left to a screen to remember:
 *
 *   - **Scoped.** One application. Not the organisation's other applications,
 *     not its facts, not its documents.
 *   - **Time-boxed.** An expiry is required, not optional. A link that works
 *     forever is a copy of the data handed out, and nobody revokes a link they
 *     have forgotten about.
 *   - **Revocable.** In one click, taking effect on the next request.
 *   - **Audited.** Creating it, withdrawing it and reading it all write to
 *     `audit_logs`, which is why that table got a writer first. A VISIT is
 *     what gets a line, not a page load — see `isNewVisit`.
 *
 * ## Why the standing is computed rather than stored
 *
 * `expired` is a fact about the clock, and a column saying so would be wrong
 * between the expiry passing and something noticing. There is no job here to
 * do the noticing, and adding one to keep a derived column honest is more
 * machinery than the derivation it replaces.
 */

/**
 * How long a share lasts unless the applicant says otherwise.
 *
 * Two weeks: long enough for somebody to find an evening for it, short enough
 * that a link forgotten about stops working before the application is stale.
 * The applicant can choose from `SHARE_LENGTHS`; there is no "never expires".
 */
export const SHARE_DAYS = 14;

/** What the applicant may choose, in days. Deliberately no unlimited option. */
export const SHARE_LENGTHS = [7, 14, 30] as const;
export type ShareLength = (typeof SHARE_LENGTHS)[number];

export function isShareLength(value: unknown): value is ShareLength {
  return typeof value === 'number' && (SHARE_LENGTHS as readonly number[]).includes(value);
}

export type ShareStanding = 'live' | 'expired' | 'revoked';

export interface ShareState {
  /** ISO. When it stops working. */
  expiresAt: string;
  /** ISO, or null while it is still live. */
  revokedAt: string | null;
}

/**
 * Whether a link still works.
 *
 * Revoked beats expired: somebody who withdrew access should be told that is
 * what happened, not that the clock ran out. Both are refusals, and which one
 * it was is the applicant's own record of what they did.
 *
 * An unreadable date counts as REVOKED rather than live. A share whose expiry
 * cannot be parsed is a share nobody can reason about, and the safe reading of
 * "I cannot tell whether this is still allowed" is no.
 */
export function shareStanding(share: ShareState, now: Date): ShareStanding {
  if (share.revokedAt !== null) return 'revoked';
  const expires = Date.parse(share.expiresAt);
  if (Number.isNaN(expires)) return 'revoked';
  return expires > now.getTime() ? 'live' : 'expired';
}

/** When a share created now should stop working. */
export function shareExpiry(now: Date, days: number = SHARE_DAYS): Date {
  const safe = isShareLength(days) ? days : SHARE_DAYS;
  return new Date(now.getTime() + safe * 24 * 60 * 60 * 1000);
}

/**
 * Whole days left, rounded up, or 0 once it has gone.
 *
 * Up rather than down: a link with nine hours left has one day left, not
 * none, and "expires today" is what somebody needs to hear.
 */
export function daysLeft(share: ShareState, now: Date): number {
  if (shareStanding(share, now) !== 'live') return 0;
  const ms = Date.parse(share.expiresAt) - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/**
 * How long a gap makes the next read a new visit rather than the same one.
 *
 * Every read is counted on the share row — `views`, `first_viewed_at`,
 * `last_viewed_at` — and none of that is collapsed. What is collapsed is the
 * AUDIT LINE, because the trail is forty lines long and a reviewer who reloads
 * the page eleven times while reading would push the application's own history
 * off the bottom of it. Thirty-one lines saying the same person read the same
 * thing is not a better record than one; it is the same record with the rest
 * of the evidence pushed out of view.
 *
 * Half an hour, because that is roughly the difference between coming back to
 * a tab and coming back to the application. Nothing about lawfulness rests on
 * the number: the exact count and both ends of the reading are on the share
 * row either way, and the trail's job is to be readable.
 */
export const VISIT_GAP_MINUTES = 30;

/**
 * Whether this read is a new visit — never read before, or a real gap since.
 *
 * An unreadable previous timestamp counts as a new visit: a line too many in
 * an audit trail is a smaller fault than a missing one, so the unknown case
 * records rather than swallows.
 */
export function isNewVisit(previousViewAt: string | null, now: Date): boolean {
  if (previousViewAt === null) return true;
  const previous = Date.parse(previousViewAt);
  if (Number.isNaN(previous)) return true;
  return now.getTime() - previous >= VISIT_GAP_MINUTES * 60 * 1000;
}

/**
 * What a reviewer is told when a link no longer works.
 *
 * Says which of the two it was, and says what to do — a dead end with no
 * instruction is how somebody emails the wrong person. It never names the
 * organisation or the application: whoever is holding a dead link may not be
 * the person it was sent to.
 */
export function refusalMessage(standing: Exclude<ShareStanding, 'live'>): string {
  return standing === 'revoked'
    ? 'This review link has been withdrawn by whoever sent it. Ask them for a new one.'
    : 'This review link has expired. Ask whoever sent it for a new one.';
}
