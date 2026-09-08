'use server';

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getDatabase, withAdmin } from '@/db';
import {
  createAccount,
  createSession,
  deleteSession,
  findAccountByEmail,
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

  const problems = passwordProblems(password, email);
  if (!isPlausibleEmail(email)) {
    problems.unshift('That does not look like an email address.');
  }
  if (problems.length > 0) {
    return { ok: false, message: 'Nothing has been created yet.', problems, email };
  }

  const existing = await withAdmin((tx) => findAccountByEmail(tx, email));
  if (existing !== null) {
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
    return wrong;
  }

  const stored = await withAdmin((tx) => readStoredPassword(tx, account.id));
  if (stored === null) {
    // An account with no password: created by an operator, or by a sign-in
    // method we have not built. It cannot be signed into this way.
    await verifyPassword(password, ABSENT_ACCOUNT_HASH);
    return wrong;
  }

  if (!(await verifyPassword(password, stored))) return wrong;

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
