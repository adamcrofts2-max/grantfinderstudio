/**
 * Reading somebody's role — the first thing in the product that ever did.
 *
 * The permission matrix in `src/auth/rbac.ts` existed from the start and
 * nothing consulted it. These tests pin the read it now depends on, including
 * the property that makes it safe on the tenant connection: it can only ever
 * report a role in the organisation in context.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, ORG_A, ORG_B, type TestDatabase } from './testing/harness.js';
import { roleOf } from './membership.js';

let t: TestDatabase;

beforeEach(async () => {
  t = await createTestDatabase();
});

afterEach(async () => {
  await t.close();
});

describe('roleOf', () => {
  it('reads the role somebody holds in this organisation', async () => {
    expect(await t.asTenant(ORG_A, () => roleOf(t.db, 'user_a'))).toBe('owner');
  });

  it('reads a lesser role as itself, not as the owner it used to be treated as', async () => {
    // The world an invite flow creates: a second member who is not an owner.
    await t.db.exec(`RESET ROLE;
      INSERT INTO memberships (id, organisation_id, user_id, role)
      VALUES ('m_viewer', '${ORG_A}', 'user_b', 'viewer');
      SET ROLE app_user;`);
    expect(await t.asTenant(ORG_A, () => roleOf(t.db, 'user_b'))).toBe('viewer');
  });

  it('reports no role for somebody who is not in this organisation', async () => {
    expect(await t.asTenant(ORG_A, () => roleOf(t.db, 'user_b'))).toBeNull();
  });

  it('cannot report a role held in a different organisation', async () => {
    // user_a owns ORG_A. Asked from inside ORG_B, row-level security hides
    // that membership, and the answer is "nothing here" — never "owner".
    expect(await t.asTenant(ORG_B, () => roleOf(t.db, 'user_a'))).toBeNull();
  });
});
