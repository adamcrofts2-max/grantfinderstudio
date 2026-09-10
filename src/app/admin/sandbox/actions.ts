'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getDatabase, withAdmin } from '@/db';
import { createSession } from '@/db/auth';
import { ensureOrganisation } from '@/db/onboarding';
import {
  deleteSandboxOrganisation,
  ensureSandboxUser,
  sandboxOrganisationId,
} from '@/db/sandbox';
import { sessionExpiry } from '@/domain/auth/account';
import { createSessionToken, hashSessionToken } from '@/auth/token';
import { SESSION_COOKIE, sessionCookieOptions } from '@/app/session';

import { requireAdmin } from '../session';

/**
 * Open the product as yourself.
 *
 * ## Read the argument list
 *
 * Neither action takes an organisation. `formData` is accepted because a form
 * submits one and is then IGNORED — the organisation is derived from the admin
 * id on the verified session, so a forged `organisationId` field changes
 * nothing. There is a test asserting exactly that, because the day somebody
 * adds a parameter here is the day this stops being a sandbox and starts being
 * an impersonation tool.
 *
 * What it hands over is an ordinary customer session: the same cookie a
 * signup gets, over an organisation that belongs to the operator. Nothing in
 * the console gains the ability to read a customer's rows, and nothing in the
 * product treats this session differently except to say, on every screen, that
 * it is a sandbox.
 */
export async function openSandboxAction(): Promise<void> {
  const session = await requireAdmin();
  const adminId = session.adminId;

  // The user row, on the admin path — `users` is the operator's table, and
  // deliberately no password row is written. See `ensureSandboxUser`.
  const account = await withAdmin((tx) => ensureSandboxUser(tx, adminId));

  // The organisation, on the TENANT path. It has to be: FORCE ROW LEVEL
  // SECURITY binds the owner too, so `WITH CHECK (id = the active tenant)` is
  // what an insert here satisfies — an organisation can only ever create
  // itself. This is the same call onboarding makes for a real signup.
  const database = await getDatabase();
  await database.withTenant(account.organisationId, (tx) =>
    ensureOrganisation(tx, account.organisationId, account.userId, 'Your sandbox'),
  );

  const token = createSessionToken();
  const expiresAt = sessionExpiry(new Date());
  await withAdmin((tx) =>
    createSession(tx, {
      id: hashSessionToken(token),
      userId: account.userId,
      organisationId: account.organisationId,
      expiresAt,
    }),
  );

  // Overwrites whatever customer session this browser held. Intended: an
  // operator who was signed in as their own trial account is asking to be in
  // the sandbox instead.
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));

  redirect('/');
}

/**
 * Empty the sandbox and start again.
 *
 * The organisation is deleted and everything cascades with it, so the next
 * time you open it you meet what a brand-new customer meets. That is the point
 * — first-run is the state worth testing most often and the hardest to get
 * back to.
 */
export async function resetSandboxAction(): Promise<void> {
  const session = await requireAdmin();
  const organisationId = sandboxOrganisationId(session.adminId);

  const database = await getDatabase();
  await database.withTenant(organisationId, (tx) => deleteSandboxOrganisation(tx));

  redirect('/admin/sandbox');
}
