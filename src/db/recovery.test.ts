/**
 * Does the process recover when the database comes back?
 *
 * It did not. The handle was cached as a PROMISE, and a rejected promise was
 * cached just as happily — so if the database was unreachable at the moment an
 * instance initialised its pool, every later request on that instance awaited
 * the same rejection and answered "The database is not available" while the
 * database was perfectly healthy. Only recycling the process fixed it.
 *
 * Not hypothetical on this hosting: a serverless function builds its pool on
 * its first request, and a Postgres that scales to zero takes a moment to
 * wake. The first caller after an idle spell is the one most likely to fail,
 * and one cold start could leave an instance answering errors for its whole
 * life.
 *
 * Found by walking the product — the local Postgres died mid-walk, came back,
 * and the running server kept insisting it was unreachable.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let saved: string | undefined;

beforeEach(() => {
  saved = process.env['DATABASE_URL'];
});

afterEach(async () => {
  if (saved === undefined) delete process.env['DATABASE_URL'];
  else process.env['DATABASE_URL'] = saved;
  await forget();
});

/** Drop whatever handle the module is holding, the way a fresh process would. */
async function forget(): Promise<void> {
  const { DATABASE_HANDLE } = await import('./index.js');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any)[DATABASE_HANDLE];
}

describe('a database that was not there when we first asked', () => {
  it('is tried again rather than remembered as broken', async () => {
    const { withAdmin } = await import('./index.js');
    await forget();

    // Nothing listening: port 1 is reserved and never a Postgres.
    process.env['DATABASE_URL'] = 'postgres://nobody:nothing@127.0.0.1:1/none?sslmode=disable';
    await expect(withAdmin((tx) => tx.query('SELECT 1'))).rejects.toThrow();

    // THE PROPERTY. Before the fix this second call awaited the same rejected
    // promise and failed identically, whatever the database was doing.
    // Pointing at the in-memory database stands in for "the database is back":
    // what is being tested is that a new handle is BUILT, not which one.
    delete process.env['DATABASE_URL'];
    await expect(withAdmin((tx) => tx.query('SELECT 1'))).resolves.toBeDefined();
  });

  it('keeps a working handle rather than rebuilding on every call', async () => {
    // The cache still has to do its job: one process, one pool. A fix that
    // rebuilt every time would exhaust connections under load.
    const { getDatabase } = await import('./index.js');
    await forget();
    delete process.env['DATABASE_URL'];

    const first = await getDatabase();
    const second = await getDatabase();
    expect(second).toBe(first);
  });

  it('does not throw away a live handle when an older attempt fails late', async () => {
    // Two callers race on a cold start: the first fails slowly, the second
    // succeeds. Clearing the cache unconditionally on the late rejection would
    // discard the live pool the second caller just built.
    const { getDatabase, withAdmin, DATABASE_HANDLE } = await import('./index.js');
    await forget();

    process.env['DATABASE_URL'] = 'postgres://nobody:nothing@127.0.0.1:1/none?sslmode=disable';
    const failing = withAdmin((tx) => tx.query('SELECT 1')).catch(() => 'failed');

    delete process.env['DATABASE_URL'];
    await forget();
    const live = await getDatabase();

    expect(await failing).toBe('failed');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const held = await (globalThis as any)[DATABASE_HANDLE];
    expect(held?.tenant).toBe(live);
  });
});
