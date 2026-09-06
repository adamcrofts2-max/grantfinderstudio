/**
 * Test harness backed by PGlite — real PostgreSQL compiled to WebAssembly.
 *
 * This matters more than convenience. Row-Level Security is the mechanism the
 * whole multi-tenant security story rests on, and a mock cannot verify it.
 * PGlite runs the genuine Postgres policy engine, so these tests prove the
 * policies rather than asserting them.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = ['0001_init.sql', '0002_credentials.sql'] as const;

export interface TestDatabase {
  db: PGlite;
  /** Run a callback with the tenant context set to `organisationId`. */
  asTenant<T>(organisationId: string, fn: () => Promise<T>): Promise<T>;
  /** Run with no tenant context set at all, to prove the system fails closed. */
  asNoTenant<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

async function applyMigrations(db: PGlite): Promise<void> {
  // Migrations are ordered and must be applied one at a time.
  for (const name of MIGRATIONS) {
    const path = fileURLToPath(new URL(`../migrations/${name}`, import.meta.url));
    await db.exec(await readFile(path, 'utf8'));
  }
}

/**
 * Create a fresh in-memory database with the schema applied, then drop into
 * the unprivileged `app_user` role.
 *
 * Dropping the role is essential: the superuser bypasses RLS entirely, so a
 * test that forgot to switch roles would pass while proving nothing.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const db = new PGlite();
  await applyMigrations(db);
  await seedFixtures(db);
  await db.exec('SET ROLE app_user;');

  return {
    db,
    async asTenant(organisationId, fn) {
      await db.query('SELECT set_config($1, $2, false)', [
        'app.organisation_id',
        organisationId,
      ]);
      return fn();
    },
    async asNoTenant(fn) {
      await db.exec('RESET app.organisation_id;');
      return fn();
    },
    async close() {
      await db.close();
    },
  };
}

export const ORG_A = 'org_a';
export const ORG_B = 'org_b';

/**
 * Seed two tenants with directly comparable data.
 *
 * Seeding happens as superuser, before the role switch, so the fixtures exist
 * regardless of policy — which is what lets the tests prove that the policies,
 * not an empty table, are what hide the other tenant's rows.
 */
async function seedFixtures(db: PGlite): Promise<void> {
  await db.exec(`
    INSERT INTO users (id, email, name) VALUES
      ('user_a', 'a@example.org', 'Ann'),
      ('user_b', 'b@example.org', 'Ben');

    INSERT INTO organisations (id, name) VALUES
      ('${ORG_A}', 'Alpha CIC'),
      ('${ORG_B}', 'Beta CIC');

    INSERT INTO memberships (id, organisation_id, user_id, role) VALUES
      ('m_a', '${ORG_A}', 'user_a', 'owner'),
      ('m_b', '${ORG_B}', 'user_b', 'owner');

    INSERT INTO organisation_profiles
      (id, organisation_id, legal_name, form, incorporation_date, jurisdiction, region)
    VALUES
      ('p_a', '${ORG_A}', 'Alpha CIC', 'cic_limited_by_guarantee', '2020-01-15', 'england', 'Somerset'),
      ('p_b', '${ORG_B}', 'Beta CIC',  'cic_limited_by_shares',    '2023-06-01', 'wales',   'Gwynedd');

    INSERT INTO projects (id, organisation_id, name, beneficiary_groups, amount_sought_gbp)
    VALUES
      ('proj_a', '${ORG_A}', 'Alpha youth programme', ARRAY['young people'], 30000),
      ('proj_b', '${ORG_B}', 'Beta coastal project',  ARRAY['older people'], 15000);

    INSERT INTO documents
      (id, organisation_id, filename, mime_type, byte_size, storage_key)
    VALUES
      ('doc_a', '${ORG_A}', 'alpha-business-plan.pdf', 'application/pdf', 1024, 'k/doc_a'),
      ('doc_b', '${ORG_B}', 'beta-business-plan.pdf',  'application/pdf', 2048, 'k/doc_b');

    INSERT INTO facts
      (id, organisation_id, claim, value, source, retrieved_at, confirmed_by, confirmed_at)
    VALUES
      ('fact_a', '${ORG_A}', 'annual_turnover', '120000', 'user', now(), 'user_a', now()),
      ('fact_b', '${ORG_B}', 'annual_turnover', '48000',  'user', now(), 'user_b', now());

    INSERT INTO applications (id, organisation_id, status, amount_requested_gbp)
    VALUES
      ('app_a', '${ORG_A}', 'drafting', 30000),
      ('app_b', '${ORG_B}', 'drafting', 15000);

    INSERT INTO source_datasets
      (id, name, publisher, licence, attribution, retrieved_at)
    VALUES
      ('ds_demo', 'Demo dataset (fictional)', 'Grant Finder Studio',
       'CC-BY-4.0', 'Fictional demonstration data', now());

    INSERT INTO funders (id, name, source_dataset_id)
    VALUES ('funder_demo', 'Demonstration Trust (fictional)', 'ds_demo');
  `);
}
