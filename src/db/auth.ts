/**
 * Account and session queries.
 *
 * Every function here takes the ADMIN path, and the module boundary is doing
 * real work: these read the two tables the tenant role cannot see
 * (`user_passwords`, `sessions`) plus `users`, all before anybody is anybody.
 * Nothing tenant-scoped may be read through them.
 *
 * The exception is `organisationsForUser`, which runs unprivileged under
 * `withUser` — see `TenantDatabase.withUser`.
 */

import type { Queryable } from './client.js';
import { normaliseEmail } from '../domain/auth/account.js';

export interface Account {
  id: string;
  email: string;
  name: string | null;
}

export interface StoredPassword {
  userId: string;
  hash: string;
}

export interface SessionRecord {
  userId: string;
  /** Null until onboarding creates an organisation for a new account. */
  organisationId: string | null;
  expiresAt: Date;
  /**
   * True when this is an operator's own sandbox rather than a customer.
   *
   * Joined here rather than read separately because the session is already
   * being resolved on the owner connection on every request, and `app_user`
   * cannot read `users` at all (0009). One join, no second round trip, and no
   * screen has to remember to ask.
   */
  sandbox: boolean;
}

/** Look an account up by address. Normalised on both sides — see 0007. */
export async function findAccountByEmail(
  tx: Queryable,
  email: string,
): Promise<Account | null> {
  const { rows } = await tx.query<{ id: string; email: string; name: string | null }>(
    'SELECT id, email, name FROM users WHERE lower(email) = $1',
    [normaliseEmail(email)],
  );
  return rows[0] ?? null;
}

export async function readStoredPassword(
  tx: Queryable,
  userId: string,
): Promise<string | null> {
  const { rows } = await tx.query<{ password_hash: string }>(
    'SELECT password_hash FROM user_passwords WHERE user_id = $1',
    [userId],
  );
  return rows[0]?.password_hash ?? null;
}

export async function createAccount(
  tx: Queryable,
  account: { id: string; email: string; name: string | null; passwordHash: string },
): Promise<void> {
  await tx.query(
    'INSERT INTO users (id, email, name) VALUES ($1, $2, $3)',
    [account.id, normaliseEmail(account.email), account.name],
  );
  await tx.query(
    'INSERT INTO user_passwords (user_id, password_hash) VALUES ($1, $2)',
    [account.id, account.passwordHash],
  );
}

/** Used to upgrade a hash in place when the work factor has been raised. */
export async function setPassword(
  tx: Queryable,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO user_passwords (user_id, password_hash, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET password_hash = $2, updated_at = now()`,
    [userId, passwordHash],
  );
}

export async function createSession(
  tx: Queryable,
  session: {
    id: string;
    userId: string;
    organisationId: string | null;
    expiresAt: Date;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO sessions (id, user_id, organisation_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [session.id, session.userId, session.organisationId, session.expiresAt.toISOString()],
  );
}

/**
 * Resolve a session by the hash of its token.
 *
 * Expiry is enforced in the WHERE clause rather than in TypeScript, so an
 * expired session is indistinguishable from a missing one at every caller —
 * there is no branch anywhere that could be written the wrong way round.
 */
export async function loadSession(
  tx: Queryable,
  tokenHash: string,
  now: Date,
): Promise<SessionRecord | null> {
  const { rows } = await tx.query<{
    user_id: string;
    organisation_id: string | null;
    expires_at: string | Date;
    sandbox_of_admin: string | null;
  }>(
    `SELECT s.user_id, s.organisation_id, s.expires_at, u.sandbox_of_admin
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > $2`,
    [tokenHash, now.toISOString()],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    userId: row.user_id,
    organisationId: row.organisation_id,
    expiresAt: new Date(row.expires_at),
    sandbox: row.sandbox_of_admin !== null,
  };
}

/** Record use, and push the expiry out so an active session does not lapse. */
export async function touchSession(
  tx: Queryable,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await tx.query(
    'UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE id = $1',
    [tokenHash, expiresAt.toISOString()],
  );
}

/** Attach an organisation to a session, once onboarding has created one. */
export async function setSessionOrganisation(
  tx: Queryable,
  tokenHash: string,
  organisationId: string,
): Promise<void> {
  await tx.query('UPDATE sessions SET organisation_id = $2 WHERE id = $1', [
    tokenHash,
    organisationId,
  ]);
}

export async function deleteSession(tx: Queryable, tokenHash: string): Promise<void> {
  await tx.query('DELETE FROM sessions WHERE id = $1', [tokenHash]);
}

/**
 * End every session a person holds.
 *
 * For a password change: whoever else was holding a session got it with the
 * old password, and changing a password is what someone does when they think
 * that has happened.
 */
export async function deleteSessionsForUser(tx: Queryable, userId: string): Promise<void> {
  await tx.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

/**
 * End every session acting as an organisation.
 *
 * Called when a membership is revoked. The session captured the organisation
 * at sign-in rather than re-deriving it per request, so revocation has to
 * reach in and delete — see the note in 0007.
 */
export async function deleteSessionsForMembership(
  tx: Queryable,
  userId: string,
  organisationId: string,
): Promise<void> {
  await tx.query('DELETE FROM sessions WHERE user_id = $1 AND organisation_id = $2', [
    userId,
    organisationId,
  ]);
}

export async function deleteExpiredSessions(tx: Queryable, now: Date): Promise<number> {
  const { rows } = await tx.query<{ id: string }>(
    'DELETE FROM sessions WHERE expires_at <= $1 RETURNING id',
    [now.toISOString()],
  );
  return rows.length;
}

/**
 * Which organisations this person belongs to.
 *
 * Runs under `withUser`, not `withAdmin`: answering "which organisations are
 * mine" should not require the ability to read every membership on the
 * platform.
 */
export async function organisationsForUser(
  tx: Queryable,
  userId: string,
): Promise<Array<{ organisationId: string; role: string }>> {
  const { rows } = await tx.query<{ organisation_id: string; role: string }>(
    'SELECT organisation_id, role FROM memberships WHERE user_id = $1 ORDER BY created_at',
    [userId],
  );
  return rows.map((r) => ({ organisationId: r.organisation_id, role: r.role }));
}
