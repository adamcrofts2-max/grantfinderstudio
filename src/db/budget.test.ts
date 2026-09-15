/**
 * The budget and the logic model, against the real schema.
 *
 * Both tables have been in 0001 since the beginning with nothing writing to
 * them, while the readiness card said "No budget has been built" on every
 * application. These tests are the first thing that has ever inserted a row
 * into either.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { addBudgetLine, deleteBudgetLine, loadBudgetLines } from './budget.js';
import { addOutcome, deleteOutcome, loadOutcomes } from './outcomes.js';
import { createTestDatabase, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;
const tx = (): Queryable => harness.db as unknown as Queryable;

const ORG = 'org_budget';
const APP = 'app_budget';
const OTHER = 'app_budget_other';

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
  await harness.db.exec(`
    INSERT INTO organisations (id, name) VALUES ('${ORG}', 'Rivermead CIC');
    INSERT INTO applications (id, organisation_id, status, amount_requested_gbp)
      VALUES ('${APP}', '${ORG}', 'saved', 30000),
             ('${OTHER}', '${ORG}', 'saved', 5000);
  `);
});

afterEach(async () => {
  await harness.close();
});

describe('the budget', () => {
  it('starts empty rather than absent', async () => {
    expect(await loadBudgetLines(tx(), APP)).toEqual([]);
  });

  it('creates the budget lazily, with the first line', async () => {
    // Nobody should have to make a budget before adding to it.
    await addBudgetLine(tx(), ORG, APP, {
      category: 'staff',
      description: 'Youth worker, 2 days a week',
      amountGbp: 18_000,
    });

    const lines = await loadBudgetLines(tx(), APP);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.description).toBe('Youth worker, 2 days a week');
    expect(lines[0]?.amountGbp).toBe(18_000);
    expect(lines[0]?.category).toBe('staff');
  });

  it('takes a second line without making a second budget', async () => {
    // 0001 puts a UNIQUE on application_id, so a naive insert-then-insert
    // would fail here rather than reuse the budget.
    await addBudgetLine(tx(), ORG, APP, { category: 'staff', description: 'A', amountGbp: 1 });
    await addBudgetLine(tx(), ORG, APP, { category: 'venues', description: 'B', amountGbp: 2 });

    expect(await loadBudgetLines(tx(), APP)).toHaveLength(2);
    const { rows } = await harness.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM budgets WHERE application_id = '${APP}'`,
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('keeps pence', async () => {
    await addBudgetLine(tx(), ORG, APP, {
      category: 'materials',
      description: 'Consumables',
      amountGbp: 1234.56,
    });
    expect((await loadBudgetLines(tx(), APP))[0]?.amountGbp).toBe(1234.56);
  });

  it('refuses a line of zero, because the column says so', async () => {
    // Defence in depth: the domain reports it as an error too, but a line
    // that reached the table would make every total wrong afterwards.
    await expect(
      addBudgetLine(tx(), ORG, APP, { category: 'staff', description: 'Free', amountGbp: 0 }),
    ).rejects.toThrow();
  });

  it('keeps each application’s budget to itself', async () => {
    await addBudgetLine(tx(), ORG, APP, { category: 'staff', description: 'Ours', amountGbp: 1 });
    expect(await loadBudgetLines(tx(), OTHER)).toEqual([]);
  });

  it('removes a line', async () => {
    const id = await addBudgetLine(tx(), ORG, APP, {
      category: 'travel',
      description: 'Minibus',
      amountGbp: 900,
    });
    expect(await deleteBudgetLine(tx(), APP, id)).toBe(true);
    expect(await loadBudgetLines(tx(), APP)).toEqual([]);
  });

  it('will not remove a line through the wrong application', async () => {
    // RLS confines this to the tenant already; the application scope stops
    // one of your own applications reaching into another.
    const id = await addBudgetLine(tx(), ORG, APP, {
      category: 'travel',
      description: 'Minibus',
      amountGbp: 900,
    });
    expect(await deleteBudgetLine(tx(), OTHER, id)).toBe(false);
    expect(await loadBudgetLines(tx(), APP)).toHaveLength(1);
  });

  it('says so when the line had already gone', async () => {
    expect(await deleteBudgetLine(tx(), APP, 'bl_nonexistent')).toBe(false);
  });
});

describe('the logic model', () => {
  const ROW = {
    activity: 'Run a weekly evening skills session in Wells',
    output: '40 sessions a year, reaching 60 young people',
    outcome: 'At least 25 move into work, training or education',
    indicator: 'Destination survey at 6 months',
    target: '25 of 60',
  };

  it('starts empty', async () => {
    expect(await loadOutcomes(tx(), APP)).toEqual([]);
  });

  it('stores the activity, output and outcome separately', async () => {
    // The distinction between the last two is the point of the table.
    await addOutcome(tx(), ORG, APP, ROW);
    const rows = await loadOutcomes(tx(), APP);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.activity).toBe(ROW.activity);
    expect(rows[0]?.output).toBe(ROW.output);
    expect(rows[0]?.outcome).toBe(ROW.outcome);
  });

  it('allows no measure, because plenty of funders do not ask', async () => {
    await addOutcome(tx(), ORG, APP, { ...ROW, indicator: null, target: null });
    const rows = await loadOutcomes(tx(), APP);
    expect(rows[0]?.indicator).toBeNull();
    expect(rows[0]?.target).toBeNull();
  });

  it('keeps several rows in the order they were added', async () => {
    await addOutcome(tx(), ORG, APP, { ...ROW, activity: 'First' });
    await addOutcome(tx(), ORG, APP, { ...ROW, activity: 'Second' });
    expect((await loadOutcomes(tx(), APP)).map((r) => r.activity)).toEqual(['First', 'Second']);
  });

  it('keeps each application’s rows to itself', async () => {
    await addOutcome(tx(), ORG, APP, ROW);
    expect(await loadOutcomes(tx(), OTHER)).toEqual([]);
  });

  it('removes a row, and only through its own application', async () => {
    const id = await addOutcome(tx(), ORG, APP, ROW);
    expect(await deleteOutcome(tx(), OTHER, id)).toBe(false);
    expect(await deleteOutcome(tx(), APP, id)).toBe(true);
    expect(await loadOutcomes(tx(), APP)).toEqual([]);
  });
});
