/**
 * Which key the product actually uses.
 *
 * These matter because the two ways in must not disagree. When
 * `isWriterAvailable` started counting ANTHROPIC_API_KEY and this function did
 * not, the interface offered drafting and reviewing and then reported that
 * encryption was not configured — a feature that looked available and was not.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { providerFromStore } from './provider-from-store.js';

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'APP_ENCRYPTION_KEY', 'DATABASE_URL'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('providerFromStore', () => {
  it('uses the environment key when nothing is stored', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-environment';
    const outcome = await providerFromStore();
    expect(outcome.available).toBe(true);
  });

  it('reports unavailable when there is no key anywhere', async () => {
    const outcome = await providerFromStore();
    expect(outcome.available).toBe(false);
    if (!outcome.available) {
      expect(outcome.reason).toContain('Settings');
      // The old message named encryption, which was true but useless: the user
      // has no key at all, and cannot act on a fact about the server.
      expect(outcome.reason).not.toMatch(/encryption/iu);
    }
  });

  it('treats a blank environment key as no key', async () => {
    process.env['ANTHROPIC_API_KEY'] = '   ';
    expect((await providerFromStore()).available).toBe(false);
  });

  it('never returns the key itself in the unavailable reason', async () => {
    process.env['ANTHROPIC_API_KEY'] = '';
    const outcome = await providerFromStore();
    if (!outcome.available) expect(outcome.reason).not.toContain('sk-ant');
  });
});
