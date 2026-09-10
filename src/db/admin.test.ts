/**
 * Admin accounts and admin sessions, against the real schema.
 *
 * The claim is the part worth testing hardest: it is the only way an admin
 * ever comes into existence, and a second one slipping through would be a
 * second key to the console that nobody knows about.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  claimFirstAdmin,
  countAdmins,
  countEnabledAdmins,
  deleteAdminSessionsFor,
  deleteOtherAdminSessions,
  disableAdmin,
  enableAdmin,
  findAdminById,
  insertAdmin,
  listAdmins,
  createAdminSession,
  deleteAdminSession,
  findAdminByEmail,
  loadAdminSession,
  readAdminPassword,
  recordAdminSignIn,
  setAdminPassword,
  sweepAdminSessions,
} from './admin.js';
import { createTestDatabase, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;
const tx = (): Queryable => harness.db as unknown as Queryable;

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
});

afterEach(async () => {
  await harness.close();
});

const soon = () => new Date(Date.now() + 60_000);

describe('claiming the first admin', () => {
  it('starts with none', async () => {
    expect(await countAdmins(tx())).toBe(0);
  });

  it('creates one', async () => {
    const claimed = await claimFirstAdmin(tx(), {
      id: 'a1',
      email: 'ops@example.org',
      passwordHash: 'hash',
    });
    expect(claimed).toBe(true);
    expect(await countAdmins(tx())).toBe(1);
  });

  it('refuses the second, and says so rather than throwing', async () => {
    await claimFirstAdmin(tx(), { id: 'a1', email: 'ops@example.org', passwordHash: 'h' });
    const second = await claimFirstAdmin(tx(), {
      id: 'a2',
      email: 'someone@example.org',
      passwordHash: 'h',
    });
    expect(second).toBe(false);
    expect(await countAdmins(tx())).toBe(1);
  });

  it('closes the door in the statement, not in a check beforehand', async () => {
    // Two claims arriving together both pass a prior count. The guard has to
    // be inside the INSERT or there is a race that hands out a second key.
    const results = await Promise.all([
      claimFirstAdmin(tx(), { id: 'r1', email: 'one@example.org', passwordHash: 'h' }),
      claimFirstAdmin(tx(), { id: 'r2', email: 'two@example.org', passwordHash: 'h' }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await countAdmins(tx())).toBe(1);
  });
});

describe('finding an admin', () => {
  beforeEach(async () => {
    await claimFirstAdmin(tx(), { id: 'a1', email: 'Ops@Example.org', passwordHash: 'h' });
  });

  it('matches the address whatever case it is typed in', async () => {
    expect((await findAdminByEmail(tx(), 'ops@example.org'))?.id).toBe('a1');
    expect((await findAdminByEmail(tx(), '  OPS@EXAMPLE.ORG '))?.id).toBe('a1');
  });

  it('gives back null for an address with no admin', async () => {
    expect(await findAdminByEmail(tx(), 'nobody@example.org')).toBeNull();
  });

  it('round-trips the password hash', async () => {
    await setAdminPassword(tx(), 'a1', 'a-new-hash');
    expect(await readAdminPassword(tx(), 'a1')).toBe('a-new-hash');
  });

  it('records a sign-in', async () => {
    await recordAdminSignIn(tx(), 'a1');
    const { rows } = await harness.db.query<{ last_signed_in_at: unknown }>(
      'SELECT last_signed_in_at FROM admin_accounts WHERE id = $1',
      ['a1'],
    );
    expect(rows[0]?.last_signed_in_at).not.toBeNull();
  });
});

describe('admin sessions', () => {
  beforeEach(async () => {
    await claimFirstAdmin(tx(), { id: 'a1', email: 'ops@example.org', passwordHash: 'h' });
  });

  it('loads by token hash', async () => {
    await createAdminSession(tx(), { id: 'hash1', adminId: 'a1', expiresAt: soon() });
    const session = await loadAdminSession(tx(), 'hash1');
    expect(session?.adminId).toBe('a1');
    expect(session?.email).toBe('ops@example.org');
  });

  it('is nothing without the right hash', async () => {
    await createAdminSession(tx(), { id: 'hash1', adminId: 'a1', expiresAt: soon() });
    expect(await loadAdminSession(tx(), 'not-the-hash')).toBeNull();
  });

  it('stops working the moment the admin is disabled', async () => {
    // Not at expiry. Revocation that waits eight hours is not revocation.
    await createAdminSession(tx(), { id: 'hash1', adminId: 'a1', expiresAt: soon() });
    await harness.db.query('UPDATE admin_accounts SET disabled_at = now() WHERE id = $1', ['a1']);
    expect(await loadAdminSession(tx(), 'hash1')).toBeNull();
  });

  it('is deleted rather than merely ignored', async () => {
    await createAdminSession(tx(), { id: 'hash1', adminId: 'a1', expiresAt: soon() });
    await deleteAdminSession(tx(), 'hash1');
    expect(await loadAdminSession(tx(), 'hash1')).toBeNull();
  });

  it('sweeps the expired and leaves the live', async () => {
    await createAdminSession(tx(), {
      id: 'old',
      adminId: 'a1',
      expiresAt: new Date(Date.now() - 60_000),
    });
    await createAdminSession(tx(), { id: 'live', adminId: 'a1', expiresAt: soon() });
    await sweepAdminSessions(tx());
    expect(await loadAdminSession(tx(), 'old')).toBeNull();
    expect(await loadAdminSession(tx(), 'live')).not.toBeNull();
  });

  it('goes with the account when it is deleted', async () => {
    await createAdminSession(tx(), { id: 'hash1', adminId: 'a1', expiresAt: soon() });
    await harness.db.query('DELETE FROM admin_accounts WHERE id = $1', ['a1']);
    expect(await loadAdminSession(tx(), 'hash1')).toBeNull();
  });
});


describe('the roster', () => {
  beforeEach(async () => {
    await claimFirstAdmin(tx(), { id: 'a1', email: 'first@example.org', passwordHash: 'h' });
  });

  it('adds a second admin', async () => {
    expect(
      await insertAdmin(tx(), { id: 'a2', email: 'second@example.org', passwordHash: 'h' }),
    ).toBe(true);
    expect(await countAdmins(tx())).toBe(2);
  });

  it('refuses an address that is already an admin, whatever case it is typed in', async () => {
    // Not an exception to catch: the caller has something useful to say about
    // it, including "they were stood down — bring them back instead".
    expect(
      await insertAdmin(tx(), { id: 'a2', email: 'FIRST@example.ORG', passwordHash: 'h' }),
    ).toBe(false);
    expect(await countAdmins(tx())).toBe(1);
  });

  it('lists them oldest first, with their state', async () => {
    await insertAdmin(tx(), { id: 'a2', email: 'second@example.org', passwordHash: 'h' });
    await disableAdmin(tx(), 'a2');
    const admins = await listAdmins(tx());
    expect(admins.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(admins[0]?.disabledAt).toBeNull();
    expect(admins[1]?.disabledAt).toBeInstanceOf(Date);
  });

  it('counts only the admins who can actually sign in', async () => {
    await insertAdmin(tx(), { id: 'a2', email: 'second@example.org', passwordHash: 'h' });
    expect(await countEnabledAdmins(tx())).toBe(2);
    await disableAdmin(tx(), 'a2');
    expect(await countEnabledAdmins(tx())).toBe(1);
    expect(await countAdmins(tx())).toBe(2);
  });

  it('deletes the sessions of an admin it stands down', async () => {
    await insertAdmin(tx(), { id: 'a2', email: 'second@example.org', passwordHash: 'h' });
    await createAdminSession(tx(), { id: 'theirs', adminId: 'a2', expiresAt: soon() });
    await createAdminSession(tx(), { id: 'mine', adminId: 'a1', expiresAt: soon() });

    await disableAdmin(tx(), 'a2');

    expect(await loadAdminSession(tx(), 'theirs')).toBeNull();
    expect(await loadAdminSession(tx(), 'mine')).not.toBeNull();
  });

  it('brings one back without giving the old sessions back', async () => {
    await insertAdmin(tx(), { id: 'a2', email: 'second@example.org', passwordHash: 'h' });
    await createAdminSession(tx(), { id: 'theirs', adminId: 'a2', expiresAt: soon() });
    await disableAdmin(tx(), 'a2');
    await enableAdmin(tx(), 'a2');

    expect((await findAdminById(tx(), 'a2'))?.disabledAt).toBeNull();
    expect(await loadAdminSession(tx(), 'theirs')).toBeNull();
  });

  it('keeps a stood-down account rather than deleting it', async () => {
    // Whatever they signed should still have a name against it.
    await insertAdmin(tx(), { id: 'a2', email: 'second@example.org', passwordHash: 'h' });
    await disableAdmin(tx(), 'a2');
    expect(await findAdminById(tx(), 'a2')).not.toBeNull();
  });

  it('leaves the session you are using when you change your password', async () => {
    await createAdminSession(tx(), { id: 'this-browser', adminId: 'a1', expiresAt: soon() });
    await createAdminSession(tx(), { id: 'somewhere-else', adminId: 'a1', expiresAt: soon() });

    await deleteOtherAdminSessions(tx(), 'a1', 'this-browser');

    expect(await loadAdminSession(tx(), 'this-browser')).not.toBeNull();
    expect(await loadAdminSession(tx(), 'somewhere-else')).toBeNull();
  });
});


describe('recovering a forgotten console password', () => {
  beforeEach(async () => {
    await claimFirstAdmin(tx(), { id: 'a1', email: 'first@example.org', passwordHash: 'h1' });
    await insertAdmin(tx(), { id: 'a2', email: 'second@example.org', passwordHash: 'h2' });
  });

  it('lets one admin replace another password and signs them out everywhere', async () => {
    // The console's only recovery path: no reset email exists by design, and
    // the claim route closed on the first admin.
    await createAdminSession(tx(), { id: 'theirs', adminId: 'a2', expiresAt: soon() });
    await createAdminSession(tx(), { id: 'mine', adminId: 'a1', expiresAt: soon() });

    await setAdminPassword(tx(), 'a2', 'h2-new');
    await deleteAdminSessionsFor(tx(), 'a2');

    expect(await readAdminPassword(tx(), 'a2')).toBe('h2-new');
    // Cosmetic otherwise: the usual reason to reset a password is that the
    // account is out of its owner's control.
    expect(await loadAdminSession(tx(), 'theirs')).toBeNull();
    expect(await loadAdminSession(tx(), 'mine')).not.toBeNull();
  });

  it('leaves the other admin able to sign in', async () => {
    await deleteAdminSessionsFor(tx(), 'a2');
    expect(await readAdminPassword(tx(), 'a1')).toBe('h1');
    expect((await findAdminById(tx(), 'a1'))?.disabledAt).toBeNull();
  });
});
