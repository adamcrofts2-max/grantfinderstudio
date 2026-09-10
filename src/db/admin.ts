/**
 * Admin accounts and admin sessions. ADMIN scope throughout.
 *
 * Every table touched here is `REVOKE ALL FROM PUBLIC` (0009) and granted to
 * no role at all, so all of it runs through `withAdmin` on the owner
 * connection — the same rule as `sessions` and `user_passwords`: this is read
 * before anybody is anybody, and it is part of deciding whether they get to
 * be.
 *
 * Note what is NOT here: any read of tenant data. The console's own queries
 * run through `withOperator`, whose role holds no grant on a single tenant
 * table. Keeping the two apart is what makes "an admin cannot see a
 * customer's application" a property of the database rather than a promise.
 */

import type { Queryable } from './client.js';

export interface AdminAccount {
  id: string;
  email: string;
  disabledAt: Date | null;
}

interface AdminRow {
  id: string;
  email: string;
  disabled_at: Date | string | null;
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

/** How many admins exist. The claim route turns on this and nothing else. */
export async function countAdmins(tx: Queryable): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM admin_accounts',
  );
  return rows[0]?.n ?? 0;
}

export async function findAdminByEmail(
  tx: Queryable,
  email: string,
): Promise<AdminAccount | null> {
  const { rows } = await tx.query<AdminRow>(
    'SELECT id, email, disabled_at FROM admin_accounts WHERE lower(email) = $1',
    [email.trim().toLowerCase()],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { id: row.id, email: row.email, disabledAt: toDate(row.disabled_at) };
}

export async function readAdminPassword(
  tx: Queryable,
  adminId: string,
): Promise<string | null> {
  const { rows } = await tx.query<{ password_hash: string }>(
    'SELECT password_hash FROM admin_accounts WHERE id = $1',
    [adminId],
  );
  return rows[0]?.password_hash ?? null;
}

export async function setAdminPassword(
  tx: Queryable,
  adminId: string,
  passwordHash: string,
): Promise<void> {
  await tx.query('UPDATE admin_accounts SET password_hash = $2 WHERE id = $1', [
    adminId,
    passwordHash,
  ]);
}

/**
 * Create the first admin, and only the first.
 *
 * `WHERE NOT EXISTS (SELECT 1 FROM admin_accounts)` inside the INSERT rather
 * than a count checked beforehand: two requests arriving together would both
 * pass a prior check and both create an admin. Here the second one inserts
 * zero rows and is told so.
 */
export async function claimFirstAdmin(
  tx: Queryable,
  account: { id: string; email: string; passwordHash: string },
): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO admin_accounts (id, email, password_hash)
     SELECT $1, $2, $3
     WHERE NOT EXISTS (SELECT 1 FROM admin_accounts)
     RETURNING id`,
    [account.id, account.email, account.passwordHash],
  );
  return rows.length === 1;
}

export interface AdminSessionRecord {
  adminId: string;
  email: string;
  expiresAt: Date;
}

export async function createAdminSession(
  tx: Queryable,
  session: { id: string; adminId: string; expiresAt: Date },
): Promise<void> {
  await tx.query(
    'INSERT INTO admin_sessions (id, admin_id, expires_at) VALUES ($1, $2, $3)',
    [session.id, session.adminId, session.expiresAt],
  );
}

/**
 * Load a session by its token hash.
 *
 * Joins the account so a disabled admin's live session stops working
 * immediately rather than at expiry. Revocation that waits eight hours is not
 * revocation.
 */
export async function loadAdminSession(
  tx: Queryable,
  tokenHash: string,
): Promise<AdminSessionRecord | null> {
  const { rows } = await tx.query<{
    admin_id: string;
    email: string;
    expires_at: Date | string;
    disabled_at: Date | string | null;
  }>(
    `SELECT s.admin_id, a.email, s.expires_at, a.disabled_at
       FROM admin_sessions s
       JOIN admin_accounts a ON a.id = s.admin_id
      WHERE s.id = $1`,
    [tokenHash],
  );
  const row = rows[0];
  if (row === undefined) return null;
  if (toDate(row.disabled_at) !== null) return null;
  return {
    adminId: row.admin_id,
    email: row.email,
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
  };
}

export async function touchAdminSession(tx: Queryable, tokenHash: string): Promise<void> {
  await tx.query('UPDATE admin_sessions SET last_seen_at = now() WHERE id = $1', [tokenHash]);
}

export async function deleteAdminSession(tx: Queryable, tokenHash: string): Promise<void> {
  await tx.query('DELETE FROM admin_sessions WHERE id = $1', [tokenHash]);
}

export async function recordAdminSignIn(tx: Queryable, adminId: string): Promise<void> {
  await tx.query('UPDATE admin_accounts SET last_signed_in_at = now() WHERE id = $1', [
    adminId,
  ]);
}

/** Expired rows, swept opportunistically on sign-in. */
export async function sweepAdminSessions(tx: Queryable): Promise<void> {
  await tx.query('DELETE FROM admin_sessions WHERE expires_at <= now()');
}

/* ---------------------------------------------------------------------------
 * The roster.
 *
 * An admin console that can create an admin but never stand one down has a
 * revocation story only on paper: `disabled_at` has existed since 0009 and
 * `loadAdminSession` has always honoured it, but nothing ever wrote it, so
 * removing somebody's access meant an UPDATE typed against production. These
 * are what write it.
 * ------------------------------------------------------------------------ */

export interface AdminSummary extends AdminAccount {
  createdAt: Date;
  lastSignedInAt: Date | null;
}

export async function listAdmins(tx: Queryable): Promise<AdminSummary[]> {
  const { rows } = await tx.query<
    AdminRow & { created_at: Date | string; last_signed_in_at: Date | string | null }
  >(
    `SELECT id, email, disabled_at, created_at, last_signed_in_at
       FROM admin_accounts
      -- email breaks the tie: two admins added in the same second would
      -- otherwise swap places between page loads.
      ORDER BY created_at ASC, lower(email) ASC`,
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    disabledAt: toDate(row.disabled_at),
    createdAt: toDate(row.created_at) ?? new Date(0),
    lastSignedInAt: toDate(row.last_signed_in_at),
  }));
}

/** How many admins could sign in right now. The stand-down guard turns on this. */
export async function countEnabledAdmins(tx: Queryable): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM admin_accounts WHERE disabled_at IS NULL',
  );
  return rows[0]?.n ?? 0;
}

/**
 * Add an admin.
 *
 * `ON CONFLICT DO NOTHING` against the lower(email) unique index rather than a
 * prior lookup: two submissions of the same address arriving together would
 * both pass a check. Returns false when the address is taken — including when
 * it is taken by somebody stood down, who should be restored rather than
 * created again.
 */
export async function insertAdmin(
  tx: Queryable,
  account: { id: string; email: string; passwordHash: string },
): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO admin_accounts (id, email, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (lower(email)) DO NOTHING
     RETURNING id`,
    [account.id, account.email, account.passwordHash],
  );
  return rows.length === 1;
}

export async function findAdminById(
  tx: Queryable,
  adminId: string,
): Promise<AdminAccount | null> {
  const { rows } = await tx.query<AdminRow>(
    'SELECT id, email, disabled_at FROM admin_accounts WHERE id = $1',
    [adminId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { id: row.id, email: row.email, disabledAt: toDate(row.disabled_at) };
}

/**
 * Stand an admin down, and end every session they hold.
 *
 * `loadAdminSession` already refuses a disabled account, so the delete is not
 * what makes revocation immediate — it is what stops the rows outliving the
 * access they represent. Both in one call so there is no window where one has
 * happened and the other has not.
 */
export async function disableAdmin(tx: Queryable, adminId: string): Promise<void> {
  await tx.query(
    'UPDATE admin_accounts SET disabled_at = now() WHERE id = $1 AND disabled_at IS NULL',
    [adminId],
  );
  await tx.query('DELETE FROM admin_sessions WHERE admin_id = $1', [adminId]);
}

/** Bring one back. They sign in again; the old sessions stay gone. */
export async function enableAdmin(tx: Queryable, adminId: string): Promise<void> {
  await tx.query('UPDATE admin_accounts SET disabled_at = NULL WHERE id = $1', [adminId]);
}

/**
 * End every session an admin holds except the one they are using.
 *
 * Called after a password change: the point of changing it is usually that
 * somebody else may have had it, and leaving their other sessions alive would
 * make the change cosmetic.
 */
export async function deleteOtherAdminSessions(
  tx: Queryable,
  adminId: string,
  keepTokenHash: string,
): Promise<void> {
  await tx.query('DELETE FROM admin_sessions WHERE admin_id = $1 AND id <> $2', [
    adminId,
    keepTokenHash,
  ]);
}

/**
 * End every session an admin holds.
 *
 * Used when another admin resets their password: the point of a reset is
 * usually that the account is out of the owner's control, and leaving the
 * existing sessions alive would make the reset cosmetic. `disableAdmin` does
 * the same thing for the same reason.
 */
export async function deleteAdminSessionsFor(tx: Queryable, adminId: string): Promise<void> {
  await tx.query('DELETE FROM admin_sessions WHERE admin_id = $1', [adminId]);
}
