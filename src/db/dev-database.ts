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
import { seedDemoData } from '../demo/seed.js';
import { TenantDatabase, type TransactionCapable } from './client.js';

const MIGRATIONS = ['0001_init.sql'] as const;

let instance: Promise<TenantDatabase> | null = null;

async function build(): Promise<TenantDatabase> {
  const db = new PGlite();

  for (const name of MIGRATIONS) {
    const path = fileURLToPath(new URL(`./migrations/${name}`, import.meta.url));
    await db.exec(await readFile(path, 'utf8'));
  }

  // Seeding runs as the owning role, before dropping privileges, so the
  // fixtures exist for every tenant that is entitled to see them.
  await seedDemoData(db);
  await db.exec('SET ROLE app_user;');

  return new TenantDatabase(db as unknown as TransactionCapable);
}

/** Shared across requests; built once per process. */
export function getDevDatabase(): Promise<TenantDatabase> {
  instance ??= build();
  return instance;
}
