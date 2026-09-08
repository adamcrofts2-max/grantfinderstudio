import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { attemptKey, clearAttempt, readAttempt, sweepAttempts, writeAttempt } from './throttle.js';
import { createTestDatabase, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;
let tx: Queryable;

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
  tx = harness.db as unknown as Queryable;
});

afterEach(async () => {
  await harness.close();
});

const NOW = new Date('2026-09-08T12:00:00Z');

describe('attemptKey', () => {
  it('is stable, and hides what it is keyed on', () => {
    const key = attemptKey('address', 'jo@example.org');
    expect(key).toBe(attemptKey('address', 'jo@example.org'));
    expect(key).not.toContain('jo@example.org');
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it('keeps the two axes apart even for the same string', () => {
    // An address and an origin that happened to read the same must never
    // share a bucket.
    expect(attemptKey('address', 'x')).not.toBe(attemptKey('origin', 'x'));
  });
});

describe('the bucket store', () => {
  it('is empty until something fails', async () => {
    expect(await readAttempt(tx, attemptKey('address', 'jo@example.org'))).toBeNull();
  });

  it('round-trips a record', async () => {
    const key = attemptKey('address', 'jo@example.org');
    await writeAttempt(tx, key, { attempts: 3, windowStartedAt: NOW });
    expect(await readAttempt(tx, key)).toEqual({ attempts: 3, windowStartedAt: NOW });
  });

  it('overwrites rather than duplicating', async () => {
    const key = attemptKey('origin', '203.0.113.7');
    await writeAttempt(tx, key, { attempts: 1, windowStartedAt: NOW });
    await writeAttempt(tx, key, { attempts: 2, windowStartedAt: NOW });
    expect((await readAttempt(tx, key))?.attempts).toBe(2);
  });

  it('forgets a bucket on request, which is what a right password does', async () => {
    const key = attemptKey('address', 'jo@example.org');
    await writeAttempt(tx, key, { attempts: 9, windowStartedAt: NOW });
    await clearAttempt(tx, key);
    expect(await readAttempt(tx, key)).toBeNull();
  });

  it('sweeps lapsed buckets and leaves live ones', async () => {
    await writeAttempt(tx, attemptKey('address', 'old@example.org'), {
      attempts: 5, windowStartedAt: new Date(NOW.getTime() - 3600_000),
    });
    await writeAttempt(tx, attemptKey('address', 'new@example.org'), {
      attempts: 5, windowStartedAt: NOW,
    });
    expect(await sweepAttempts(tx, new Date(NOW.getTime() - 60_000))).toBe(1);
    expect(await readAttempt(tx, attemptKey('address', 'new@example.org'))).not.toBeNull();
  });
});

describe('the attempts table', () => {
  it('is invisible to the tenant role', async () => {
    // Same rule as sessions and password hashes: this is read before anybody
    // is anybody, so it cannot be reached through a tenant connection.
    await harness.db.exec('SET ROLE app_user;');
    await expect(harness.db.query('SELECT * FROM auth_attempts')).rejects.toThrow(
      /permission denied/iu,
    );
    await expect(
      harness.db.query("INSERT INTO auth_attempts (id) VALUES ('x')"),
    ).rejects.toThrow(/permission denied/iu);
  });
});
