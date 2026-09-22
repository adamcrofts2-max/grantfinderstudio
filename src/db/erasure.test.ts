/**
 * Erasure and export, against real PostgreSQL (PGlite).
 *
 * The properties worth proving are the ones a person is trusting when they
 * press the button: that everything of theirs goes, that nothing of anybody
 * else's does, and that what they are handed first is actually all of it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, ORG_A, ORG_B, type TestDatabase } from './testing/harness.js';
import { eraseOrganisation, eraseOrphanedUsers, membersOf } from './erasure.js';
import {
  countEverything,
  exportOrganisation,
  namesFor,
  seatsIn,
  withMembers,
} from './export.js';
import { PRIVACY_RECORD } from '../domain/privacy/record.js';

let t: TestDatabase;

beforeEach(async () => {
  t = await createTestDatabase();
});

afterEach(async () => {
  await t.close();
});

/** Counted as superuser, so row-level security cannot hide a survivor. */
async function rowsLeftFor(organisationId: string): Promise<Record<string, number>> {
  await t.db.exec('RESET ROLE;');
  const left: Record<string, number> = {};
  for (const held of PRIVACY_RECORD) {
    if (held.subject !== 'organisation' || held.table === 'organisations') continue;
    const { rows } = await t.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${held.table} WHERE organisation_id = $1`,
      [organisationId],
    );
    const n = Number(rows[0]?.n ?? '0');
    if (n > 0) left[held.table] = n;
  }
  await t.db.exec('SET ROLE app_user;');
  return left;
}

describe('eraseOrganisation', () => {
  it('takes every tenant table with it', async () => {
    // Something in a handful of tables first, so the cascade has work to do.
    await t.db.exec(`RESET ROLE;
      INSERT INTO application_questions
        (id, organisation_id, application_id, position, question)
      VALUES ('eq1', '${ORG_A}', 'app_a', 1, 'What will you do?');
      INSERT INTO answers (id, organisation_id, question_id, content, word_count)
      VALUES ('ea1', '${ORG_A}', 'eq1', 'Something we wrote.', 3);
      INSERT INTO audit_logs (id, organisation_id, action, entity_type)
      VALUES ('eaud1', '${ORG_A}', 'answer.saved', 'answer');
      SET ROLE app_user;`);

    expect(await rowsLeftFor(ORG_A)).not.toEqual({});

    const gone = await t.asTenant(ORG_A, () => eraseOrganisation(t.db, ORG_A));
    expect(gone).toBe(true);
    expect(await rowsLeftFor(ORG_A)).toEqual({});
  });

  it('leaves the other organisation untouched', async () => {
    const before = await rowsLeftFor(ORG_B);
    await t.asTenant(ORG_A, () => eraseOrganisation(t.db, ORG_A));
    expect(await rowsLeftFor(ORG_B)).toEqual(before);

    await t.db.exec('RESET ROLE;');
    const { rows } = await t.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM organisations WHERE id = $1`,
      [ORG_B],
    );
    expect(rows[0]?.n).toBe('1');
    await t.db.exec('SET ROLE app_user;');
  });

  it('cannot be aimed at somebody else’s organisation', async () => {
    const erased = await t.asTenant(ORG_A, () => eraseOrganisation(t.db, ORG_B));
    expect(erased).toBe(false);

    await t.db.exec('RESET ROLE;');
    const { rows } = await t.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM organisations WHERE id = $1`,
      [ORG_B],
    );
    expect(rows[0]?.n).toBe('1');
    await t.db.exec('SET ROLE app_user;');
  });

  it('reports nothing deleted the second time', async () => {
    await t.asTenant(ORG_A, () => eraseOrganisation(t.db, ORG_A));
    expect(await t.asTenant(ORG_A, () => eraseOrganisation(t.db, ORG_A))).toBe(false);
  });
});

describe('eraseOrphanedUsers', () => {
  it('removes a sign-in left with no organisation, and its password with it', async () => {
    const members = await t.asTenant(ORG_A, () => membersOf(t.db));
    expect(members.length).toBeGreaterThan(0);

    await t.asTenant(ORG_A, () => eraseOrganisation(t.db, ORG_A));

    await t.db.exec('RESET ROLE;');
    const removed = await eraseOrphanedUsers(t.db, members);
    expect(removed).toEqual(members);

    const { rows } = await t.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM users WHERE id = ANY($1::text[])`,
      [members],
    );
    expect(rows[0]?.n).toBe('0');
    await t.db.exec('SET ROLE app_user;');
  });

  it('keeps somebody who still belongs somewhere else', async () => {
    // One person in both organisations. Erasing the first must not sign them
    // out of the second.
    const [someone] = await t.asTenant(ORG_A, () => membersOf(t.db));
    if (someone === undefined) throw new Error('fixture has no members');

    await t.db.exec(`RESET ROLE;
      INSERT INTO memberships (id, organisation_id, user_id, role)
      VALUES ('m_both', '${ORG_B}', '${someone}', 'editor');
      SET ROLE app_user;`);

    await t.asTenant(ORG_A, () => eraseOrganisation(t.db, ORG_A));
    await t.db.exec('RESET ROLE;');
    expect(await eraseOrphanedUsers(t.db, [someone])).toEqual([]);

    const { rows } = await t.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM users WHERE id = $1`,
      [someone],
    );
    expect(rows[0]?.n).toBe('1');
    await t.db.exec('SET ROLE app_user;');
  });

  it('does nothing when handed nobody', async () => {
    await t.db.exec('RESET ROLE;');
    expect(await eraseOrphanedUsers(t.db, [])).toEqual([]);
    await t.db.exec('SET ROLE app_user;');
  });
});

describe('exportOrganisation', () => {
  it('covers every table the privacy notice says it holds', async () => {
    const dump = await t.asTenant(ORG_A, () => exportOrganisation(t.db, ORG_A));
    const promised = PRIVACY_RECORD.filter((h) => h.subject === 'organisation').map(
      (h) => h.table,
    );
    expect(Object.keys(dump.data).toSorted()).toEqual(promised.toSorted());
  });

  it('explains what each table is, so the file reads without the schema', async () => {
    const dump = await t.asTenant(ORG_A, () => exportOrganisation(t.db, ORG_A));
    for (const table of Object.keys(dump.data)) {
      expect(dump.legend[table]?.label, `${table} has no legend`).toBeTruthy();
    }
  });

  it('carries this organisation’s rows and not the other’s', async () => {
    const dump = await t.asTenant(ORG_A, () => exportOrganisation(t.db, ORG_A));
    const ids = (dump.data['applications'] ?? []).map((row) => (row as { id: string }).id);
    expect(ids).toContain('app_a');
    expect(ids).not.toContain('app_b');
  });

  it('names the members by joining two connections, never one query', async () => {
    // The tenant reads the seats; the operator reads the addresses. 0009
    // revoked the tenant's SELECT on `users` deliberately, and an export is
    // not a reason to give it back.
    const dump = await t.asTenant(ORG_A, () => exportOrganisation(t.db, ORG_A));
    const seats = await t.asTenant(ORG_A, () => seatsIn(t.db));
    expect(seats.length).toBeGreaterThan(0);

    await t.db.exec('RESET ROLE;');
    const names = await namesFor(t.db, seats.map((s) => s.userId));
    await t.db.exec('SET ROLE app_user;');

    const full = withMembers(dump, seats, names);
    expect(full.members.length).toBe(seats.length);
    expect(full.members[0]?.email).toMatch(/@/u);
    expect(JSON.stringify(full)).not.toMatch(/password/iu);
  });

  it('refuses to read the addresses on the tenant connection', async () => {
    // The revoke from 0009, asserted. If this ever starts passing, the
    // platform's whole customer list is readable from a tenant query again.
    await expect(t.asTenant(ORG_A, () => namesFor(t.db, ['whoever']))).rejects.toThrow(
      /permission denied/iu,
    );
  });

  it('says so rather than inventing one when an address is gone', () => {
    const joined = withMembers(
      { takenAt: 'now', organisationId: ORG_A, data: {}, legend: {} },
      [{ userId: 'vanished', role: 'owner', joined: '2026-01-01' }],
      new Map(),
    );
    expect(joined.members[0]?.email).toBe('(address no longer held)');
  });

  it('counts what a delete would remove, and says nothing about empty tables', async () => {
    const counts = await t.asTenant(ORG_A, () => countEverything(t.db));
    expect(counts.length).toBeGreaterThan(0);
    for (const line of counts) expect(line.rows).toBeGreaterThan(0);
    // The counting noun, not the heading: this feeds "3 applications" in the
    // delete confirmation.
    expect(counts.some((c) => c.label === 'applications')).toBe(true);
    expect(counts.every((c) => !c.label.startsWith('Your'))).toBe(true);
  });
});
