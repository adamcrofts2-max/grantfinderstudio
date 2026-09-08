/**
 * The account and session queries, against a real Postgres.
 *
 * These run with the role RESET, because every table they touch is admin
 * scope — which is the point of them, and is proved separately in
 * `auth-rls.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createAccount,
  createSession,
  deleteExpiredSessions,
  deleteSession,
  deleteSessionsForMembership,
  deleteSessionsForUser,
  findAccountByEmail,
  loadSession,
  organisationsForUser,
  readStoredPassword,
  setPassword,
  setSessionOrganisation,
  touchSession,
} from './auth.js';
import { createTestDatabase, ORG_A, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;
let tx: Queryable;

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
  tx = harness.db as unknown as Queryable;
});

afterEach(async () => {
  await harness.close();
});

const HOUR = 60 * 60 * 1000;

describe('accounts', () => {
  it('round-trips an account and its password', async () => {
    await createAccount(tx, {
      id: 'u1', email: 'New.Person@Example.ORG', name: 'New Person', passwordHash: 'hash-1',
    });

    const found = await findAccountByEmail(tx, '  new.person@example.org ');
    expect(found).toEqual({ id: 'u1', email: 'new.person@example.org', name: 'New Person' });
    expect(await readStoredPassword(tx, 'u1')).toBe('hash-1');
  });

  it('finds an account however the address is typed', async () => {
    // Someone who signed up as Jo@ and returns as jo@ is the same person
    // having a bad morning.
    await createAccount(tx, { id: 'u1', email: 'jo@example.org', name: null, passwordHash: 'h' });
    expect((await findAccountByEmail(tx, 'JO@EXAMPLE.ORG'))?.id).toBe('u1');
  });

  it('is null for an address nobody holds', async () => {
    expect(await findAccountByEmail(tx, 'nobody@example.org')).toBeNull();
    expect(await readStoredPassword(tx, 'nobody')).toBeNull();
  });

  it('replaces a hash in place when the work factor is raised', async () => {
    await createAccount(tx, { id: 'u1', email: 'jo@example.org', name: null, passwordHash: 'old' });
    await setPassword(tx, 'u1', 'new');
    expect(await readStoredPassword(tx, 'u1')).toBe('new');
  });
});

describe('sessions', () => {
  const now = new Date('2026-09-08T12:00:00Z');

  async function session(overrides: { expiresAt?: Date; organisationId?: string | null } = {}) {
    await createSession(tx, {
      id: 'tokenhash',
      userId: 'user_a',
      // `??` would treat an explicitly passed null as absent.
      organisationId: 'organisationId' in overrides ? overrides.organisationId ?? null : ORG_A,
      expiresAt: overrides.expiresAt ?? new Date(now.getTime() + 24 * HOUR),
    });
  }

  it('resolves to the user and the organisation it was created with', async () => {
    await session();
    const loaded = await loadSession(tx, 'tokenhash', now);
    expect(loaded?.userId).toBe('user_a');
    expect(loaded?.organisationId).toBe(ORG_A);
  });

  it('is indistinguishable from missing once expired', async () => {
    // Enforced in the WHERE clause, so there is no branch anywhere that could
    // be written the wrong way round.
    await session({ expiresAt: new Date(now.getTime() - 1) });
    expect(await loadSession(tx, 'tokenhash', now)).toBeNull();
    expect(await loadSession(tx, 'no-such-hash', now)).toBeNull();
  });

  it('expires exactly at its expiry, not a moment after', async () => {
    await session({ expiresAt: now });
    expect(await loadSession(tx, 'tokenhash', now)).toBeNull();
  });

  it('can be extended so an active session does not lapse', async () => {
    await session({ expiresAt: new Date(now.getTime() + 1 * HOUR) });
    await touchSession(tx, 'tokenhash', new Date(now.getTime() + 72 * HOUR));
    const later = new Date(now.getTime() + 48 * HOUR);
    expect((await loadSession(tx, 'tokenhash', later))?.userId).toBe('user_a');
  });

  it('starts without an organisation and gains one at onboarding', async () => {
    await session({ organisationId: null });
    expect((await loadSession(tx, 'tokenhash', now))?.organisationId).toBeNull();
    await setSessionOrganisation(tx, 'tokenhash', ORG_A);
    expect((await loadSession(tx, 'tokenhash', now))?.organisationId).toBe(ORG_A);
  });

  it('stops working the moment it is deleted, not when the cookie is dropped', async () => {
    // Signing out has to invalidate the row: a copied cookie must stop working.
    await session();
    await deleteSession(tx, 'tokenhash');
    expect(await loadSession(tx, 'tokenhash', now)).toBeNull();
  });

  it('ends every session a person holds, for a password change', async () => {
    await session();
    await createSession(tx, {
      id: 'other', userId: 'user_a', organisationId: ORG_A,
      expiresAt: new Date(now.getTime() + 24 * HOUR),
    });
    await deleteSessionsForUser(tx, 'user_a');
    expect(await loadSession(tx, 'tokenhash', now)).toBeNull();
    expect(await loadSession(tx, 'other', now)).toBeNull();
  });

  it('ends sessions for a revoked membership, and no others', async () => {
    // The session captured its organisation at sign-in rather than
    // re-deriving it, so revocation has to reach in and delete.
    await session();
    await createSession(tx, {
      id: 'elsewhere', userId: 'user_a', organisationId: null,
      expiresAt: new Date(now.getTime() + 24 * HOUR),
    });
    await deleteSessionsForMembership(tx, 'user_a', ORG_A);
    expect(await loadSession(tx, 'tokenhash', now)).toBeNull();
    expect(await loadSession(tx, 'elsewhere', now)).not.toBeNull();
  });

  it('sweeps expired rows and leaves live ones', async () => {
    await session({ expiresAt: new Date(now.getTime() - 1) });
    await createSession(tx, {
      id: 'live', userId: 'user_a', organisationId: ORG_A,
      expiresAt: new Date(now.getTime() + 24 * HOUR),
    });
    expect(await deleteExpiredSessions(tx, now)).toBe(1);
    expect(await loadSession(tx, 'live', now)).not.toBeNull();
  });

  it('goes with the account when the account goes', async () => {
    await createAccount(tx, { id: 'u1', email: 'jo@example.org', name: null, passwordHash: 'h' });
    await createSession(tx, {
      id: 'theirs', userId: 'u1', organisationId: null,
      expiresAt: new Date(now.getTime() + 24 * HOUR),
    });
    await harness.db.query("DELETE FROM users WHERE id = 'u1'");
    expect(await loadSession(tx, 'theirs', now)).toBeNull();
  });
});

describe('organisationsForUser', () => {
  it('lists the memberships the person holds', async () => {
    const mine = await harness.asUser('user_a', () => organisationsForUser(tx, 'user_a'));
    expect(mine).toEqual([{ organisationId: ORG_A, role: 'owner' }]);
  });
});
