/**
 * The isolation properties auth depends on.
 *
 * Written before the sign-in screens, because these are the assumptions
 * everything above them is built on, and because the last bug of this class
 * — FORCE ROW LEVEL SECURITY binding the table owner — was invisible for the
 * project's life. A fixture test would have proved nothing here; these run the
 * real policy engine as the real unprivileged role.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, ORG_A, ORG_B, type TestDatabase } from './testing/harness.js';

let harness: TestDatabase;

beforeEach(async () => {
  harness = await createTestDatabase();
});

afterEach(async () => {
  await harness.close();
});

describe('the tables that carry credentials', () => {
  it('are invisible to the tenant role, not merely empty to it', async () => {
    // app_credentials is protected this way already; sessions and
    // user_passwords must be too. A signed-in customer of the platform must
    // not be able to read another account's password hash or replay a session.
    for (const table of ['sessions', 'user_passwords']) {
      await expect(harness.db.query(`SELECT * FROM ${table}`)).rejects.toThrow(
        /permission denied/iu,
      );
    }
  });

  it('cannot be written to either', async () => {
    await expect(
      harness.db.query(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES ('x', 'user_a', now())",
      ),
    ).rejects.toThrow(/permission denied/iu);
  });
});

describe('reading your own memberships without a tenant context', () => {
  it('returns yours, and only yours', async () => {
    // This is the read that ESTABLISHES the tenant, so it cannot require one.
    const mine = await harness.asUser('user_a', async () =>
      harness.db.query<{ organisation_id: string }>('SELECT organisation_id FROM memberships'),
    );
    expect(mine.rows.map((r) => r.organisation_id)).toEqual([ORG_A]);

    const theirs = await harness.asUser('user_b', async () =>
      harness.db.query<{ organisation_id: string }>('SELECT organisation_id FROM memberships'),
    );
    expect(theirs.rows.map((r) => r.organisation_id)).toEqual([ORG_B]);
  });

  it('returns nothing when nobody is set', async () => {
    const rows = await harness.asNoTenant(async () =>
      harness.db.query('SELECT organisation_id FROM memberships'),
    );
    expect(rows.rows).toEqual([]);
  });

  it('returns nothing for a user who does not exist', async () => {
    const rows = await harness.asUser('nobody', async () =>
      harness.db.query('SELECT organisation_id FROM memberships'),
    );
    expect(rows.rows).toEqual([]);
  });

  it('opens NOTHING else — the context answers one question', async () => {
    // If setting app.user_id leaked tenant data, it would be a way around
    // every policy in the schema.
    await harness.asUser('user_a', async () => {
      for (const table of ['documents', 'facts', 'projects', 'applications',
                           'organisation_profiles', 'organisations']) {
        const { rows } = await harness.db.query(`SELECT * FROM ${table}`);
        expect(rows, table).toEqual([]);
      }
    });
  });

  it('does not let you write a membership for yourself into someone else', async () => {
    // SELECT-only policy: the tenant policy still governs writes.
    await harness.asUser('user_a', async () => {
      await expect(
        harness.db.query(
          `INSERT INTO memberships (id, organisation_id, user_id, role)
           VALUES ('m_x', $1, 'user_a', 'owner')`,
          [ORG_B],
        ),
      ).rejects.toThrow(/row-level security/iu);
    });
  });
});

describe('addresses', () => {
  it('cannot differ only by case', async () => {
    // Sign-in normalises before looking anyone up, so two such accounts would
    // make one unreachable — and which one would depend on row order.
    await harness.db.exec('RESET ROLE;');
    await expect(
      harness.db.query("INSERT INTO users (id, email) VALUES ('user_c', 'A@Example.org')"),
    ).rejects.toThrow(/duplicate key|unique/iu);
  });
});
