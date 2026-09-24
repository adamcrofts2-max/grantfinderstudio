/**
 * Reset links against a real Postgres. Admin scope, so the role is RESET —
 * that the tenant roles cannot reach the table is `operator-scope.test.ts`'s
 * and `auth-rls.test.ts`'s job.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAccount } from './auth.js';
import {
  claimPasswordReset,
  createPasswordReset,
  deleteResetsForUser,
  sweepExpiredResets,
} from './password-reset.js';
import { createTestDatabase, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;
let tx: Queryable;

const NOW = new Date('2026-09-24T10:00:00Z');
const LATER = new Date('2026-09-24T10:30:00Z');

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
  tx = harness.db as unknown as Queryable;
  await createAccount(tx, { id: 'reset_u1', email: 'one@example.org', name: null, passwordHash: 'h1' });
  await createAccount(tx, { id: 'reset_u2', email: 'two@example.org', name: null, passwordHash: 'h2' });
});

afterEach(async () => {
  await harness.close();
});

describe('claiming a reset link', () => {
  it('works once', async () => {
    await createPasswordReset(tx, { id: 'hash-a', userId: 'reset_u1', expiresAt: LATER });
    expect(await claimPasswordReset(tx, 'hash-a', NOW)).toBe('reset_u1');
    expect(await claimPasswordReset(tx, 'hash-a', NOW)).toBeNull();
  });

  it('does not work once it has expired, swept or not', async () => {
    await createPasswordReset(tx, { id: 'hash-b', userId: 'reset_u1', expiresAt: LATER });
    expect(await claimPasswordReset(tx, 'hash-b', LATER)).toBeNull();
  });

  it('does not work for a link that was never made', async () => {
    expect(await claimPasswordReset(tx, 'made-up', NOW)).toBeNull();
  });
});

describe('clearing links', () => {
  it('removes every link for one account and leaves everybody else’s', async () => {
    await createPasswordReset(tx, { id: 'hash-1', userId: 'reset_u1', expiresAt: LATER });
    await createPasswordReset(tx, { id: 'hash-2', userId: 'reset_u1', expiresAt: LATER });
    await createPasswordReset(tx, { id: 'hash-3', userId: 'reset_u2', expiresAt: LATER });
    await deleteResetsForUser(tx, 'reset_u1');
    expect(await claimPasswordReset(tx, 'hash-2', NOW)).toBeNull();
    expect(await claimPasswordReset(tx, 'hash-3', NOW)).toBe('reset_u2');
  });

  it('sweeps only lapsed links', async () => {
    await createPasswordReset(tx, { id: 'old', userId: 'reset_u1', expiresAt: NOW });
    await createPasswordReset(tx, { id: 'new', userId: 'reset_u1', expiresAt: LATER });
    expect(await sweepExpiredResets(tx, NOW)).toBe(1);
    expect(await claimPasswordReset(tx, 'new', NOW)).toBe('reset_u1');
  });

  it('goes with the account', async () => {
    await createPasswordReset(tx, { id: 'hash-x', userId: 'reset_u2', expiresAt: LATER });
    await tx.query("DELETE FROM users WHERE id = 'reset_u2'");
    const { rows } = await tx.query('SELECT id FROM password_resets');
    expect(rows).toEqual([]);
  });
});
