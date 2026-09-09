'use server';

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { withAdmin } from '@/db';
import {
  claimFirstAdmin,
  countAdmins,
  createAdminSession,
  deleteAdminSession,
  findAdminByEmail,
  readAdminPassword,
  recordAdminSignIn,
  sweepAdminSessions,
} from '@/db/admin';
import { hashPassword, needsRehash, verifyPassword } from '@/auth/password';
import { setAdminPassword } from '@/db/admin';
import { ABSENT_ACCOUNT_HASH } from '@/auth/absent-account';
import { createSessionToken, hashSessionToken } from '@/auth/token';
import { isPlausibleEmail, normaliseEmail } from '@/domain/auth/account';
import {
  adminPasswordProblems,
  adminSessionExpiry,
  claimAvailability,
} from '@/domain/auth/admin';
import { describeWait } from '@/domain/auth/throttle';
import { readEnvironment } from '@/env';
import {
  checkAdminSignInLimit,
  clearAdminSignInLimit,
  recordFailedAdminSignIn,
} from '@/app/(auth)/limit';
import { ADMIN_COOKIE, adminCookieOptions } from './session';
import type { AdminAuthState } from './state';

/**
 * Signing in to the console, and claiming it the first time.
 *
 * Both paths deliberately refuse to say more than they must. "Those details do
 * not match" covers a wrong password, an address with no admin, and an admin
 * that has been stood down — because distinguishing them tells somebody
 * probing the door which half of the guess was right.
 */

const WRONG: AdminAuthState = {
  ok: false,
  message: 'Those details do not match.',
  problems: [],
  email: '',
};

/**
 * Compare two secrets without leaking how far the comparison got.
 *
 * A plain `===` on strings returns as soon as two bytes differ, and the timing
 * of that is measurable across enough attempts. Hardly the weak point when the
 * limiter allows five tries a half-hour, but constant time costs nothing here.
 */
function secretMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function startAdminSession(adminId: string): Promise<void> {
  const token = createSessionToken();
  const expiresAt = adminSessionExpiry(new Date());
  await withAdmin(async (tx) => {
    await sweepAdminSessions(tx);
    await createAdminSession(tx, { id: hashSessionToken(token), adminId, expiresAt });
    await recordAdminSignIn(tx, adminId);
  });
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, adminCookieOptions(expiresAt));
}

export async function adminSignInAction(
  _previous: AdminAuthState,
  formData: FormData,
): Promise<AdminAuthState> {
  const email = normaliseEmail(String(formData.get('email') ?? ''));
  const password = String(formData.get('password') ?? '');

  const limit = await checkAdminSignInLimit(email);
  if (!limit.allowed) {
    return {
      ok: false,
      message: `Too many attempts. Try again in ${describeWait(limit.retryAfterSeconds)}.`,
      problems: [],
      email,
    };
  }

  const account = await withAdmin((tx) => findAdminByEmail(tx, email));
  if (account === null || account.disabledAt !== null) {
    // Spend the same time as a real check would, so an address that exists
    // cannot be told apart from one that does not by how long the reply took.
    await verifyPassword(password, ABSENT_ACCOUNT_HASH);
    await recordFailedAdminSignIn(email);
    return { ...WRONG, email };
  }

  const stored = await withAdmin((tx) => readAdminPassword(tx, account.id));
  if (stored === null || !(await verifyPassword(password, stored))) {
    await recordFailedAdminSignIn(email);
    return { ...WRONG, email };
  }

  await clearAdminSignInLimit(email);

  // The one moment we hold the plaintext and know it is right.
  if (needsRehash(stored)) {
    await withAdmin(async (tx) => setAdminPassword(tx, account.id, await hashPassword(password)));
  }

  await startAdminSession(account.id);
  redirect('/admin');
}

/**
 * Claim the console, once.
 *
 * Three things must hold, and the last of them is enforced by the INSERT
 * rather than by a check beforehand: two requests arriving together would both
 * pass a count and both create an admin.
 */
export async function adminClaimAction(
  _previous: AdminAuthState,
  formData: FormData,
): Promise<AdminAuthState> {
  const email = normaliseEmail(String(formData.get('email') ?? ''));
  const password = String(formData.get('password') ?? '');
  const secret = String(formData.get('secret') ?? '');

  const configured = readEnvironment().adminClaimSecret;
  const existing = await withAdmin((tx) => countAdmins(tx));
  const availability = claimAvailability({
    existingAdmins: existing,
    secretConfigured: configured !== null,
  });
  if (!availability.open) {
    return {
      ok: false,
      message:
        availability.reason === 'already-claimed'
          ? 'This console has already been claimed. Sign in instead.'
          : 'Claiming is not enabled on this deployment.',
      problems: [],
      email,
    };
  }

  // Counted before anything expensive, and counted against the address so a
  // run of secret guesses cannot be spread across made-up addresses.
  const limit = await checkAdminSignInLimit(email);
  if (!limit.allowed) {
    return {
      ok: false,
      message: `Too many attempts. Try again in ${describeWait(limit.retryAfterSeconds)}.`,
      problems: [],
      email,
    };
  }

  if (configured === null || !secretMatches(secret, configured)) {
    await recordFailedAdminSignIn(email);
    return { ...WRONG, email };
  }

  const problems = adminPasswordProblems(password, email);
  if (!isPlausibleEmail(email)) {
    problems.unshift('That does not look like an email address.');
  }
  if (problems.length > 0) {
    return { ok: false, message: 'Nothing has been created yet.', problems, email };
  }

  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  const claimed = await withAdmin((tx) =>
    claimFirstAdmin(tx, { id, email, passwordHash }),
  );
  if (!claimed) {
    return {
      ok: false,
      message: 'Somebody claimed this console a moment ago. Sign in instead.',
      problems: [],
      email,
    };
  }

  await clearAdminSignInLimit(email);
  await startAdminSession(id);
  redirect('/admin');
}

export async function adminSignOutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token !== undefined && token !== '') {
    // Delete the row, not just the cookie: a copied cookie must stop working.
    await withAdmin((tx) => deleteAdminSession(tx, hashSessionToken(token)));
  }
  jar.delete({ name: ADMIN_COOKIE, path: '/admin' });
  redirect('/admin/sign-in');
}
