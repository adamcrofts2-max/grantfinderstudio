/**
 * Settings, against the real schema.
 *
 * The behaviour that matters most is CLEARING: a mistyped base URL has to be
 * reversible, and going back to the environment or the default is how.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readEffectiveSettings, readSetting, saveSetting, SettingError } from './store.js';
import {
  THREESIXTYGIVING_BASE_URL_KEY,
  THREESIXTYGIVING_MAX_PAGES_KEY,
} from './registry.js';
import { createTestDatabase, type TestDatabase } from '../db/testing/harness.js';
import type { Queryable } from '../db/client.js';

let harness: TestDatabase;
const tx = (): Queryable => harness.db as unknown as Queryable;

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
});

afterEach(async () => {
  await harness.close();
});

describe('saving a setting', () => {
  it('stores it and reports it as in force', async () => {
    await saveSetting(tx(), THREESIXTYGIVING_BASE_URL_KEY, 'https://mirror.example.org/', null);
    const found = (await readEffectiveSettings(tx(), {})).find(
      (s) => s.definition.key === THREESIXTYGIVING_BASE_URL_KEY,
    );
    expect(found?.value).toBe('https://mirror.example.org/');
    expect(found?.source).toBe('database');
  });

  it('beats the environment, because this takes effect now', async () => {
    await saveSetting(tx(), THREESIXTYGIVING_BASE_URL_KEY, 'https://mirror.example.org/', null);
    const value = await readSetting(tx(), THREESIXTYGIVING_BASE_URL_KEY, {
      THREESIXTYGIVING_BASE_URL: 'https://env.example.org/',
    });
    expect(value).toBe('https://mirror.example.org/');
  });

  it('clears back to the environment when the box is emptied', async () => {
    await saveSetting(tx(), THREESIXTYGIVING_BASE_URL_KEY, 'https://mirror.example.org/', null);
    await saveSetting(tx(), THREESIXTYGIVING_BASE_URL_KEY, '   ', null);
    const value = await readSetting(tx(), THREESIXTYGIVING_BASE_URL_KEY, {
      THREESIXTYGIVING_BASE_URL: 'https://env.example.org/',
    });
    expect(value).toBe('https://env.example.org/');
  });

  it('clears back to the default when there is no environment either', async () => {
    await saveSetting(tx(), THREESIXTYGIVING_MAX_PAGES_KEY, '200', null);
    await saveSetting(tx(), THREESIXTYGIVING_MAX_PAGES_KEY, '', null);
    expect(await readSetting(tx(), THREESIXTYGIVING_MAX_PAGES_KEY, {})).toBe('50');
  });

  it('updates in place rather than accumulating rows', async () => {
    await saveSetting(tx(), THREESIXTYGIVING_MAX_PAGES_KEY, '100', null);
    await saveSetting(tx(), THREESIXTYGIVING_MAX_PAGES_KEY, '200', null);
    const { rows } = await harness.db.query('SELECT key FROM app_settings WHERE key = $1', [
      THREESIXTYGIVING_MAX_PAGES_KEY,
    ]);
    expect(rows).toHaveLength(1);
    expect(await readSetting(tx(), THREESIXTYGIVING_MAX_PAGES_KEY, {})).toBe('200');
  });

  it('refuses an invalid value at the write, not only in the form', async () => {
    // A server action is a public endpoint; the check that counts is the one
    // nearest the write.
    await expect(
      saveSetting(tx(), THREESIXTYGIVING_BASE_URL_KEY, 'http://insecure.example.org/', null),
    ).rejects.toThrow(SettingError);
    await expect(
      saveSetting(tx(), THREESIXTYGIVING_MAX_PAGES_KEY, '9999', null),
    ).rejects.toThrow(/500 or less/);
  });

  it('refuses a key that is not in the registry', async () => {
    await expect(saveSetting(tx(), 'made.up.key', 'x', null)).rejects.toThrow(/Unknown setting/);
  });

  it('leaves nothing stored when it refuses', async () => {
    await expect(
      saveSetting(tx(), THREESIXTYGIVING_BASE_URL_KEY, 'not a url', null),
    ).rejects.toThrow();
    const { rows } = await harness.db.query('SELECT key FROM app_settings');
    expect(rows).toEqual([]);
  });
});

describe('reading settings', () => {
  it('returns every registered setting, stored or not', async () => {
    const all = await readEffectiveSettings(tx(), {});
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.every((s) => s.value !== '')).toBe(true);
  });
});
