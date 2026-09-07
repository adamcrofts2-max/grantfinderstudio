/**
 * Migration runner.
 *
 * Applies numbered SQL files in order, once each, recording what has run.
 * Deliberately simple: plain SQL files are the schema's source of truth,
 * because Row-Level Security policies cannot be expressed in an ORM model and
 * those policies are the security boundary.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
export const MIGRATIONS = [
  '0001_init.sql',
  '0002_credentials.sql',
  '0003_documents.sql',
  '0004_user_opportunities.sql',
  '0005_project_costs.sql',
] as const;

export async function readMigration(name: string): Promise<string> {
  const path = fileURLToPath(new URL(`./migrations/${name}`, import.meta.url));
  return readFile(path, 'utf8');
}

export interface MigrationOutcome {
  applied: string[];
  skipped: string[];
}

/**
 * Bring the database up to date.
 *
 * Each migration runs in its own transaction, so a failure leaves earlier ones
 * applied and the failing one rolled back entirely.
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
    await runInTransaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    });
    applied.push(name);
  }

  return { applied, skipped };
}
