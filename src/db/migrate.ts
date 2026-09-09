/**
 * Migration runner.
 *
 * Applies numbered SQL files in order, once each, recording what has run.
 * Deliberately simple: plain SQL files are the schema's source of truth,
 * because Row-Level Security policies cannot be expressed in an ORM model and
 * those policies are the security boundary.
 */

import type { Queryable } from './client.js';

/**
 * What a migration needs beyond ordinary querying.
 *
 * A migration file is many statements, and a parameterised query uses the
 * extended protocol, which accepts only one. Scripts therefore go through
 * `exec`, and only the bookkeeping insert uses `query`.
 */
export interface MigrationExecutor extends Queryable {
  exec(sql: string): Promise<void>;
}

/** Order matters. Append only; never renumber or edit an applied file. */
import { MIGRATION_SQL } from './migrations.generated.js';

export const MIGRATIONS = [
  '0001_init.sql',
  '0002_credentials.sql',
  '0003_documents.sql',
  '0004_user_opportunities.sql',
  '0005_project_costs.sql',
  '0006_award_tags.sql',
  '0007_auth.sql',
  '0008_auth_throttle.sql',
  '0009_admin.sql',
  '0010_app_settings.sql',
] as const;

/**
 * The SQL for a migration.
 *
 * From an inlined module rather than the filesystem. A serverless bundle
 * contains only files something statically refers to, and these filenames are
 * assembled from MIGRATIONS at runtime — so on Vercel the .sql files were
 * simply absent, and the first request that touched data failed with ENOENT.
 * The .sql files remain the source of truth; `npm run migrations:generate`
 * turns them into `migrations.generated.ts`, and a test fails if the two drift.
 */
export async function readMigration(name: string): Promise<string> {
  const sql = MIGRATION_SQL[name];
  if (sql === undefined) {
    throw new Error(
      `No SQL for migration "${name}". Run: npm run migrations:generate`,
    );
  }
  return sql;
}

export interface MigrationOutcome {
  applied: string[];
  skipped: string[];
}

/**
 * The advisory lock migrations serialise on.
 *
 * An arbitrary constant; it only has to be the same in every instance and
 * unlikely to collide with another application's lock on a shared cluster.
 */
const MIGRATION_LOCK_KEY = 360_197_401;

/**
 * Bring the database up to date.
 *
 * Each migration runs in its own transaction, so a failure leaves earlier ones
 * applied and the failing one rolled back entirely.
 *
 * SERIALISED ACROSS INSTANCES. On a serverless host several instances cold
 * start at once, all read an empty `schema_migrations`, and all try to apply
 * the first migration together — which fails on the second one to reach
 * `CREATE TYPE`, and can leave different instances having applied different
 * subsets. So each migration takes an advisory lock before it looks, and looks
 * AGAIN once it holds it: whoever waited discovers the work is already done
 * rather than repeating it.
 *
 * The lock is transaction-scoped (`pg_advisory_xact_lock`, not
 * `pg_advisory_lock`) because it has to survive a connection pooler in
 * transaction mode, where a session-scoped lock would be taken on one backend
 * and released by whichever unrelated request borrowed it next.
 */
export async function migrate(
  db: MigrationExecutor,
  runInTransaction: (fn: (tx: MigrationExecutor) => Promise<void>) => Promise<void>,
): Promise<MigrationOutcome> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const done = await db.query<{ name: string }>('SELECT name FROM schema_migrations');
  const already = new Set(done.rows.map((row) => row.name));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const name of MIGRATIONS) {
    if (already.has(name)) {
      skipped.push(name);
      continue;
    }
    const sql = await readMigration(name);
    let ranHere = false;
    await runInTransaction(async (tx) => {
      // Wait for any other instance mid-migration, then re-check: the set we
      // read before the loop is stale by the time we hold the lock.
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
      const claimed = await tx.query<{ name: string }>(
        'SELECT name FROM schema_migrations WHERE name = $1',
        [name],
      );
      if (claimed.rows.length > 0) return;

      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      ranHere = true;
    });
    if (ranHere) applied.push(name);
    else skipped.push(name);
  }

  return { applied, skipped };
}
