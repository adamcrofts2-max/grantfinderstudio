/**
 * Rate limiting for the sign-in and sign-up forms.
 *
 * Pure and zero I/O, like the rest of the domain: this file decides, and
 * `db/throttle.ts` remembers. Everything here can be argued with and tested
 * without a database or a clock.
 *
 * TWO AXES, because they catch different attacks and neither catches the
 * other's:
 *
 *   BY ADDRESS — someone grinding one account's password. A per-IP limit
 *     barely touches this if they have a few addresses to rotate through.
 *   BY ORIGIN — someone spraying one common password across many accounts.
 *     Credential stuffing never trips a per-address limit, because it only
 *     tries each address once.
 *
 * The accepted cost of the first axis is that anyone can make somebody else's
 * address unusable for the length of a window by failing at it deliberately.
 * That is why the window is short and self-healing rather than a lockout an
 * administrator has to lift: fifteen minutes of nuisance is a much smaller
 * harm than an unbounded guessing budget, and a lockout that needs a human to
 * clear it is a better denial of service than the one it prevents.
 */

export interface Policy {
  maxAttempts: number;
  windowSeconds: number;
}

export const THROTTLE: { address: Policy; origin: Policy; admin: Policy } = {
  /**
   * Ten tries at one address in fifteen minutes. Comfortably above anyone
   * genuinely misremembering a password, far below anything useful for
   * guessing one.
   */
  address: { maxAttempts: 10, windowSeconds: 900 },
  /**
   * Thirty from one origin in the same window. Higher because an office, a
   * school or anyone behind carrier-grade NAT shares an address, and locking
   * out a whole building is its own outage.
   */
  origin: { maxAttempts: 30, windowSeconds: 900 },
  /**
   * Five tries at the console in the same window, half an hour's lockout.
   *
   * Tighter than a customer's ten because the population is one person who
   * knows their own password, so a run of failures is not somebody having a
   * bad morning — and because what is behind this door is the service rather
   * than one bid.
   */
  admin: { maxAttempts: 5, windowSeconds: 1800 },
};

export interface AttemptRecord {
  attempts: number;
  windowStartedAt: Date;
}

/** Has the window this record belongs to already elapsed? */
export function windowExpired(
  record: AttemptRecord,
  now: Date,
  policy: Policy,
): boolean {
  const elapsed = now.getTime() - record.windowStartedAt.getTime();
  return elapsed >= policy.windowSeconds * 1000;
}

/**
 * Should this attempt be refused before any work is done?
 *
 * Called BEFORE hashing, which is the point: a limiter that runs after the
 * expensive step has not saved the expensive step.
 */
export function isBlocked(
  record: AttemptRecord | null,
  now: Date,
  policy: Policy,
): boolean {
  if (record === null) return false;
  if (windowExpired(record, now, policy)) return false;
  return record.attempts >= policy.maxAttempts;
}

/** How long until this record's window lapses. Zero once it has. */
export function retryAfterSeconds(
  record: AttemptRecord,
  now: Date,
  policy: Policy,
): number {
  const endsAt = record.windowStartedAt.getTime() + policy.windowSeconds * 1000;
  return Math.max(0, Math.ceil((endsAt - now.getTime()) / 1000));
}

/**
 * The record after one more failure.
 *
 * A lapsed window starts a fresh one rather than accumulating for ever, so
 * somebody who mistypes twice a month is never gradually locked out.
 */
export function recordFailure(
  record: AttemptRecord | null,
  now: Date,
  policy: Policy,
): AttemptRecord {
  if (record === null || windowExpired(record, now, policy)) {
    return { attempts: 1, windowStartedAt: now };
  }
  return { attempts: record.attempts + 1, windowStartedAt: record.windowStartedAt };
}

/** "12 minutes" / "45 seconds" — for telling someone when to come back. */
export function describeWait(seconds: number): string {
  if (seconds <= 90) {
    const n = Math.max(1, Math.ceil(seconds));
    return `${n} ${n === 1 ? 'second' : 'seconds'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}
