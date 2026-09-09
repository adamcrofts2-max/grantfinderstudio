/**
 * What the platform operator can and cannot reach.
 *
 * This is the test the admin console rests on. The promise on the sign-in page
 * — "Your organisation, its facts and its applications are yours alone.
 * Nobody else can see them" — has to survive somebody with a console, and the
 * only version of that promise worth making is one the database enforces.
 *
 * So: every tenant table is listed here, and every one of them must fail with
 * "permission denied" for `app_operator`. A future migration that grants the
 * operator a tenant table breaks this test by construction, which is the
 * point — the grant becomes a decision somebody has to defend, not a line
 * that slips through.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, ORG_A, type TestDatabase } from './testing/harness.js';

let harness: TestDatabase;

beforeEach(async () => {
  harness = await createTestDatabase();
});

afterEach(async () => {
  await harness.close();
});

/** Every table holding one organisation's own work. */
const TENANT_TABLES = [
  'organisations',
  'organisation_profiles',
  'memberships',
  'projects',
  'facts',
  'evidence',
  'documents',
  'document_chunks',
  'applications',
  'application_questions',
  'answers',
  'answer_versions',
  'answer_fact_refs',
  'reviews',
  'budgets',
  'budget_lines',
  'outcomes',
  'audit_logs',
  'ai_generations',
] as const;

/** Credentials. Nobody but the owner reads these. */
const SECRET_TABLES = [
  'user_passwords',
  'admin_accounts',
  'admin_sessions',
  'sessions',
  'app_credentials',
] as const;

async function asOperator<T>(fn: () => Promise<T>): Promise<T> {
  await harness.db.exec('BEGIN');
  try {
    await harness.db.exec('SET LOCAL ROLE app_operator');
    const result = await fn();
    await harness.db.exec('COMMIT');
    return result;
  } catch (error) {
    await harness.db.exec('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

describe('the operator role', () => {
  it.each(TENANT_TABLES)('is refused %s outright', async (table) => {
    await expect(
      asOperator(() => harness.db.query(`SELECT * FROM ${table}`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it.each(SECRET_TABLES)('is refused %s outright', async (table) => {
    await expect(
      asOperator(() => harness.db.query(`SELECT * FROM ${table}`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it.each(TENANT_TABLES)('cannot write to %s either', async (table) => {
    await expect(
      asOperator(() => harness.db.query(`DELETE FROM ${table}`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it('can read the platform’s own tables', async () => {
    const rows = await asOperator(async () => {
      const users = await harness.db.query('SELECT count(*)::int AS n FROM users');

      const funders = await harness.db.query('SELECT count(*)::int AS n FROM funders');
      const attempts = await harness.db.query(
        'SELECT count(*)::int AS n FROM auth_attempts',
      );
      return { users, funders, attempts };
    });
    expect(rows.users.rows[0]).toBeDefined();
    expect(rows.funders.rows[0]).toBeDefined();
    expect(rows.attempts.rows[0]).toBeDefined();
  });

  it('cannot write to the catalogue it can read', async () => {
    // Curating shared reference data is the owner's job, not the operator's.
    // Read-only here means a compromised console session cannot rewrite what
    // every tenant sees.
    await expect(
      asOperator(() =>
        harness.db.query("UPDATE funders SET name = 'changed' WHERE id IS NOT NULL"),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('the tenant role', () => {
  it('can no longer read the platform’s list of accounts', async () => {
    // 0001 granted app_user SELECT on `users`, which has no policy — so the
    // tenant role could read every account on the platform. Nothing on the
    // tenant path ever used it. 0009 takes it back.
    await expect(
      harness.asTenant(ORG_A, () => harness.db.query('SELECT * FROM users')),
    ).rejects.toThrow(/permission denied/i);
  });
});
