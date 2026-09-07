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
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
// Shared with production so dev, tests and deployment cannot drift apart.
import { MIGRATIONS } from './migrate.js';
import { seedDemoApplication, seedDemoData } from '../demo/seed.js';
import { TenantDatabase, type Queryable, type TransactionCapable } from './client.js';


// Also on globalThis, for the same reason as src/db/index.ts: separate
// bundles must share one in-memory database or writes vanish.
const HANDLE = Symbol.for('grantfinderstudio.devDatabase');

interface GlobalWithDev {
  [HANDLE]?: { instance: Promise<TenantDatabase>; raw: PGlite | null };
}

function slot(): { instance: Promise<TenantDatabase>; raw: PGlite | null } | undefined {
  return (globalThis as GlobalWithDev)[HANDLE];
}

async function build(): Promise<TenantDatabase> {
  const db = new PGlite();

  for (const name of MIGRATIONS) {
    const path = fileURLToPath(new URL(`./migrations/${name}`, import.meta.url));
    await db.exec(await readFile(path, 'utf8'));
  }

  // Seeding runs as the owning role, before dropping privileges, so the
  // fixtures exist for every tenant that is entitled to see them.
  await seedDemoData(db);
  await seedDemoApplication(db);
  await db.exec('SET ROLE app_user;');

  const existing = slot();
  if (existing) existing.raw = db;
  return new TenantDatabase(db as unknown as TransactionCapable);
}

/** Shared across requests and bundles; built once per process. */
export function getDevDatabase(): Promise<TenantDatabase> {
  const existing = slot();
  if (existing) return existing.instance;
  const created = { instance: build(), raw: null as PGlite | null };
  (globalThis as GlobalWithDev)[HANDLE] = created;
  return created.instance;
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
 * role. Here there is one connection, so the role is raised and lowered around
 * the call, and lowered again in `finally` so a thrown error cannot leave the
 * connection privileged.
 *
 * Nothing tenant-scoped may be read through this. Keep the callers countable
 * on one hand.
 */
export async function withAdmin<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  await getDevDatabase();
  const db = slot()?.raw;
  if (!db) throw new Error('The database is not initialised.');
  await db.exec('RESET ROLE;');
  try {
    return await fn(db as unknown as Queryable);
  } finally {
    await db.exec('SET ROLE app_user;');
  }
}
