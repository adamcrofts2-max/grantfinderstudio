/**
 * The app_user role must survive being created twice.
 *
 * Roles in Postgres are cluster-scoped, not database-scoped, so a plain
 * CREATE ROLE fails the second time this schema is applied anywhere in the
 * same cluster. A staging database alongside production on one Neon project
 * is enough to break a first deploy, and it would break it at the point where
 * the least is known about why.
 */

import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readMigration } from './migrate.js';

let db: PGlite;

beforeEach(() => {
  db = new PGlite();
});

afterEach(async () => {
  await db.close();
});

/** The role block from 0001, isolated so it can be run on its own. */
async function roleBlock(): Promise<string> {
  const sql = await readMigration('0001_init.sql');
  const start = sql.indexOf('DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_roles');
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf('END $$;', start) + 'END $$;'.length;
  return sql.slice(start, end);
}

describe('creating the app_user role', () => {
  it('succeeds the first time', async () => {
    await db.exec(await roleBlock());
    const r = await db.query<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE rolname = 'app_user'",
    );
    expect(r.rows).toHaveLength(1);
  });

  it('succeeds again when the role already exists', async () => {
    const block = await roleBlock();
    await db.exec(block);
    await expect(db.exec(block)).resolves.toBeDefined();
  });

  it('leaves the connecting role able to drop into app_user', async () => {
    // Without the membership grant, `SET LOCAL ROLE app_user` fails on any
    // host that does not hand out superuser — which is every managed one.
    await db.exec(await roleBlock());
    await expect(db.exec('SET ROLE app_user; RESET ROLE;')).resolves.toBeDefined();
  });
});
