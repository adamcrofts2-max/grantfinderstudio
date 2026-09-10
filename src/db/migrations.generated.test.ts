/**
 * The generated SQL must match the .sql files.
 *
 * The .sql files are what a person reads and edits; the generated module is
 * what actually runs, in tests and in production alike. If they drift, the
 * database would be built from something nobody has read — so this fails
 * loudly instead, and names the command that fixes it.
 */

import { describe, expect, it } from 'vitest';

import { render } from '../../scripts/generate-migrations.mjs';
import { MIGRATIONS, readMigration } from './migrate.js';
import { MIGRATION_SQL } from './migrations.generated.js';

describe('migrations.generated.ts', () => {
  it('is up to date with src/db/migrations/*.sql', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const current = await readFile(
      fileURLToPath(new URL('./migrations.generated.ts', import.meta.url)),
      'utf8',
    );
    expect(
      current,
      'The generated migrations are stale. Run: npm run migrations:generate',
    ).toBe(await render());
  });

  it('carries every migration the runner lists', async () => {
    for (const name of MIGRATIONS) {
      expect(Object.keys(MIGRATION_SQL), name).toContain(name);
      expect((await readMigration(name)).length).toBeGreaterThan(0);
    }
  });

  it('lists every migration file, so one added to the folder cannot be forgotten', () => {
    // The check above is one-directional and that turned out to matter: a new
    // .sql file is picked up by the generator automatically, but `MIGRATIONS`
    // is written by hand, so a migration could sit in the folder, be read by
    // anyone reviewing the schema, and never run anywhere. It would not fail —
    // it would just be absent, and the failure would surface later as a
    // missing column in an unrelated page.
    expect([...MIGRATIONS].toSorted()).toEqual(Object.keys(MIGRATION_SQL).toSorted());
  });

  it('refuses a migration it has no SQL for, rather than applying nothing', async () => {
    // Silently treating a missing migration as empty would leave a database
    // that reports itself migrated while missing tables.
    await expect(readMigration('9999_nonexistent.sql')).rejects.toThrow(
      /migrations:generate/u,
    );
  });
});
