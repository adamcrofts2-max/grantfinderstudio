import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { withAdmin } from '@/db';
import {
  deleteAdminSession,
  loadAdminSession,
  touchAdminSession,
  type AdminSessionRecord,
} from '@/db/admin';
import { isExpired } from '@/domain/auth/account';
import { hashSessionToken } from '@/auth/token';
import { readEnvironment } from '@/env';

/**
 * Who is running the service.
 *
 * A separate cookie from the customer's, on a separate path, holding a
 * separate token that resolves against a separate table. There is no
 * relationship between the two: being signed in as a customer grants nothing
 * here, and holding an admin session grants nothing over any organisation's
 * data — `withOperator`, which is what the console reads through, has no grant
 * on a tenant table at all.
 */

export const ADMIN_COOKIE = 'gfs_admin';

export interface AdminSession extends AdminSessionRecord {
  tokenHash: string;
}

export function adminCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    /**
     * Strict, where the customer's cookie is Lax.
     *
     * Lax exists so somebody arriving from a link in their own email stays
     * signed in — a real cost to a customer, and no cost at all to an
     * operator, who reaches the console by typing the address. Strict removes
     * the cross-site request class outright.
     */
    sameSite: 'strict' as const,
    secure: readEnvironment().isProduction,
    /**
     * Scoped to /admin, so the console's cookie is not attached to a single
     * customer-facing request. A page that never receives it cannot leak it.
     */
    path: '/admin',
    expires,
  };
}

/**
 * Resolve the current admin session, or null.
 *
 * Memoised per render pass, and fails CLOSED: a database error resolves to
 * "not signed in", never to "probably fine". The customer session does the
 * same, and the reasoning is stronger here.
 */
export const readAdminSession = cache(async (): Promise<AdminSession | null> => {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token === undefined || token === '') return null;

  const tokenHash = hashSessionToken(token);
  try {
    const record = await withAdmin(async (tx) => {
      const session = await loadAdminSession(tx, tokenHash);
      if (session === null) return null;
      if (isExpired(session.expiresAt, new Date())) {
        // Expired means gone, not merely unusable: leaving the row behind
        // turns the table into a log of who was here.
        await deleteAdminSession(tx, tokenHash);
        return null;
      }
      await touchAdminSession(tx, tokenHash);
      return session;
    });
    if (record === null) return null;
    return { ...record, tokenHash };
  } catch (error) {
    console.error('[grantfinderstudio] could not read the admin session:', error);
    return null;
  }
});

/** The console's guard. Anything under it is unreachable without a session. */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await readAdminSession();
  if (session === null) redirect('/admin/sign-in');
  return session;
}
