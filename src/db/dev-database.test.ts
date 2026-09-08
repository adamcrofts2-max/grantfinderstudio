/**
 * The development database must isolate tenants as strictly as production.
 *
 * These tests exist because it did not. It had one connection, raised the role
 * once at startup, and reset it around every operator call — so a tenant query
 * that overlapped an operator call ran as the OWNER and saw every other
 * tenant's rows. Every policy test passed throughout: the policies were right,
 * and nothing tested two things happening at once.
 *
 * The bug reached a browser. A signed-in account with its own organisation was
 * shown the demonstration organisation's turnover, staff count and programme.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDevDatabase, withAdmin } from './dev-database.js';

const HANDLE = Symbol.for('grantfinderstudio.devDatabase');

/** A tenant that is not the demo organisation and owns nothing. */
const STRANGER = 'stranger_org';

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[HANDLE];
});

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[HANDLE];
});

async function countFacts(): Promise<number> {
  const database = await getDevDatabase();
  return database.withTenant(STRANGER, async (tx) => {
    const { rows } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM facts');
    return rows[0]?.n ?? -1;
  });
}

describe('the development database', () => {
  it('shows a stranger none of the demo organisation’s facts', async () => {
    expect(await countFacts()).toBe(0);
  });

  it('still shows none while an operator call is in flight', async () => {
    // The exact shape of the render that exposed it: the layout asks an
    // operator question while the page reads tenant data.
    const [operator, tenant] = await Promise.all([
      withAdmin(async (tx) => {
        const { rows } = await tx.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM facts',
        );
        return rows[0]?.n ?? -1;
      }),
      countFacts(),
    ]);

    // The operator genuinely sees everything — that is what the role is for.
    expect(operator).toBeGreaterThan(0);
    // The tenant must still see nothing.
    expect(tenant).toBe(0);
  });

  it('leaves no privileged role behind after an operator call', async () => {
    await withAdmin(async (tx) => {
      await tx.query('SELECT 1');
    });
    expect(await countFacts()).toBe(0);
  });

  it('keeps two tenants apart when their transactions overlap', async () => {
    const database = await getDevDatabase();
    const read = (organisationId: string) =>
      database.withTenant(organisationId, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          'SELECT organisation_id AS id FROM organisation_profiles',
        );
        return rows.map((row) => row.id);
      });

    const [a, b] = await Promise.all([read(STRANGER), read('another_org')]);
    expect(a).toEqual([]);
    expect(b).toEqual([]);
  });
});
