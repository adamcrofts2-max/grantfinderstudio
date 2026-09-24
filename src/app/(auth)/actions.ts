'use server';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';

import { getDatabase, withAdmin } from '@/db';
import {
  createAccount,
  createSession,
  deleteSession,
  deleteSessionsForUser,
  findAccountByEmail,
  findAccountById,
  organisationsForUser,
  readStoredPassword,
  setPassword,
} from '@/db/auth';
import { hashPassword, needsRehash, verifyPassword } from '@/auth/password';
import { ABSENT_ACCOUNT_HASH } from '@/auth/absent-account';
import { createSessionToken, hashSessionToken } from '@/auth/token';
import {
  isPlausibleEmail,
  normaliseEmail,
  passwordProblems,
  sessionExpiry,
} from '@/domain/auth/account';
import { SESSION_COOKIE, sessionCookieOptions } from '@/app/session';
import type { AuthState } from './state';
import {
  checkSignInLimit,
  checkSignUpLimit,
  clearSignInLimit,
  recordFailedSignIn,
  recordFailedSignUp,
} from './limit';
import { describeWait } from '@/domain/auth/throttle';
import { resetEmail, resetExpiry, resetLink } from '@/domain/auth/reset';
import {
  claimPasswordReset,
  createPasswordReset,
  deleteResetsForUser,
  sweepExpiredResets,
} from '@/db/password-reset';
import { readEnvironment } from '@/env';
import { mailSetup } from '@/mail/mailer';
import { deploymentProblem } from './readiness';
import { checkResetLimit, recordResetRequest } from './limit';



async function startSession(userId: string, organisationId: string | null): Promise<void> {
  const token = createSessionToken();
  const expiresAt = sessionExpiry(new Date());
  await withAdmin((tx) =>
    createSession(tx, { id: hashSessionToken(token), userId, organisationId, expiresAt }),
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

/** Which organisation this person acts as. Their first, until there is a switcher. */
async function firstOrganisation(userId: string): Promise<string | null> {
  const database = await getDatabase();
  const memberships = await database.withUser(userId, (tx) => organisationsForUser(tx, userId));
  return memberships[0]?.organisationId ?? null;
}

export async function signUpAction(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = normaliseEmail(String(formData.get('email') ?? ''));
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '').trim();

  const unavailable = await deploymentProblem();
  if (unavailable !== null) {
    return { ok: false, message: unavailable, problems: [], email };
  }

  const limit = await checkSignUpLimit();
  if (!limit.allowed) {
    return {
      ok: false,
      message: `Too many attempts from this connection. Try again in ${describeWait(limit.retryAfterSeconds)}.`,
      problems: [],
      email,
    };
  }

  const problems = passwordProblems(password, email);
  if (!isPlausibleEmail(email)) {
    problems.unshift('That does not look like an email address.');
  }
  if (problems.length > 0) {
    return { ok: false, message: 'Nothing has been created yet.', problems, email };
  }

  const existing = await withAdmin((tx) => findAccountByEmail(tx, email));
  if (existing !== null) {
    // Counted: this is the expensive, enumerable end of sign-up.
    await recordFailedSignUp();
    // This does reveal that an account exists. There is no way to avoid it
    // while sign-up is instant and there is no email to send a "someone tried
    // to register your address" notice to. Sign-IN, where it matters more,
    // reveals nothing. Revisit when there is a mailer.
    return {
      ok: false,
      message: 'There is already an account with that address. Sign in instead.',
      problems: [],
      email,
    };
  }

  const userId = randomUUID();
  const passwordHash = await hashPassword(password);
  await withAdmin((tx) =>
    createAccount(tx, { id: userId, email, name: name === '' ? null : name, passwordHash }),
  );

  await startSession(userId, null);
  // A new account has no organisation, so there is nothing else it could do.
  redirect('/onboarding');
}

export async function signInAction(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = normaliseEmail(String(formData.get('email') ?? ''));
  const password = String(formData.get('password') ?? '');

  const unavailable = await deploymentProblem();
  if (unavailable !== null) {
    return { ok: false, message: unavailable, problems: [], email };
  }

  const limit = await checkSignInLimit(email);
  if (!limit.allowed) {
    // Before the hash, not after: a limiter that runs after the expensive
    // step has not saved the expensive step.
    return {
      ok: false,
      message: `Too many sign-in attempts. Try again in ${describeWait(limit.retryAfterSeconds)}.`,
      problems: [],
      email,
    };
  }

  const wrong: AuthState = {
    ok: false,
    // One message for both failures. Which of the two it was is exactly the
    // thing an attacker is trying to learn.
    message: 'That email address and password do not match an account.',
    problems: [],
    email,
  };

  const account = await withAdmin((tx) => findAccountByEmail(tx, email));
  if (account === null) {
    await verifyPassword(password, ABSENT_ACCOUNT_HASH);
    await recordFailedSignIn(email);
    return wrong;
  }

  const stored = await withAdmin((tx) => readStoredPassword(tx, account.id));
  if (stored === null) {
    // An account with no password: created by an operator, or by a sign-in
    // method we have not built. It cannot be signed into this way.
    await verifyPassword(password, ABSENT_ACCOUNT_HASH);
    await recordFailedSignIn(email);
    return wrong;
  }

  if (!(await verifyPassword(password, stored))) {
    await recordFailedSignIn(email);
    return wrong;
  }

  // Right password: this address starts again from nothing.
  await clearSignInLimit(email);

  // The one moment we hold the plaintext and know it is right.
  if (needsRehash(stored)) {
    await withAdmin(async (tx) => setPassword(tx, account.id, await hashPassword(password)));
  }

  const organisationId = await firstOrganisation(account.id);
  await startSession(account.id, organisationId);
  redirect(organisationId === null ? '/onboarding' : '/');
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token !== undefined && token !== '') {
    // Delete the row, not just the cookie: a copied cookie must stop working.
    await withAdmin((tx) => deleteSession(tx, hashSessionToken(token)));
  }
  jar.delete(SESSION_COOKIE);
  redirect('/sign-in');
}

/**
 * Send a password reset link, if there is an account to send one to.
 *
 * The reply is the same whether or not the address has an account, and so is
 * the time it takes: the account is looked up and the email sent AFTER the
 * response has gone, so neither the words nor the stopwatch say which
 * addresses are registered. The rate limit is counted before any of that, for
 * every address alike, for the same reason.
 *
 * Only an account with a password gets a link. One without — an operator's
 * sandbox — has no password to reset, and must not gain one this way.
 */
export async function requestResetAction(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = normaliseEmail(String(formData.get('email') ?? ''));

  const unavailable = await deploymentProblem();
  if (unavailable !== null) {
    return { ok: false, message: unavailable, problems: [], email };
  }

  const setup = mailSetup(readEnvironment());
  if (setup === null) {
    return {
      ok: false,
      message:
        'This deployment cannot send email yet, so a password cannot be reset from here. Ask whoever runs it to set up mail.',
      problems: [],
      email,
    };
  }

  if (!isPlausibleEmail(email)) {
    return { ok: false, message: 'That does not look like an email address.', problems: [], email };
  }

  const limit = await checkResetLimit(email);
  if (!limit.allowed) {
    return {
      ok: false,
      message: `Several links have already been sent. Check your inbox and spam folder, or try again in ${describeWait(limit.retryAfterSeconds)}.`,
      problems: [],
      email,
    };
  }
  await recordResetRequest(email);

  after(async () => {
    try {
      const now = new Date();
      const account = await withAdmin((tx) => findAccountByEmail(tx, email));
      if (account === null) return;
      const stored = await withAdmin((tx) => readStoredPassword(tx, account.id));
      if (stored === null) return;

      const token = createSessionToken();
      await withAdmin(async (tx) => {
        await sweepExpiredResets(tx, now);
        await createPasswordReset(tx, {
          id: hashSessionToken(token),
          userId: account.id,
          expiresAt: resetExpiry(now),
        });
      });
      const { subject, text } = resetEmail(resetLink(setup.linkBase, token));
      await setup.mailer.send({ to: account.email, subject, text });
    } catch (error) {
      // After the response, so nobody is waiting on it. The log is the only
      // place a failure to send can go — never the address or the link.
      console.error('[grantfinderstudio] a password reset email could not be sent:', error);
    }
  });

  return {
    ok: true,
    message: `If ${email} has an account, a link to choose a new password is on its way. It works once, for 30 minutes.`,
    problems: [],
    email,
  };
}

/** Thrown inside the reset transaction to roll the claim back. */
class KeepTheLink extends Error {
  constructor(readonly problems: string[]) {
    super('The new password was refused; the link is kept.');
  }
}

/**
 * Choose a new password with a reset link.
 *
 * One transaction: the link is claimed, the password checked against the
 * account it belongs to, and the new one stored — and if the password is
 * refused, the claim rolls back, so a typo does not spend the link.
 *
 * The link is claimed BEFORE the password is hashed, so a made-up token costs
 * one indexed DELETE and never a hash. A 256-bit token cannot be guessed, so
 * there is nothing here for a rate limit to protect.
 *
 * On success every session for the account ends — a reset is what somebody
 * does when they think someone else has their password — and every other
 * outstanding link dies with it.
 */
export async function resetPasswordAction(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');

  const unavailable = await deploymentProblem();
  if (unavailable !== null) {
    return { ok: false, message: unavailable, problems: [], email: '' };
  }

  const dead: AuthState = {
    ok: false,
    message: 'This link has expired or has already been used. Ask for a new one below.',
    problems: [],
    email: '',
  };
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return dead;

  // The checks that need no account, before anything is spent.
  const early = passwordProblems(password, '');
  if (early.length > 0) {
    return { ok: false, message: 'Your password has not been changed yet.', problems: early, email: '' };
  }

  let email: string;
  try {
    const outcome = await withAdmin(async (tx) => {
      const userId = await claimPasswordReset(tx, hashSessionToken(token), new Date());
      if (userId === null) return null;
      const account = await findAccountById(tx, userId);
      if (account === null) return null;
      const problems = passwordProblems(password, account.email);
      if (problems.length > 0) throw new KeepTheLink(problems);
      await setPassword(tx, account.id, await hashPassword(password));
      await deleteSessionsForUser(tx, account.id);
      await deleteResetsForUser(tx, account.id);
      return account.email;
    });
    if (outcome === null) return dead;
    email = outcome;
  } catch (error) {
    if (error instanceof KeepTheLink) {
      return {
        ok: false,
        message: 'Your password has not been changed yet.',
        problems: error.problems,
        email: '',
      };
    }
    throw error;
  }

  // Whatever was guessed at this address before, the owner has just proved
  // they hold its inbox.
  await clearSignInLimit(email);
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect('/sign-in?reset=done');
}
