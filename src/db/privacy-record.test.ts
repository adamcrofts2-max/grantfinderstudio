/**
 * The privacy notice, checked against the database it describes.
 *
 * A notice written by hand is true on the day it is written. This is the part
 * that keeps it true: the live schema is asked what tables exist, and a table
 * nobody has classified fails the build. Adding a table therefore forces a
 * decision about what it holds and how long it stays, at the moment somebody
 * who knows the answer is looking at it.
 *
 * The cascade check is the one that matters most. "Delete everything" is only
 * a promise worth making if every table carrying an organisation's data goes
 * with the organisation row, and that is a property of the foreign keys, not
 * of the delete statement.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from './testing/harness.js';
import {
  classifiedTables,
  NOT_ABOUT_YOU,
  PRIVACY_RECORD,
} from '../domain/privacy/record.js';

let t: TestDatabase;

beforeEach(async () => {
  t = await createTestDatabase();
  await t.db.exec('RESET ROLE;');
});

afterEach(async () => {
  await t.close();
});

async function tablesInSchema(): Promise<string[]> {
  const { rows } = await t.db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name);
}

describe('the privacy record against the real schema', () => {
  it('classifies every table that exists', async () => {
    const classified = classifiedTables();
    const unclassified = (await tablesInSchema()).filter((name) => !classified.has(name));
    expect(
      unclassified,
      `These tables are in the database and in neither list in src/domain/privacy/record.ts. ` +
        `Say what each holds and how long it stays, or add it to NOT_ABOUT_YOU with a reason: ` +
        unclassified.join(', '),
    ).toEqual([]);
  });

  it('describes no table that has since been dropped', async () => {
    // `schema_migrations` is created by the migration RUNNER, not by a
    // migration, so it is absent from a database the harness built by
    // applying the files directly. It exists in every real deployment, which
    // is why it is classified.
    const runnerMade = new Set(['schema_migrations']);
    const live = new Set(await tablesInSchema());
    const ghosts = [...classifiedTables()].filter(
      (name) => !live.has(name) && !runnerMade.has(name),
    );
    expect(ghosts, `The notice describes tables that no longer exist: ${ghosts.join(', ')}`).toEqual(
      [],
    );
  });

  it('stores no address, device or location anywhere', async () => {
    // The notice says there is no IP address in the schema. This is that
    // sentence, asserted rather than believed.
    const { rows } = await t.db.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (column_name ~ '(^|_)(ip|ip_address|remote_addr|user_agent|latitude|longitude)($|_)')`,
    );
    expect(
      rows.map((r) => `${r.table_name}.${r.column_name}`),
      'A column that looks like an address or a device has appeared. The notice says there is none.',
    ).toEqual([]);
  });

  it('takes every scrap of an organisation’s data with the organisation', async () => {
    // The erasure promise, proved from the foreign keys rather than from the
    // delete statement. A table whose organisation_id does not cascade would
    // survive the delete and either orphan itself or block it.
    const orgTables = PRIVACY_RECORD.filter((held) => held.subject === 'organisation').map(
      (held) => held.table,
    );

    const { rows } = await t.db.query<{ table_name: string; delete_rule: string }>(
      `SELECT tc.table_name, rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_name = tc.constraint_name
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = 'organisations'
          AND kcu.column_name = 'organisation_id'`,
    );
    const cascades = new Map(rows.map((r) => [r.table_name, r.delete_rule]));

    const problems = orgTables
      .filter((name) => name !== 'organisations')
      .filter((name) => cascades.get(name) !== 'CASCADE')
      .map((name) => `${name} (${cascades.get(name) ?? 'no foreign key to organisations'})`);

    expect(
      problems,
      `Deleting an organisation would not reach these, so "delete everything" would be a lie: ${problems.join(', ')}`,
    ).toEqual([]);
  });

  it('gives a reason for every table it excludes', () => {
    for (const [table, reason] of Object.entries(NOT_ABOUT_YOU)) {
      expect(reason.length, `${table} is excluded with no reason given`).toBeGreaterThan(20);
    }
  });

  it('says something useful about every table it includes', () => {
    // Sentences, not word counts. A length threshold would only teach the
    // next person to pad: "Its name." is a complete answer for
    // `organisations` and a long one would be worse.
    for (const held of PRIVACY_RECORD) {
      expect(held.holds, `${held.table} does not say what it holds`).toMatch(/\.$/u);
      expect(held.why, `${held.table} does not say why we have it`).toMatch(/\.$/u);
      expect(held.label.trim(), `${held.table} has no human name`).not.toBe('');
      // A plural noun, so "3 applications" reads properly in the delete
      // confirmation. A heading will not do: "3 your applications" is not a
      // sentence.
      expect(held.counted.trim(), `${held.table} has no noun to count with`).not.toBe('');
      // Not "Your applications": a heading, not a noun. 'AI runs' is the one
      // legitimate capital, so the rule is "does not start like a heading"
      // rather than "is all lower case".
      expect(held.counted, `${held.table}'s counting noun reads like a heading`).not.toMatch(
        /^(Your|What|Who|The|Earlier|Documents|Review|Text|Evidence)\b/u,
      );
    }
  });

  it('names no table twice', () => {
    const named = PRIVACY_RECORD.map((h) => h.table);
    expect(new Set(named).size).toBe(named.length);
    for (const table of named) {
      expect(Object.hasOwn(NOT_ABOUT_YOU, table), `${table} is in both lists`).toBe(false);
    }
  });
});
