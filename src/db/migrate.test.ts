import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migrate, MIGRATIONS, readMigration, type MigrationExecutor } from './migrate.js';

let db: PGlite;
let queryable: MigrationExecutor;

beforeEach(() => {
  db = new PGlite();
  queryable = {
    async query(sql, params) {
      const r = await db.query(sql, params as unknown[] | undefined);
      return { rows: r.rows as never[] };
    },
    async exec(sql) {
      await db.exec(sql);
    },
  };
});

afterEach(async () => {
  await db.close();
});

/** Each migration in its own transaction, as the runner is used in production. */
const inTransaction = async (fn: (tx: MigrationExecutor) => Promise<void>): Promise<void> => {
  await db.exec('BEGIN');
  try {
    await fn(queryable);
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
};

describe('migrate', () => {
  it('applies every migration to an empty database', async () => {
    const outcome = await migrate(queryable, inTransaction);
    expect(outcome.applied).toEqual([...MIGRATIONS]);
    expect(outcome.skipped).toEqual([]);
  });

  it('produces a working schema', async () => {
    await migrate(queryable, inTransaction);
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = tables.rows.map((r) => r.table_name);
    for (const expected of ['organisations', 'facts', 'opportunities', 'app_credentials']) {
      expect(names, `missing ${expected}`).toContain(expected);
    }
  });

  it('leaves Row-Level Security enabled on tenant tables', async () => {
    await migrate(queryable, inTransaction);
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relname IN ('facts','documents','applications') AND relkind = 'r'`,
    );
    expect(rls.rows).toHaveLength(3);
    for (const row of rls.rows) expect(row.relrowsecurity, row.relname).toBe(true);
  });

  it('is safe to run twice', async () => {
    await migrate(queryable, inTransaction);
    const second = await migrate(queryable, inTransaction);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual([...MIGRATIONS]);
  });

  it('records what it applied', async () => {
    await migrate(queryable, inTransaction);
    const rows = await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
    expect(rows.rows.map((r) => r.name)).toEqual([...MIGRATIONS]);
  });

  it('rolls a failing migration back rather than leaving it half applied', async () => {
    await migrate(queryable, inTransaction);
    await expect(
      inTransaction(async (tx) => {
        await tx.exec('CREATE TABLE half_applied (id text)');
        await tx.exec('THIS IS NOT SQL');
      }),
    ).rejects.toThrow();
    const left = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'half_applied'`,
    );
    expect(left.rows).toEqual([]);
  });

  it('can read every migration file it lists', async () => {
    for (const name of MIGRATIONS) {
      expect((await readMigration(name)).length).toBeGreaterThan(0);
    }
  });
});
