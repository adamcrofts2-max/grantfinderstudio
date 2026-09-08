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
import {
  inTenantTransaction,
  TenantDatabase,
  type Queryable,
  type TransactionCapable,
} from './client.js';
import { migrate } from './migrate.js';
import { createPool, PostgresDatabase } from './postgres.js';

interface Backend {
  tenant: TenantDatabase;
  admin: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>;
}

/**
 * Held on globalThis, not in a module variable.
 *
 * Next.js bundles server actions and page renders separately, so a
 * module-level singleton is per-bundle rather than per-process: an action
 * would write to one in-memory database while a page read from another. With
 * a real Postgres that only wastes connection pools; with the in-memory
 * development database it silently loses every write.
 */
const HANDLE = Symbol.for('grantfinderstudio.database');

interface GlobalWithDatabase {
  [HANDLE]?: Promise<Backend>;
}

function cached(): Promise<Backend> | undefined {
  return (globalThis as GlobalWithDatabase)[HANDLE];
}

function cache(value: Promise<Backend>): Promise<Backend> {
  (globalThis as GlobalWithDatabase)[HANDLE] = value;
  return value;
}

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
  return (await (cached() ?? cache(build()))).tenant;
}

/**
 * Run a query with operator privileges, outside every tenant policy.
 *
 * Only for the platform's own service credentials. Keep the callers countable
 * on one hand.
 *
 * Never from inside a tenant transaction. That needs a second connection while
 * the first is still held: the development database has only one and waits on
 * itself forever, and a production pool under load exhausts itself the same
 * way. The check below turns a request that silently never returns into an
 * error with a stack trace pointing at the call.
 */
export async function withAdmin<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  if (inTenantTransaction()) {
    throw new Error(
      'withAdmin was called inside withTenant. That deadlocks: it needs a ' +
        'second connection while the first is still open. Resolve whatever ' +
        'the operator connection is for before opening the tenant ' +
        'transaction, and pass the result in.',
    );
  }
  return (await (cached() ?? cache(build()))).admin(fn);
}
