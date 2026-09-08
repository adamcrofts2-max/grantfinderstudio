/**
 * The isolation self-check, against a real policy engine.
 *
 * This exists because a managed host can hand the connecting role privileges
 * that quietly undo Row-Level Security — Neon's owner inherits BYPASSRLS — and
 * a policy that has stopped applying looks exactly like one that is working.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from './testing/harness.js';

let harness: TestDatabase;

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
});

afterEach(async () => {
  await harness.close();
});

/** The queries `checkIsolation` runs, against the harness's own connection. */
async function report(): Promise<string[]> {
  const problems: string[] = [];
  const { rows } = await harness.db.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
    "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'app_user'",
  );
  const role = rows[0];
  if (role === undefined) return ['missing'];
  if (role.rolbypassrls) problems.push('bypassrls');
  if (role.rolsuper) problems.push('superuser');

  const { rows: unprotected } = await harness.db.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
        AND NOT c.relrowsecurity`,
  );
  problems.push(...unprotected.map((r) => `unprotected:${r.relname}`));
  return problems;
}

describe('the isolation self-check', () => {
  it('passes on a correctly migrated database', async () => {
    expect(await report()).toEqual([]);
  });

  it('catches BYPASSRLS on the tenant role', async () => {
    // The failure this whole file exists for: every policy silently stops
    // applying and nothing else about the system looks different.
    await harness.db.exec('ALTER ROLE app_user BYPASSRLS;');
    expect(await report()).toContain('bypassrls');
  });

  it('catches a policy on a table where RLS was never switched on', async () => {
    // A policy without ENABLE ROW LEVEL SECURITY is decoration.
    await harness.db.exec('ALTER TABLE documents DISABLE ROW LEVEL SECURITY;');
    expect(await report()).toContain('unprotected:documents');
  });

  it('proves the check is not just reading its own assumptions', async () => {
    // With BYPASSRLS actually granted, the tenant role really can see across
    // tenants — so the flag it reports is the flag that matters.
    await harness.db.exec('ALTER ROLE app_user BYPASSRLS;');
    await harness.db.exec('SET ROLE app_user;');
    const leaked = await harness.asTenant('org_a', async () =>
      harness.db.query('SELECT organisation_id FROM documents'),
    );
    expect(leaked.rows.length).toBeGreaterThan(1);
  });
});
