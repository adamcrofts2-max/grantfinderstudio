import { headers } from 'next/headers';

import { withAdmin } from '@/db';
import {
  attemptKey,
  clearAttempt,
  readAttempt,
  sweepAttempts,
  writeAttempt,
  type Axis,
} from '@/db/throttle';
import {
  isBlocked,
  recordFailure,
  retryAfterSeconds,
  THROTTLE,
  type Policy,
} from '@/domain/auth/throttle';

/**
 * Applying the rate limit.
 *
 * The decisions are in `domain/auth/throttle.ts` and the storage in
 * `db/throttle.ts`; this is the thin piece that knows about HTTP.
 */

export interface LimitVerdict {
  allowed: boolean;
  /** Zero when allowed. */
  retryAfterSeconds: number;
}

/**
 * Which origin this request came from.
 *
 * `x-forwarded-for` is set by the platform in front of the app. It is also
 * a header a client can send, so this is only worth anything where something
 * upstream OVERWRITES it rather than appending to it — Vercel does, which is
 * where this deploys. Behind a proxy that does not, the per-origin limit can
 * be evaded by forging the header, and only the per-address limit stands up.
 * Recorded in DEPLOYMENT.md rather than assumed.
 *
 * The first entry is the client; the rest are the proxies it passed through.
 */
async function origin(): Promise<string> {
  const jar = await headers();
  const forwarded = jar.get('x-forwarded-for');
  if (forwarded !== null && forwarded.trim() !== '') {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first !== '') return first;
  }
  const real = jar.get('x-real-ip');
  if (real !== null && real.trim() !== '') return real.trim();
  // No header at all: local development, or a platform that strips it. One
  // shared bucket is the safe reading — it limits more, never less.
  return 'unknown-origin';
}

async function verdictFor(axis: Axis, value: string, policy: Policy): Promise<LimitVerdict> {
  const key = attemptKey(axis, value);
  const record = await withAdmin((tx) => readAttempt(tx, key));
  const now = new Date();
  if (record === null || !isBlocked(record, now, policy)) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return { allowed: false, retryAfterSeconds: retryAfterSeconds(record, now, policy) };
}

/**
 * May this attempt proceed?
 *
 * Called BEFORE any hashing. A limiter that runs after the expensive step has
 * not saved the expensive step, which is half of what it is for.
 *
 * When both axes are blocked the longer wait wins — telling someone to come
 * back in a minute when the other limit has fourteen to run would just have
 * them fail again.
 */
export async function checkSignInLimit(email: string): Promise<LimitVerdict> {
  const [byAddress, byOrigin] = await Promise.all([
    verdictFor('address', email, THROTTLE.address),
    verdictFor('origin', await origin(), THROTTLE.origin),
  ]);
  if (byAddress.allowed && byOrigin.allowed) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(byAddress.retryAfterSeconds, byOrigin.retryAfterSeconds),
  };
}

/**
 * The console's sign-in limit.
 *
 * Both axes, as with a customer's, but on the admin address bucket and the
 * tighter admin policy. The origin axis is shared deliberately: a run of
 * failures from one place is worth counting whichever door it is knocking on.
 */
export async function checkAdminSignInLimit(email: string): Promise<LimitVerdict> {
  const [byAddress, byOrigin] = await Promise.all([
    verdictFor('admin-address', email, THROTTLE.admin),
    verdictFor('origin', await origin(), THROTTLE.origin),
  ]);
  if (byAddress.allowed && byOrigin.allowed) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(byAddress.retryAfterSeconds, byOrigin.retryAfterSeconds),
  };
}

export async function recordFailedAdminSignIn(email: string): Promise<void> {
  await bump('admin-address', email, THROTTLE.admin);
  await bump('origin', await origin(), THROTTLE.origin);
  await sweepOccasionally();
}

export async function clearAdminSignInLimit(email: string): Promise<void> {
  await withAdmin((tx) => clearAttempt(tx, attemptKey('admin-address', email)));
}

/** The origin axis alone, for sign-up, where there is no address to defend. */
export async function checkSignUpLimit(): Promise<LimitVerdict> {
  return verdictFor('origin', await origin(), THROTTLE.origin);
}

/**
 * Drop long-lapsed buckets, occasionally.
 *
 * A bucket past its window is already harmless — it does not block anyone, and
 * the next failure resets it — so this is housekeeping against unbounded table
 * growth rather than correctness. Doing it on a small fraction of failures
 * keeps the table bounded without a scheduler to operate, and a failure that
 * lands on the sweep is the one request that pays for it.
 */
const SWEEP_ODDS = 0.02;
const SWEEP_AFTER_SECONDS = Math.max(THROTTLE.address.windowSeconds, THROTTLE.origin.windowSeconds) * 4;

async function sweepOccasionally(): Promise<void> {
  if (Math.random() >= SWEEP_ODDS) return;
  const before = new Date(Date.now() - SWEEP_AFTER_SECONDS * 1000);
  try {
    await withAdmin((tx) => sweepAttempts(tx, before));
  } catch {
    // Housekeeping must never be the reason a sign-in fails.
  }
}

async function bump(axis: Axis, value: string, policy: Policy): Promise<void> {
  const key = attemptKey(axis, value);
  const now = new Date();
  const record = await withAdmin((tx) => readAttempt(tx, key));
  await withAdmin((tx) => writeAttempt(tx, key, recordFailure(record, now, policy)));
}

/**
 * Count one failure against both axes.
 *
 * Counted for an address that has no account too. Otherwise "too many
 * attempts" would only ever appear for addresses that exist, and the limiter
 * would hand back exactly the account enumeration the sign-in wording and the
 * absent-account hash were built to withhold.
 */
export async function recordFailedSignIn(email: string): Promise<void> {
  await bump('address', email, THROTTLE.address);
  await bump('origin', await origin(), THROTTLE.origin);
  await sweepOccasionally();
}

export async function recordFailedSignUp(): Promise<void> {
  await bump('origin', await origin(), THROTTLE.origin);
  await sweepOccasionally();
}

/**
 * Forget this address's failures. Called on a successful sign-in.
 *
 * The ORIGIN bucket is deliberately not cleared: an attacker spraying from one
 * place who happens to hold one valid account would otherwise reset their own
 * budget every time they used it.
 */
export async function clearSignInLimit(email: string): Promise<void> {
  await withAdmin((tx) => clearAttempt(tx, attemptKey('address', email)));
}
