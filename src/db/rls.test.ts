/**
 * Tenant isolation tests.
 *
 * These run against real PostgreSQL (PGlite/WASM) with the genuine policy
 * engine. They are the proof behind the claim that one CIC can never see
 * another's data — the product's most consequential security property.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, ORG_A, ORG_B, type TestDatabase } from './testing/harness.js';

let t: TestDatabase;

beforeEach(async () => {
  t = await createTestDatabase();
});

afterEach(async () => {
  await t.close();
});

/** Every tenant-scoped table, with a row seeded for each of the two tenants. */
const TENANT_TABLES = [
  'organisation_profiles',
  'projects',
  'facts',
  'documents',
  'applications',
] as const;

describe('reads', () => {
  it.each(TENANT_TABLES)('%s shows a tenant only its own rows', async (table) => {
    const a = await t.asTenant(ORG_A, () =>
      t.db.query<{ organisation_id: string }>(`SELECT organisation_id FROM ${table}`),
    );
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]?.organisation_id).toBe(ORG_A);

    const b = await t.asTenant(ORG_B, () =>
      t.db.query<{ organisation_id: string }>(`SELECT organisation_id FROM ${table}`),
    );
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]?.organisation_id).toBe(ORG_B);
  });

  it('cannot reach another tenant’s row by asking for it directly by id', async () => {
    const r = await t.asTenant(ORG_A, () =>
      t.db.query("SELECT * FROM documents WHERE id = 'doc_b'"),
    );
    expect(r.rows).toEqual([]);
  });

  it('cannot count another tenant’s rows', async () => {
    const r = await t.asTenant(ORG_A, () =>
      t.db.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM facts WHERE organisation_id = $1",
        [ORG_B],
      ),
    );
    expect(r.rows[0]?.count).toBe('0');
  });

  it('cannot reach another tenant’s rows through a join', async () => {
    const r = await t.asTenant(ORG_A, () =>
      t.db.query(`
        SELECT d.id FROM documents d
        JOIN organisations o ON o.id = d.organisation_id
      `),
    );
    expect(r.rows).toEqual([{ id: 'doc_a' }]);
  });

  it('hides another tenant’s organisation record', async () => {
    const r = await t.asTenant(ORG_A, () =>
      t.db.query<{ id: string }>('SELECT id FROM organisations'),
    );
    expect(r.rows.map((x) => x.id)).toEqual([ORG_A]);
  });

  it('hides another tenant’s memberships', async () => {
    const r = await t.asTenant(ORG_A, () =>
      t.db.query<{ user_id: string }>('SELECT user_id FROM memberships'),
    );
    expect(r.rows.map((x) => x.user_id)).toEqual(['user_a']);
  });
});

describe('fails closed', () => {
  it('returns nothing when no tenant is set', async () => {
    // Sequential: each query runs against the same connection, whose tenant
    // context is shared state. Running these in parallel would race.
      for (const table of TENANT_TABLES) {
      const r = await t.asNoTenant(() => t.db.query(`SELECT * FROM ${table}`));
      expect(r.rows, `${table} leaked with no tenant context`).toEqual([]);
    }
  });

  it('returns nothing for an unrecognised tenant', async () => {
    const r = await t.asTenant('org_does_not_exist', () =>
      t.db.query('SELECT * FROM facts'),
    );
    expect(r.rows).toEqual([]);
  });
});

describe('writes', () => {
  it('cannot insert a row attributed to another tenant', async () => {
    await expect(
      t.asTenant(ORG_A, () =>
        t.db.query(
          `INSERT INTO projects (id, organisation_id, name)
           VALUES ('proj_x', $1, 'Smuggled project')`,
          [ORG_B],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('allows a tenant to insert its own row', async () => {
    await t.asTenant(ORG_A, async () => {
      await t.db.query(
        `INSERT INTO projects (id, organisation_id, name)
         VALUES ('proj_new', $1, 'Legitimate project')`,
        [ORG_A],
      );
    });
    const r = await t.asTenant(ORG_A, () =>
      t.db.query('SELECT id FROM projects ORDER BY id'),
    );
    expect(r.rows).toEqual([{ id: 'proj_a' }, { id: 'proj_new' }]);
  });

  it('cannot update another tenant’s row', async () => {
    await t.asTenant(ORG_A, () =>
      t.db.query("UPDATE documents SET filename = 'hacked.pdf' WHERE id = 'doc_b'"),
    );
    const r = await t.asTenant(ORG_B, () =>
      t.db.query<{ filename: string }>("SELECT filename FROM documents WHERE id = 'doc_b'"),
    );
    expect(r.rows[0]?.filename).toBe('beta-business-plan.pdf');
  });

  it('cannot move its own row to another tenant', async () => {
    await expect(
      t.asTenant(ORG_A, () =>
        t.db.query('UPDATE projects SET organisation_id = $1 WHERE id = $2', [
          ORG_B,
          'proj_a',
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot delete another tenant’s row', async () => {
    await t.asTenant(ORG_A, () =>
      t.db.query("DELETE FROM documents WHERE id = 'doc_b'"),
    );
    const r = await t.asTenant(ORG_B, () =>
      t.db.query("SELECT id FROM documents WHERE id = 'doc_b'"),
    );
    expect(r.rows).toHaveLength(1);
  });
});

describe('shared reference data', () => {
  it('is readable by every tenant', async () => {
    // Sequential for the same reason: the tenant context is per-connection.
      for (const org of [ORG_A, ORG_B]) {
      const r = await t.asTenant(org, () =>
        t.db.query<{ id: string }>('SELECT id FROM funders'),
      );
      expect(r.rows).toEqual([{ id: 'funder_demo' }]);
    }
  });

  it('is readable with no tenant set, since it belongs to nobody', async () => {
    const r = await t.asNoTenant(() => t.db.query('SELECT id FROM source_datasets'));
    expect(r.rows).toEqual([{ id: 'ds_demo' }]);
  });

  it('is not writable by a tenant', async () => {
    await expect(
      t.asTenant(ORG_A, () =>
        t.db.query(
          `INSERT INTO funders (id, name) VALUES ('funder_x', 'Injected funder')`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('schema constraints', () => {
  it('requires a confirmed fact to record both who and when', async () => {
    await expect(
      t.asTenant(ORG_A, () =>
        t.db.query(
          `INSERT INTO facts (id, organisation_id, claim, value, source, retrieved_at, confirmed_by)
           VALUES ('fact_bad', $1, 'x', 'y', 'user', now(), 'user_a')`,
          [ORG_A],
        ),
      ),
    ).rejects.toThrow(/confirmation_is_complete/);
  });

  it('refuses a confirmed deadline with no date', async () => {
    // Shared table, so this runs as the owning role rather than a tenant.
    await t.db.exec('RESET ROLE;');
    await expect(
      t.db.query(
        `INSERT INTO opportunities
           (id, funder_id, title, deadline_kind, retrieved_at)
         VALUES ('opp_bad', 'funder_demo', 'Bad', 'confirmed', now())`,
      ),
    ).rejects.toThrow(/confirmed_deadline_has_date/);
  });

  it('refuses an unsupported claim that also cites a fact', async () => {
    await expect(
      t.asTenant(ORG_A, async () => {
        await t.db.query(
          `INSERT INTO application_questions (id, organisation_id, application_id, position, question)
           VALUES ('q1', $1, 'app_a', 1, 'Describe the need')`,
          [ORG_A],
        );
        await t.db.query(
          `INSERT INTO answers (id, organisation_id, question_id, content)
           VALUES ('ans1', $1, 'q1', 'Some text')`,
          [ORG_A],
        );
        return t.db.query(
          `INSERT INTO answer_fact_refs
             (id, organisation_id, answer_id, fact_id, claim_text, is_unsupported)
           VALUES ('ref1', $1, 'ans1', 'fact_a', 'A claim', true)`,
          [ORG_A],
        );
      }),
    ).rejects.toThrow(/unsupported_has_no_fact/);
  });

  it('refuses a non-positive budget line', async () => {
    await expect(
      t.asTenant(ORG_A, async () => {
        await t.db.query(
          `INSERT INTO budgets (id, organisation_id, application_id)
           VALUES ('b1', $1, 'app_a')`,
          [ORG_A],
        );
        return t.db.query(
          `INSERT INTO budget_lines (id, organisation_id, budget_id, category, description, amount_gbp)
           VALUES ('bl1', $1, 'b1', 'staff', 'Free work', 0)`,
          [ORG_A],
        );
      }),
    ).rejects.toThrow(/amount_is_positive/);
  });
});
