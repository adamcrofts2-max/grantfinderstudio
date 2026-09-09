/**
 * Development database.
 *
 * PGlite is real PostgreSQL compiled to WebAssembly, so this runs the same
 * migrations and the same Row-Level Security policies as production. It is
 * in-memory and reset on restart, which is what we want for a demonstration
 * database seeded with fictional data.
 *
 * Production uses ordinary PostgreSQL. Nothing here is imported by production
 * code paths: swap this module for a pg Pool and the rest is unchanged,
 * because everything above it depends only on the TransactionCapable interface.
 *
 * ## The one place this differs from production, and why it is dangerous
 *
 * Production hands every transaction its own pooled client and raises the role
 * INSIDE it (`SET LOCAL ROLE app_user`), so the role cannot outlive the
 * transaction or be seen by anything else. PGlite has exactly one connection.
 * An earlier version set the role once at startup and had the operator path
 * `RESET ROLE` around its call — which meant that any tenant query overlapping
 * an operator call ran as the OWNER, bypassing RLS and showing that tenant
 * every other tenant's rows. Nothing in the test suite could see it: the
 * policies are correct, and the tests exercise them one at a time. It took
 * driving the real app in a browser, where a layout and a page render at once,
 * for it to appear.
 *
 * So this module now does two things instead:
 *
 *   1. `SET LOCAL ROLE` inside the tenant transaction, exactly as production
 *      does, so the tenant path never depends on the ambient role.
 *   2. Serialises every operation on the single connection, so an operator
 *      call and a tenant transaction cannot interleave on it at all.
 */

import { PGlite } from '@electric-sql/pglite';
// Shared with production so dev, tests and deployment cannot drift apart.
import { MIGRATIONS, readMigration } from './migrate.js';
import { seedDemoApplication, seedDemoData } from '../demo/seed.js';
import { TenantDatabase, type Queryable, type QueryResult, type TransactionCapable } from './client.js';

/** The unprivileged role every tenant query runs as. Same name as production. */
const TENANT_ROLE = 'app_user';
/** The platform operator's role. No grants on any tenant table (0009). */
const OPERATOR_ROLE = 'app_operator';

// Also on globalThis, for the same reason as src/db/index.ts: separate
// bundles must share one in-memory database or writes vanish.
const HANDLE = Symbol.for('grantfinderstudio.devDatabase');

interface Slot {
  instance: Promise<TenantDatabase>;
  raw: PGlite | null;
  /** Tail of the queue serialising access to the single connection. */
  queue: Promise<unknown>;
}

interface GlobalWithDev {
  [HANDLE]?: Slot;
}

function slot(): Slot | undefined {
  return (globalThis as GlobalWithDev)[HANDLE];
}

/**
 * Run something with the connection to itself.
 *
 * One connection means one caller at a time. Without this, two overlapping
 * requests share a session: their BEGINs nest into one transaction, and a
 * role change made by either is visible to the other.
 */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const current = slot();
  if (!current) throw new Error('The database is not initialised.');
  const run = current.queue.then(fn, fn);
  // Swallow the outcome so one failure does not poison the queue.
  current.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Adapts PGlite to the same interface the production driver implements. */
function adapt(db: PGlite): TransactionCapable {
  const queryable: Queryable = {
    async query<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<QueryResult<T>> {
      const result = await db.query<T>(sql, params as unknown[] | undefined);
      return { rows: result.rows };
    },
  };

  return {
    query: queryable.query,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return exclusive(async () => {
        await db.exec('BEGIN');
        try {
          // Transaction-local, exactly as production does it: the role is
          // dropped when the transaction ends, however it ends.
          await db.exec(`SET LOCAL ROLE ${TENANT_ROLE}`);
          const result = await fn(queryable);
          await db.exec('COMMIT');
          return result;
        } catch (error) {
          await db.exec('ROLLBACK').catch(() => undefined);
          throw error;
        }
      });
    },
  };
}

async function build(): Promise<TenantDatabase> {
  const db = new PGlite();

  for (const name of MIGRATIONS) {
    await db.exec(await readMigration(name));
  }

  // Seeding runs as the owning role, which is why it can write the shared
  // reference rows that every tenant is entitled to read.
  await seedDemoData(db);
  await seedDemoApplication(db);

  const existing = slot();
  if (existing) existing.raw = db;
  return new TenantDatabase(adapt(db));
}

/** Shared across requests and bundles; built once per process. */
export function getDevDatabase(): Promise<TenantDatabase> {
  const existing = slot();
  if (existing) return existing.instance;
  // A deferred, because `build` needs the slot to be published before it runs:
  // it stores the raw handle there for the operator path.
  let settle!: (db: TenantDatabase) => void;
  let fail!: (error: unknown) => void;
  const instance = new Promise<TenantDatabase>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  (globalThis as GlobalWithDev)[HANDLE] = { instance, raw: null, queue: Promise.resolve() };
  build().then(settle, fail);
  return instance;
}

/**
 * Run a query with operator privileges, outside every tenant policy.
 *
 * This exists for exactly one thing: the platform's own service credentials,
 * which belong to no tenant and which `app_user` is deliberately granted no
 * access to. Attempting to read them through the ordinary tenant connection
 * fails with "permission denied" — that is the control working, not a bug.
 *
 * In production this is a separate connection pool authenticating as an admin
 * role. Here it is the same connection, running as its owner — so it takes the
 * queue, and nothing tenant-scoped can be in flight beside it.
 *
 * Nothing tenant-scoped may be read through this. Keep the callers countable
 * on one hand.
 */
export async function withAdmin<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  await getDevDatabase();
  const db = slot()?.raw;
  if (!db) throw new Error('The database is not initialised.');
  return exclusive(() => fn(db as unknown as Queryable));
}

/**
 * Run a query as the platform operator.
 *
 * Transaction-local role, exactly as production does it, and for the same
 * reason it matters more here: PGlite connects as a superuser, and a superuser
 * bypasses Row-Level Security whatever the policies say. Dropping into
 * `app_operator` is what makes "an admin page cannot read tenant data" mean
 * the same thing in development as it does in the deployment.
 */
export async function withOperator<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  await getDevDatabase();
  const db = slot()?.raw;
  if (!db) throw new Error('The database is not initialised.');
  return exclusive(async () => {
    await db.exec('BEGIN');
    try {
      await db.exec(`SET LOCAL ROLE ${OPERATOR_ROLE}`);
      const result = await fn({
        async query<T2 = Record<string, unknown>>(sql: string, params?: unknown[]) {
          const r = await db.query<T2>(sql, params as unknown[] | undefined);
          return { rows: r.rows };
        },
      });
      await db.exec('COMMIT');
      return result;
    } catch (error) {
      await db.exec('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });
}
