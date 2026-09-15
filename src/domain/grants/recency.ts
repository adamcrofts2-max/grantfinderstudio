/**
 * How far back the held corpus goes.
 *
 * ## Why there is a window at all
 *
 * 360Giving publish roughly a quarter of a million grants. Holding all of them
 * measured at about 420 MB once the text index was cut to one (see migration
 * 0015), and every free managed-Postgres tier is smaller than that. So either
 * the corpus is paid for, or it is bounded. Three years is the bound.
 *
 * Three rather than one or five, for a reason the product already relies on:
 * `MIN_AWARDS_TO_CHARACTERISE` is five awards, and the amount summary a
 * prospect page shows — median, quartiles, range — is only worth showing over
 * a spread. One year leaves the smaller trusts with two or three grants and
 * nothing that can be said about them. Three years leaves almost every active
 * funder characterisable while dropping about three quarters of the rows.
 *
 * ## What it does NOT save
 *
 * Fetch time. Their API declares no filter fields on either grant route, so
 * there is no `?since=`: every grant a funder ever published is downloaded
 * whatever window we keep. The window saves STORAGE, and it is worth being
 * exact about that rather than letting it look like a speed-up.
 *
 * ## Why this is a domain module
 *
 * Because the cut is a policy about what the product is, not a detail of one
 * ingest — the banner has to be able to say "the last three years" in the same
 * words the ingest used, and a screen that disagrees with the data is how
 * people stop trusting figures.
 */

/** Years of grant history the corpus holds. */
export const RECENT_YEARS = 3;

/** The window, in words, for anything that has to tell somebody about it. */
export const RECENT_WINDOW_LABEL = 'the last 3 years';

/**
 * The earliest award date the corpus keeps, given "now".
 *
 * A date rather than a timestamp: 360Giving award dates are days, and
 * comparing a day against an instant makes the boundary depend on the time of
 * day the ingest happened to run.
 */
export function earliestKeptDate(now: Date, years = RECENT_YEARS): string {
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()),
  );
  return cutoff.toISOString().slice(0, 10);
}

/** True when an ISO award date falls inside the window. */
export function isRecentAward(awardedOn: string, now: Date, years = RECENT_YEARS): boolean {
  // String comparison, because both sides are zero-padded ISO days and
  // parsing a publisher's date twice is two chances to get a timezone wrong.
  return awardedOn >= earliestKeptDate(now, years);
}

export interface Dated {
  awardedOn: string;
}

/**
 * Split fetched awards into the ones kept and the count dropped.
 *
 * Returns the count rather than the rows: nothing needs the old grants, and
 * holding a second array of a hundred thousand of them in a serverless
 * function is how a step dies of memory instead of time. But the COUNT is
 * returned, and recorded, because a cap that silently removes part of the
 * corpus is one nobody can audit — which is exactly what the page cap did
 * before 0014 counted it.
 */
export function keepRecent<T extends Dated>(
  awards: readonly T[],
  now: Date,
  years = RECENT_YEARS,
): { kept: T[]; discarded: number } {
  const cutoff = earliestKeptDate(now, years);
  const kept = awards.filter((award) => award.awardedOn >= cutoff);
  return { kept, discarded: awards.length - kept.length };
}
