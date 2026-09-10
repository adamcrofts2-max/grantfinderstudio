/**
 * The operator's sandbox, against the real schema.
 *
 * The tests that matter here are not about what the sandbox can do. They are
 * about what it cannot be turned into: the whole reason this is safe is that
 * no function takes an organisation, so the organisation is a pure function of
 * the admin id. If that ever stops being true these fail, which is the point —
 * the guarantee should be a thing the suite defends, not a paragraph in a
 * comment.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deleteSandboxOrganisation,
  ensureSandboxUser,
  isSandboxUser,
  sandboxEmail,
  sandboxOrganisationId,
  sandboxUserId,
} from './sandbox.js';
import { ensureOrganisation } from './onboarding.js';
import { readAccountSummary, readAccounts } from './platform.js';
import { createTestDatabase, ORG_A, type TestDatabase } from './testing/harness.js';
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

describe('where a sandbox organisation comes from', () => {
  it('is derived from the admin id and nothing else', () => {
    // Called twice with the same admin, it is the same organisation. There is
    // no input that could make it a different one.
    expect(sandboxOrganisationId('admin-1')).toBe(sandboxOrganisationId('admin-1'));
    expect(sandboxOrganisationId('admin-1')).not.toBe(sandboxOrganisationId('admin-2'));
  });

  it('cannot collide with a real organisation id', () => {
    expect(sandboxOrganisationId('admin-1')).not.toBe(ORG_A);
    expect(sandboxOrganisationId(ORG_A)).not.toBe(ORG_A);
  });

  it('uses an address that can never be registered or receive mail', () => {
    // RFC 2606 reserves .invalid. This is a label, not a mailbox, and it must
    // not be able to collide with a real signup.
    expect(sandboxEmail('admin-1')).toMatch(/@grantfinderstudio\.invalid$/u);
  });
});

describe('the sandbox account', () => {
  it('is created once and is idempotent', async () => {
    const first = await ensureSandboxUser(tx(), 'admin-1');
    const second = await ensureSandboxUser(tx(), 'admin-1');
    expect(second).toEqual(first);

    const { rows } = await harness.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM users WHERE sandbox_of_admin = $1',
      ['admin-1'],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('has no password, so nobody can sign in as it', async () => {
    // Not a rule the code applies — an absent row. Sign-in reads
    // user_passwords, so there is no password that works, for anybody.
    const account = await ensureSandboxUser(tx(), 'admin-1');
    const { rows } = await harness.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM user_passwords WHERE user_id = $1',
      [account.userId],
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('is one per admin, enforced by the database rather than by a check', async () => {
    // Two clicks arriving together would both pass a count checked
    // beforehand, and the second organisation would be unreachable for ever.
    await ensureSandboxUser(tx(), 'admin-1');
    await expect(
      harness.db.query(
        `INSERT INTO users (id, email, name, sandbox_of_admin) VALUES ($1, $2, $3, $4)`,
        ['other_id', 'other@example.invalid', 'Sandbox', 'admin-1'],
      ),
    ).rejects.toThrow(/unique|duplicate/iu);
  });

  it('reports whether an account is a sandbox', async () => {
    await ensureSandboxUser(tx(), 'admin-1');
    expect(await isSandboxUser(tx(), sandboxUserId('admin-1'))).toBe(true);
    expect(await isSandboxUser(tx(), 'user_a')).toBe(false);
    expect(await isSandboxUser(tx(), 'nobody')).toBe(false);
  });
});

describe('what the console reports', () => {
  it('leaves sandboxes out of the account count and the account list', async () => {
    const before = await readAccountSummary(tx());
    await ensureSandboxUser(tx(), 'admin-1');
    const after = await readAccountSummary(tx());

    // The first number anybody looks at after a launch. It must not include
    // the operator's own practice runs.
    expect(after.total).toBe(before.total);

    const listed = await readAccounts(tx());
    expect(listed.map((row) => row.id)).not.toContain(sandboxUserId('admin-1'));
  });
});

describe('emptying a sandbox', () => {
  it('deletes only the organisation the tenant context names', async () => {
    const account = await ensureSandboxUser(tx(), 'admin-1');
    await harness.db.exec(
      `BEGIN;
       SELECT set_config('app.organisation_id', '${account.organisationId}', true);
       SET LOCAL ROLE app_user;`,
    );
    await ensureOrganisation(tx(), account.organisationId, account.userId, 'Your sandbox');
    await harness.db.exec('COMMIT;');
    await harness.db.exec('RESET ROLE;');

    // Both organisations exist; the delete runs in the sandbox's context.
    await harness.db.exec(
      `BEGIN;
       SELECT set_config('app.organisation_id', '${account.organisationId}', true);
       SET LOCAL ROLE app_user;`,
    );
    await deleteSandboxOrganisation(tx());
    await harness.db.exec('COMMIT;');
    await harness.db.exec('RESET ROLE;');

    const { rows } = await harness.db.query<{ id: string }>('SELECT id FROM organisations');
    const ids = rows.map((row) => row.id);
    expect(ids).not.toContain(account.organisationId);
    // The customer's organisation is untouched, and could not have been
    // reached: the tenant policy makes it invisible in that context.
    expect(ids).toContain(ORG_A);
  });

  it('keeps the account, so the next click rebuilds rather than races', async () => {
    const account = await ensureSandboxUser(tx(), 'admin-1');
    await harness.db.exec(
      `BEGIN;
       SELECT set_config('app.organisation_id', '${account.organisationId}', true);
       SET LOCAL ROLE app_user;`,
    );
    await ensureOrganisation(tx(), account.organisationId, account.userId, 'Your sandbox');
    await deleteSandboxOrganisation(tx());
    await harness.db.exec('COMMIT;');
    await harness.db.exec('RESET ROLE;');

    expect(await isSandboxUser(tx(), account.userId)).toBe(true);
  });
});
