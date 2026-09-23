/**
 * The setup counts, against the real schema.
 *
 * Written because the first version of this query named a column that does not
 * exist — `legal_form` is the TYPE, the column is `form` — and nothing but a
 * real database could have said so. It reached a browser before it was caught.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readSetupCounts } from './setup.js';
import { createTestDatabase, ORG_A, ORG_B, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;

beforeEach(async () => {
  harness = await createTestDatabase();
});

afterEach(async () => {
  await harness.close();
});

const counts = () =>
  harness.asTenant(ORG_A, () => readSetupCounts(harness.db as unknown as Queryable));

describe('readSetupCounts', () => {
  it('runs against the real schema', async () => {
    // The whole point: every column named here has to exist.
    await expect(counts()).resolves.toBeDefined();
  });

  it('reads the fixture tenant’s own state', async () => {
    const c = await counts();
    expect(c.hasOrganisation).toBe(true);
    expect(c.hasProject).toBe(true);
    expect(c.confirmedFacts).toBeGreaterThan(0);
    expect(c.applications).toBeGreaterThan(0);
  });

  it('does not count another tenant’s rows', async () => {
    // Row-Level Security does this, but the guide would be wrong in a
    // particularly confusing way if it ever stopped.
    const c = await counts();
    expect(c.applications).toBe(1);
  });

  it('does not count a shared fund as a fund you added', async () => {
    // Shared reference opportunities (added_by_organisation_id IS NULL) are
    // visible to every tenant. Counting them ticked "add a fund you are
    // considering" off for somebody who had never added one — invisible while
    // the shared table is empty, and true of every new account the moment it
    // is not.
    await harness.db.exec('RESET ROLE;');
    await harness.db.query(
      `INSERT INTO funders (id, name) VALUES ('shared_funder', 'A Shared Funder')
         ON CONFLICT (id) DO NOTHING`,
    );
    await harness.db.query(
      `INSERT INTO opportunities (id, funder_id, title, retrieved_at, added_by_organisation_id)
         VALUES ('shared_opp', 'shared_funder', 'Open to everyone', now(), NULL)`,
    );
    await harness.db.exec('SET ROLE app_user;');

    // Visible to the tenant...
    const visible = await harness.asTenant(ORG_A, async () => {
      const { rows } = await harness.db.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM opportunities',
      );
      return rows[0]?.n ?? 0;
    });
    expect(visible).toBeGreaterThan(0);

    // ...but not counted as one of theirs.
    expect((await counts()).opportunities).toBe(0);
  });

  it('counts a fund this organisation added', async () => {
    await harness.db.exec('RESET ROLE;');
    await harness.db.query(
      `INSERT INTO funders (id, name) VALUES ('own_funder', 'Their Own Funder')
         ON CONFLICT (id) DO NOTHING`,
    );
    await harness.db.query(
      `INSERT INTO opportunities (id, funder_id, title, retrieved_at, added_by_organisation_id)
         VALUES ('own_opp', 'own_funder', 'A fund they pasted', now(), $1)`,
      [ORG_A],
    );
    await harness.db.exec('SET ROLE app_user;');
    expect((await counts()).opportunities).toBe(1);
  });

  it('does not treat a profile with no legal form as an answer', async () => {
    // A profile that cannot answer an eligibility question is not a finished
    // step, however much of it has been filled in.
    await harness.db.exec('RESET ROLE;');
    await harness.db.query("UPDATE organisation_profiles SET form = NULL WHERE organisation_id = $1", [ORG_A]);
    await harness.db.exec('SET ROLE app_user;');
    expect((await counts()).hasOrganisation).toBe(false);
  });

  it('names the confirmed claims about the work, and nothing else', async () => {
    // The fixture holds a confirmed turnover — a fact, but not about the work.
    expect((await counts()).confirmedWorkClaims).toEqual([]);

    await harness.db.exec('RESET ROLE;');
    await harness.db.query(
      `INSERT INTO facts
         (id, organisation_id, claim, value, source, retrieved_at, confirmed_by, confirmed_at)
       VALUES
         ('m', $1, 'mission', 'We grow trees.', 'user', now(), 'user_a', now()),
         ('p', $1, 'people_supported_last_year', 'About 120', 'ai_extraction', now(), NULL, NULL),
         ('b', $2, 'beneficiary_groups', 'Not theirs', 'user', now(), 'user_b', now())`,
      [ORG_A, ORG_B],
    );
    await harness.db.exec('SET ROLE app_user;');

    // The unconfirmed one is a guess until somebody says it is right, and
    // the other tenant's is not theirs at all.
    const c = await counts();
    expect(c.confirmedWorkClaims).toEqual(['mission']);
    expect(c.pendingWorkClaims).toEqual(['people_supported_last_year']);
  });
});
