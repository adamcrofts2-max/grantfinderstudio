/**
 * Tenant-context lifetime tests.
 *
 * Row-Level Security is only as good as the setting it reads. The failure this
 * file exists to prevent is a connection going back into the pool still
 * carrying the previous request's tenant, so the next request — possibly a
 * different CIC — inherits it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { InvalidTenantError, TenantDatabase, type TransactionCapable } from './client.js';
import { createTestDatabase, ORG_A, ORG_B, type TestDatabase } from './testing/harness.js';

let harness: TestDatabase;
let tenantDb: TenantDatabase;

beforeEach(async () => {
  harness = await createTestDatabase();
  tenantDb = new TenantDatabase(harness.db as unknown as TransactionCapable);
});

afterEach(async () => {
  await harness.close();
});

/** Query outside any tenant context, the way a fresh pooled connection would. */
async function rowsWithoutTenant(db: PGlite): Promise<unknown[]> {
  const r = await db.query('SELECT id FROM documents');
  return r.rows;
}

describe('withTenant', () => {
  it('scopes reads to the tenant', async () => {
    const rows = await tenantDb.withTenant(ORG_A, async (tx) => {
      const r = await tx.query<{ id: string }>('SELECT id FROM documents');
      return r.rows;
    });
    expect(rows).toEqual([{ id: 'doc_a' }]);
  });

  it('scopes writes to the tenant', async () => {
    await tenantDb.withTenant(ORG_A, async (tx) => {
      await tx.query(
        `INSERT INTO projects (id, organisation_id, name)
         VALUES ('proj_new', $1, 'From a scoped write')`,
        [ORG_A],
      );
    });
    const seenByB = await tenantDb.withTenant(ORG_B, async (tx) => {
      const r = await tx.query('SELECT id FROM projects');
      return r.rows;
    });
    expect(seenByB).toEqual([{ id: 'proj_b' }]);
  });

  it('returns the callback’s value', async () => {
    const answer = await tenantDb.withTenant(ORG_A, async () => 42);
    expect(answer).toBe(42);
  });
});

describe('the tenant context does not outlive the request', () => {
  it('is gone after a successful call', async () => {
    await tenantDb.withTenant(ORG_A, async (tx) => {
      const r = await tx.query('SELECT id FROM documents');
      expect(r.rows).toHaveLength(1);
    });
    // A connection returned to the pool must carry nothing.
    expect(await rowsWithoutTenant(harness.db)).toEqual([]);
  });

  it('is gone after the callback throws', async () => {
    await expect(
      tenantDb.withTenant(ORG_A, async () => {
        throw new Error('something failed mid-request');
      }),
    ).rejects.toThrow('something failed mid-request');

    expect(await rowsWithoutTenant(harness.db)).toEqual([]);
  });

  it('is gone after a database error rolls the transaction back', async () => {
    await expect(
      tenantDb.withTenant(ORG_A, async (tx) => {
        await tx.query('SELECT * FROM table_that_does_not_exist');
      }),
    ).rejects.toThrow();

    expect(await rowsWithoutTenant(harness.db)).toEqual([]);
  });

  it('does not bleed between two tenants used in sequence', async () => {
    const a = await tenantDb.withTenant(ORG_A, async (tx) =>
      (await tx.query<{ id: string }>('SELECT id FROM documents')).rows,
    );
    const b = await tenantDb.withTenant(ORG_B, async (tx) =>
      (await tx.query<{ id: string }>('SELECT id FROM documents')).rows,
    );
    expect(a).toEqual([{ id: 'doc_a' }]);
    expect(b).toEqual([{ id: 'doc_b' }]);
    expect(await rowsWithoutTenant(harness.db)).toEqual([]);
  });

  it('leaves nothing behind even after many alternating requests', async () => {
    for (const org of [ORG_A, ORG_B, ORG_A, ORG_B, ORG_A]) {
      const rows = await tenantDb.withTenant(org, async (tx) =>
        (await tx.query<{ organisation_id: string }>('SELECT organisation_id FROM documents'))
          .rows,
      );
      expect(rows).toEqual([{ organisation_id: org }]);
    }
    expect(await rowsWithoutTenant(harness.db)).toEqual([]);
  });
});

describe('validation is enforced before any query runs', () => {
  it('rejects an empty tenant id without opening a transaction', async () => {
    await expect(tenantDb.withTenant('', async () => 'unreachable')).rejects.toThrow(
      InvalidTenantError,
    );
    expect(await rowsWithoutTenant(harness.db)).toEqual([]);
  });
});
