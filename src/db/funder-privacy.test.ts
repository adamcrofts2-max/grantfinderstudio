/**
 * A funder somebody typed in is theirs, not everybody's.
 *
 * Found by the September security review. Migration 0004 made a pasted FUND
 * private to the organisation that added it — "doing it with a blanket GRANT
 * would leak one CIC's research, which funds they are chasing" — and then
 * wrote the funder's NAME, the relationship itself, into the shared `funders`
 * table. `/funders` lists every row of that table, a funder with no awards is
 * tiered `not_characterised`, and that tier renders. So another organisation
 * saw it, captioned "They publish no grants at all".
 *
 * These tests are the boundary, asserted on the tenant connection, where row
 * level security decides what exists.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, ORG_A, ORG_B, type TestDatabase } from './testing/harness.js';
import { ensureFunder } from './opportunities.js';
import { ensureFunderNamed, findFunderById } from './catalogue.js';
import { loadAllFunderAwards } from './queries.js';

let t: TestDatabase;

beforeEach(async () => {
  t = await createTestDatabase();
});

afterEach(async () => {
  await t.close();
});

/** The admin path, as the add-a-fund actions call it. */
async function typedByA(name: string): Promise<string> {
  await t.db.exec('RESET ROLE;');
  const id = await ensureFunder(t.db, name, ORG_A);
  await t.db.exec('SET ROLE app_user;');
  return id;
}

describe('a funder one organisation typed in', () => {
  it('never appears on another organisation’s funder list', async () => {
    await typedByA('Hartley Private Family Trust');
    const seenByB = await t.asTenant(ORG_B, () => loadAllFunderAwards(t.db));
    expect(seenByB.map((f) => f.funderName)).not.toContain('Hartley Private Family Trust');
  });

  it('is still there for the organisation that typed it', async () => {
    await typedByA('Hartley Private Family Trust');
    const seenByA = await t.asTenant(ORG_A, () => loadAllFunderAwards(t.db));
    expect(seenByA.map((f) => f.funderName)).toContain('Hartley Private Family Trust');
  });

  it('is not handed to the next organisation that types the same name', async () => {
    // Reuse by name was the other half of the leak: B typing the same words
    // got A's row back, so B's fund hung off A's private funder.
    const forA = await typedByA('Hartley Private Family Trust');
    await t.db.exec('RESET ROLE;');
    const forB = await ensureFunder(t.db, 'Hartley Private Family Trust', ORG_B);
    await t.db.exec('SET ROLE app_user;');
    expect(forB).not.toBe(forA);
  });

  it('still reuses a shared funder, which is everybody’s already', async () => {
    // The demonstration funder is register data. Typing its name should find
    // it, exactly as before: only PRIVATE rows stop being shared.
    await t.db.exec('RESET ROLE;');
    const { rows } = await t.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM funders WHERE id NOT LIKE 'funder\\_user\\_%' LIMIT 1`,
    );
    const shared = rows[0];
    if (shared === undefined) throw new Error('fixture has no shared funder');
    const reused = await ensureFunder(t.db, shared.name, ORG_B);
    await t.db.exec('SET ROLE app_user;');
    expect(reused).toBe(shared.id);
  });

  it('goes when the organisation that typed it is deleted', async () => {
    const id = await typedByA('Hartley Private Family Trust');
    await t.db.exec(`RESET ROLE; DELETE FROM organisations WHERE id = '${ORG_A}';`);
    const { rows } = await t.db.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM funders WHERE id = $1',
      [id],
    );
    await t.db.exec('SET ROLE app_user;');
    expect(rows[0]?.n).toBe('0');
  });
});

describe('the typed-by-hand form, which reached the same table by a second door', () => {
  it('keeps its funder private too', async () => {
    await t.db.exec('RESET ROLE;');
    await ensureFunderNamed(t.db, 'Okafor Bequest', `funder_typed_${ORG_A}`, ORG_A);
    await t.db.exec('SET ROLE app_user;');
    const seenByB = await t.asTenant(ORG_B, () => loadAllFunderAwards(t.db));
    expect(seenByB.map((f) => f.funderName)).not.toContain('Okafor Bequest');
  });

  it('does not reuse another organisation’s row by name', async () => {
    await t.db.exec('RESET ROLE;');
    const forA = await ensureFunderNamed(t.db, 'Okafor Bequest', `funder_typed_${ORG_A}`, ORG_A);
    const forB = await ensureFunderNamed(t.db, 'Okafor Bequest', `funder_typed_${ORG_B}`, ORG_B);
    await t.db.exec('SET ROLE app_user;');
    expect(forB).not.toBe(forA);
  });

  it('lets the operator reuse only shared funders, never a customer’s', async () => {
    await t.db.exec('RESET ROLE;');
    const customers = await ensureFunderNamed(
      t.db,
      'Okafor Bequest',
      `funder_typed_${ORG_A}`,
      ORG_A,
    );
    const operators = await ensureFunderNamed(t.db, 'Okafor Bequest', 'funder_shared', null);
    await t.db.exec('SET ROLE app_user;');
    expect(operators).not.toBe(customers);
  });
});

describe('a funder id that arrives from a form', () => {
  it('will not resolve to another organisation’s private funder', async () => {
    // The manual form posts the funder the person picked. On the owner
    // connection, which bypasses row-level security, an unchecked lookup
    // would let a submitted id attach one CIC's fund to another's funder.
    const aPrivate = await typedByA('Hartley Private Family Trust');
    await t.db.exec('RESET ROLE;');
    const asB = await findFunderById(t.db, aPrivate, ORG_B);
    const asA = await findFunderById(t.db, aPrivate, ORG_A);
    await t.db.exec('SET ROLE app_user;');
    expect(asB).toBeNull();
    expect(asA?.name).toBe('Hartley Private Family Trust');
  });
});

describe('the backfill in 0029', () => {
  it('reads an organisation id that itself contains underscores, in both shapes', async () => {
    // The fixture organisation is `org_a`, so this is the realistic case.
    await t.db.exec('RESET ROLE;');
    const { rows } = await t.db.query<{ user: string; typed: string }>(
      `SELECT regexp_replace('funder_user_org_a_lx3k9', '^funder_user_(.*)_[^_]+$', '\\1') AS "user",
              regexp_replace('funder_typed_org_a_lx3k9_ab12cd', '^funder_typed_(.*)_[^_]+_[^_]+$', '\\1') AS typed`,
    );
    await t.db.exec('SET ROLE app_user;');
    expect(rows[0]).toEqual({ user: 'org_a', typed: 'org_a' });
  });
});
