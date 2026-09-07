/**
 * First run on an empty database, against real PostgreSQL.
 *
 * These exist because the demo seed runs only against the in-memory dev
 * database, so nothing here had ever been exercised on a database that starts
 * empty — which is exactly what a deployment is. `confirmCompanyAction` was
 * written as an UPDATE, and on a fresh database it would have changed nothing
 * and reported success.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MIGRATIONS } from './migrate.js';
import {
  ensureOrganisation,
  ensureUser,
  hasProfile,
  saveSelfDeclaredProfile,
} from './onboarding.js';

const ORG = 'org_new';
const USER = 'user_new';

let db: PGlite;

/** A genuinely empty database: schema applied, no seed at all. */
beforeEach(async () => {
  db = new PGlite();
  for (const name of MIGRATIONS) {
    const path = fileURLToPath(new URL(`./migrations/${name}`, import.meta.url));
    await db.exec(await readFile(path, 'utf8'));
  }
});

afterEach(async () => {
  await db.close();
});

const profile = {
  legalName: 'Mendip Green Futures CIC',
  companyNumber: '12345678',
  legalForm: 'cic_limited_by_guarantee' as const,
  jurisdiction: 'england' as const,
  region: 'Somerset',
  incorporationDate: '2020-01-15',
};

describe('ensureUser', () => {
  it('creates the account, and is safe to repeat', async () => {
    await ensureUser(db, USER);
    await ensureUser(db, USER);
    const r = await db.query('SELECT id FROM users');
    expect(r.rows).toHaveLength(1);
  });
});

describe('ensureOrganisation', () => {
  it('creates the organisation, its profile and the membership', async () => {
    await ensureUser(db, USER);
    await ensureOrganisation(db, ORG, USER, 'Mendip Green Futures CIC');
    for (const [table, column] of [
      ['organisations', 'id'],
      ['organisation_profiles', 'organisation_id'],
      ['users', 'id'],
      ['memberships', 'organisation_id'],
    ] as const) {
      const r = await db.query(`SELECT ${column} FROM ${table}`);
      expect(r.rows, table).toHaveLength(1);
    }
  });

  it('needs the user to exist first, which is why the two are separate', async () => {
    // users carries no tenant column and app_user has only SELECT on it, so
    // the account is the operator's to create while everything else belongs
    // to the tenant. The foreign key is what enforces the order.
    await expect(ensureOrganisation(db, ORG, USER, 'No such user yet')).rejects.toThrow();
  });

  it('is safe to run twice', async () => {
    await ensureUser(db, USER);
    await ensureOrganisation(db, ORG, USER, 'Mendip Green Futures CIC');
    await expect(ensureOrganisation(db, ORG, USER, 'A different name')).resolves.toBeUndefined();
    const r = await db.query('SELECT id FROM organisations');
    expect(r.rows).toHaveLength(1);
  });

  it('makes the owner a member, so they are not locked out of their own data', async () => {
    await ensureUser(db, USER);
    await ensureOrganisation(db, ORG, USER, 'Mendip Green Futures CIC');
    const r = await db.query<{ role: string }>('SELECT role FROM memberships');
    expect(r.rows[0]?.role).toBe('owner');
  });
});

describe('saveSelfDeclaredProfile', () => {
  beforeEach(async () => {
    await ensureUser(db, USER);
    await ensureOrganisation(db, ORG, USER, profile.legalName);
  });

  it('records the details on the profile the eligibility engine reads', async () => {
    await saveSelfDeclaredProfile(db, ORG, USER, profile);
    const r = await db.query<{
      legal_name: string;
      form: string;
      jurisdiction: string;
      region: string;
    }>('SELECT legal_name, form, jurisdiction, region FROM organisation_profiles');
    expect(r.rows[0]).toMatchObject({
      legal_name: 'Mendip Green Futures CIC',
      form: 'cic_limited_by_guarantee',
      jurisdiction: 'england',
      region: 'Somerset',
    });
  });

  it('marks every fact as self-declared, never as register-verified', async () => {
    // Legal form is the criterion most funders decide on. A value someone
    // typed must never be presentable as one checked against the register.
    await saveSelfDeclaredProfile(db, ORG, USER, profile);
    const r = await db.query<{ source: string }>('SELECT DISTINCT source FROM facts');
    expect(r.rows.map((row) => row.source)).toEqual(['user']);
  });

  it('confirms those facts, because the person typed them', async () => {
    // Asking someone to confirm what they just wrote is theatre; the same
    // reasoning correctFact already uses for a correction.
    await saveSelfDeclaredProfile(db, ORG, USER, profile);
    const r = await db.query<{ confirmed_by: string | null }>('SELECT confirmed_by FROM facts');
    expect(r.rows.every((row) => row.confirmed_by === USER)).toBe(true);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('skips the optional fields that were left blank', async () => {
    await saveSelfDeclaredProfile(db, ORG, USER, {
      ...profile,
      companyNumber: null,
      region: null,
      incorporationDate: null,
    });
    const r = await db.query<{ claim: string }>('SELECT claim FROM facts ORDER BY claim');
    expect(r.rows.map((row) => row.claim)).toEqual(['legal_form', 'legal_name']);
  });

  it('can be corrected without piling up duplicates', async () => {
    await saveSelfDeclaredProfile(db, ORG, USER, profile);
    await saveSelfDeclaredProfile(db, ORG, USER, { ...profile, region: 'Dorset' });
    const r = await db.query<{ value: string }>(
      "SELECT value FROM facts WHERE claim = 'area_of_operation'",
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.value).toBe('Dorset');
  });
});

describe('hasProfile', () => {
  it('is false on an empty database', async () => {
    expect(await hasProfile(db, ORG)).toBe(false);
  });

  it('is false once the organisation exists but before the form is known', async () => {
    // A name alone is not enough to assess anyone against anything.
    await ensureUser(db, USER);
    await ensureOrganisation(db, ORG, USER, profile.legalName);
    expect(await hasProfile(db, ORG)).toBe(false);
  });

  it('is true once the details are in', async () => {
    await ensureUser(db, USER);
    await ensureOrganisation(db, ORG, USER, profile.legalName);
    await saveSelfDeclaredProfile(db, ORG, USER, profile);
    expect(await hasProfile(db, ORG)).toBe(true);
  });
});
