/**
 * How long ago, in words.
 *
 * ## Why `now` is an argument
 *
 * Two reasons, and the second is a bug that was already shipped.
 *
 * **It is testable.** A function that reads the clock can only be tested
 * against the clock, which means either a fixture that rots or a test that
 * asserts nothing.
 *
 * **A client component must not read the clock while rendering.** This logic
 * lived inside `ReviewPanel`, which is `'use client'` — and a client component
 * in Next is rendered on the SERVER for the initial HTML and then hydrated in
 * the browser. `Date.now()` is a different number in those two places, so a
 * load that straddles a minute tick produced "3 minutes ago" in the HTML and
 * "4 minutes ago" on hydration: a text mismatch, which React reports as error
 * #418 and recovers from by throwing the server's markup away and re-rendering
 * the tree. Intermittent by construction, invisible in every test, and the
 * kind of thing that only shows up as a console error somebody happens to be
 * collecting.
 *
 * Taking `now` as an argument does not fix that on its own — the fix is that
 * the SERVER computes the phrase and passes the string down, so there is one
 * clock reading and it is in the HTML. But a signature that demands a `now`
 * is what makes the mistake hard to make again.
 */

const MINUTE = 60_000;

export function since(iso: string, now: number): string {
  // Tolerant of a space-separated timestamp as well as a T, because Postgres
  // renders one and `new Date()` refuses it.
  const then = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(then.getTime())) return 'earlier';

  const elapsed = now - then.getTime();
  // Under a minute is "just now", tested at the boundary. The version this
  // replaced rounded first, so thirty seconds ago read "1 minute ago" — which
  // is not what "just now" is for, and a clock skew between the database and
  // whatever renders this can make `elapsed` negative anyway.
  if (elapsed < MINUTE) return 'just now';

  const minutes = Math.round(elapsed / MINUTE);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;

  const months = Math.round(days / 30);
  return months === 1 ? 'last month' : `${months} months ago`;
}
