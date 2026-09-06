/**
 * Database entry point.
 *
 * Chooses the backend from configuration and hides the choice from every
 * caller: application code depends on `TenantDatabase` and `withAdmin`, never
 * on which engine is underneath.
 *
 *   DATABASE_URL set    → real Postgres, migrations applied on first use
 *   DATABASE_URL unset  → PGlite in memory, seeded with fictional demo data
 *
 * PGlite is genuine PostgreSQL compiled to WebAssembly, so both paths run the
 * same migrations and the same Row-Level Security policies. The difference is
 * durability, not behaviour.
 */

import { readEnvironment } from '../env.js';
import { TenantDatabase, type Queryable, type TransactionCapable } from './client.js';
import { migrate } from './migrate.js';
import { createPool, PostgresDatabase } from './postgres.js';

interface Backend {
  tenant: TenantDatabase;
  admin: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
}

let backend: Promise<Backend> | null = null;

async function buildPostgres(url: string): Promise<Backend> {
  const database = new PostgresDatabase(createPool(url));

  const outcome = await migrate(database, (fn) => database.adminTransaction(fn));
  if (outcome.applied.length > 0) {
    console.log(`Applied migrations: ${outcome.applied.join(', ')}`);
  }

  return {
    tenant: new TenantDatabase(database as TransactionCapable),
    admin: (fn) => database.adminTransaction(fn),
  };
}

async function buildDevelopment(): Promise<Backend> {
  // Imported lazily so PGlite's WebAssembly is never loaded in production.
  const dev = await import('./dev-database.js');
  return {
    tenant: await dev.getDevDatabase(),
    admin: (fn) => dev.withAdmin(fn),
  };
}

function build(): Promise<Backend> {
  const url = readEnvironment().databaseUrl;
  return url === null ? buildDevelopment() : buildPostgres(url);
}

/** The tenant-scoped database. Every query through it is subject to RLS. */
export async function getDatabase(): Promise<TenantDatabase> {
  backend ??= build();
  return (await backend).tenant;
}

/**
 * Run a query with operator privileges, outside every tenant policy.
 *
 * Only for the platform's own service credentials. Keep the callers countable
 * on one hand.
 */
export async function withAdmin<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  backend ??= build();
  return (await backend).admin(fn);
}
