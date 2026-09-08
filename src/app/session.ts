import { randomUUID } from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { withAdmin } from '@/db';
import {
  loadSession,
  setSessionOrganisation,
  touchSession,
  type SessionRecord,
} from '@/db/auth';
import { ACCOUNT_CONSTANTS, sessionExpiry } from '@/domain/auth/account';
import { hashSessionToken } from '@/auth/token';
import { readEnvironment } from '@/env';

/**
 * Who is asking.
 *
 * Every tenant-scoped read in the product goes through here for its
 * organisation id. The rule the whole file exists to enforce is that there is
 * no other way to get one — no default, no fallback, no demo organisation to
 * land on when a session is missing. An absent or expired session means no
 * rows, the same way an unset `app.organisation_id` means no rows.
 */

export const SESSION_COOKIE = 'gfs_session';

export interface Session extends SessionRecord {
  /** The hash, which is the session's identity. The token itself stays in the cookie. */
  tokenHash: string;
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // Lax rather than strict: strict would drop the cookie when someone
    // arrives from a link in their own email, which is how people return.
    secure: readEnvironment().isProduction,
    path: '/',
    expires,
  };
}

/**
 * Resolve the current session, or null.
 *
 * Memoised for the render pass: a page may ask several times, and this must
 * not become several round trips. `cache` is per-request, so it cannot leak
 * one visitor's session into another's render.
 */
export const readSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token === undefined || token === '') return null;

  const tokenHash = hashSessionToken(token);
  const now = new Date();

  // FAILS CLOSED, and never throws.
  //
  // This runs in the root layout, so it is on the path of every page. If it
  // threw when the database were unavailable, someone holding a cookie would
  // get a crash page on every route — including the one that would let them
  // sign out. Treating the session as absent instead sends them to sign-in,
  // which is the safe direction: this can only ever deny access, never grant
  // it. The operator sees the truth at /api/health.
  let session: SessionRecord | null;
  try {
    session = await withAdmin((tx) => loadSession(tx, tokenHash, now));
  } catch (error) {
    console.error('[grantfinderstudio] could not read the session:', error);
    return null;
  }
  if (session === null) return null;

  // Slide the window, but only once it is half spent — otherwise every page
  // view is a write. Someone using the product daily is never signed out;
  // someone who stops using it is, on schedule.
  const halfLife = (ACCOUNT_CONSTANTS.sessionDays / 2) * 24 * 60 * 60 * 1000;
  if (session.expiresAt.getTime() - now.getTime() < halfLife) {
    try {
      await withAdmin((tx) => touchSession(tx, tokenHash, sessionExpiry(now)));
    } catch {
      // Housekeeping. Failing to extend a valid session must not end it.
    }
  }

  return { ...session, tokenHash };
});

/** A signed-in person, or the sign-in page. */
export async function requireSession(): Promise<Session> {
  const session = await readSession();
  if (session === null) redirect('/sign-in');
  return session;
}

/**
 * Who is doing this.
 *
 * Used wherever the record says a person did something — confirming a fact,
 * verifying a criterion. Those are audit trails, and an audit trail naming a
 * constant is not one.
 */
export async function requireUserId(): Promise<string> {
  return (await requireSession()).userId;
}

/**
 * The organisation to read and write as.
 *
 * A signed-in account with no organisation is sent to onboarding rather than
 * shown an empty product: there is nothing it could truthfully display, and
 * "no results" would be a lie about the funding landscape.
 */
export async function requireOrganisationId(): Promise<string> {
  const session = await requireSession();
  if (session.organisationId === null) redirect('/onboarding');
  return session.organisationId;
}

export interface OrganisationClaim {
  userId: string;
  organisationId: string;
  /** True when the organisation does not exist yet and this call minted its id. */
  isNew: boolean;
  tokenHash: string;
}

/**
 * The organisation that onboarding should write into.
 *
 * A returning person already has one and keeps it — onboarding is also how you
 * correct your own details, and minting a second organisation for that would
 * silently abandon everything in the first. A fresh account gets a new id
 * here, which is NOT yet attached to the session: the session's foreign key
 * needs the row to exist, and a session pointing at an organisation that a
 * failed transaction never created would lock the account out of the product.
 *
 * So: claim, write, then `commitOrganisation`.
 */
export async function claimOrganisation(): Promise<OrganisationClaim> {
  const session = await requireSession();
  return {
    userId: session.userId,
    organisationId: session.organisationId ?? randomUUID(),
    isNew: session.organisationId === null,
    tokenHash: session.tokenHash,
  };
}

/** Point the session at the organisation, now that its row exists. */
export async function commitOrganisation(claim: OrganisationClaim): Promise<void> {
  if (!claim.isNew) return;
  await withAdmin((tx) => setSessionOrganisation(tx, claim.tokenHash, claim.organisationId));
}
