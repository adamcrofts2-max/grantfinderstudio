/**
 * Remembering failed sign-in attempts.
 *
 * ADMIN path throughout — see 0008. The decisions live in
 * `domain/auth/throttle.ts`; this file only reads and writes them.
 */

import { createHash } from 'node:crypto';

import type { Queryable } from './client.js';
import type { AttemptRecord } from '../domain/auth/throttle.js';

export type Axis = 'address' | 'origin';

/**
 * The key a bucket is stored under.
 *
 * Hashed, so the table is not a plaintext list of who has been trying to sign
 * in and from where. The axis is inside the hash rather than beside it, so an
 * address and an origin that happened to be the same string could never share
 * a bucket.
 */
export function attemptKey(axis: Axis, value: string): string {
  return createHash('sha256').update(`${axis}:${value}`, 'utf8').digest('base64url');
}

export async function readAttempt(
  tx: Queryable,
  key: string,
): Promise<AttemptRecord | null> {
  const { rows } = await tx.query<{ attempts: number; window_started_at: string | Date }>(
    'SELECT attempts, window_started_at FROM auth_attempts WHERE id = $1',
    [key],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { attempts: row.attempts, windowStartedAt: new Date(row.window_started_at) };
}

export async function writeAttempt(
  tx: Queryable,
  key: string,
  record: AttemptRecord,
): Promise<void> {
  await tx.query(
    `INSERT INTO auth_attempts (id, attempts, window_started_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET attempts = $2, window_started_at = $3`,
    [key, record.attempts, record.windowStartedAt.toISOString()],
  );
}

/** Forget a bucket. Used on a successful sign-in. */
export async function clearAttempt(tx: Queryable, key: string): Promise<void> {
  await tx.query('DELETE FROM auth_attempts WHERE id = $1', [key]);
}

/** Drop buckets whose window has long gone. Safe to run at any time. */
export async function sweepAttempts(
  tx: Queryable,
  before: Date,
): Promise<number> {
  const { rows } = await tx.query<{ id: string }>(
    'DELETE FROM auth_attempts WHERE window_started_at < $1 RETURNING id',
    [before.toISOString()],
  );
  return rows.length;
}
