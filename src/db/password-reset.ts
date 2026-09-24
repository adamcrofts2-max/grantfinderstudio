/**
 * Password reset links. ADMIN scope throughout — see 0030.
 *
 * Only the SHA-256 of a link's token is stored. The decisions (how long a link
 * lasts, what a link looks like) live in `domain/auth/reset.ts`.
 */

import type { Queryable } from './client.js';

export async function createPasswordReset(
  tx: Queryable,
  reset: { id: string; userId: string; expiresAt: Date },
): Promise<void> {
  await tx.query(
    'INSERT INTO password_resets (id, user_id, expires_at) VALUES ($1, $2, $3)',
    [reset.id, reset.userId, reset.expiresAt.toISOString()],
  );
}

/**
 * Use a link, once.
 *
 * One conditional DELETE, so two clicks on the same link — or a click racing
 * a copy of it — cannot both succeed: whichever statement deletes the row gets
 * the account back, and the other gets nothing. An expired link returns
 * nothing too, whether or not the sweep has reached it yet.
 */
export async function claimPasswordReset(
  tx: Queryable,
  tokenHash: string,
  now: Date,
): Promise<string | null> {
  const { rows } = await tx.query<{ user_id: string }>(
    'DELETE FROM password_resets WHERE id = $1 AND expires_at > $2 RETURNING user_id',
    [tokenHash, now.toISOString()],
  );
  return rows[0]?.user_id ?? null;
}

/**
 * Every outstanding link for one account.
 *
 * Called once a password has been reset: a second email sitting in the inbox
 * must not work after the first one has been used, or whoever reads the inbox
 * later can undo the reset.
 */
export async function deleteResetsForUser(tx: Queryable, userId: string): Promise<void> {
  await tx.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
}

/** Drop lapsed links. Safe to run at any time. */
export async function sweepExpiredResets(tx: Queryable, now: Date): Promise<number> {
  const { rows } = await tx.query<{ id: string }>(
    'DELETE FROM password_resets WHERE expires_at <= $1 RETURNING id',
    [now.toISOString()],
  );
  return rows.length;
}
