/**
 * What a provider's response means for the key.
 *
 * These exist because the mapping for Companies House was wrong for the whole
 * life of the feature and nothing could have caught it: the real service is
 * unreachable from the build environment, so the only test of the mapping was
 * somebody's first real deployment.
 *
 * The failure was expensive out of proportion to its size. A good key was
 * recorded as failing, and the onboarding screen — whose entire promise is
 * "we will look you up" — then hid its search box, with the explanation
 * sitting on a different screen in the console.
 */

import { describe, expect, it } from 'vitest';

import { interpretCompaniesHouseStatus } from './verify.js';

describe('reading a Companies House response', () => {
  it('treats 404 as a working key', () => {
    // THE BUG. An unauthenticated request gets 401, so a 404 proves the key
    // authenticated and the register simply had nothing for the probe. That
    // is not a fact about the key.
    expect(interpretCompaniesHouseStatus(404).ok).toBe(true);
  });

  it('treats 200 as a working key', () => {
    expect(interpretCompaniesHouseStatus(200).ok).toBe(true);
  });

  it('reports only 401 as the key being wrong', () => {
    const result = interpretCompaniesHouseStatus(401);
    expect(result.ok).toBe(false);
    expect(result.note).toMatch(/rejected that key/u);
  });

  it('says what a test-application key does, since that is the usual mistake', () => {
    // A Companies House test key authenticates only against their sandbox, so
    // against the live base URL it looks exactly like a mistyped key.
    expect(interpretCompaniesHouseStatus(401).note).toMatch(/sandbox/u);
  });

  it('distinguishes a valid key without permission from a wrong one', () => {
    const result = interpretCompaniesHouseStatus(403);
    expect(result.ok).toBe(false);
    expect(result.note).toMatch(/valid but not permitted/u);
  });

  it('does not blame the key for the service being down', () => {
    for (const status of [500, 502, 503]) {
      const result = interpretCompaniesHouseStatus(status);
      expect(result.ok, String(status)).toBe(false);
      expect(result.note, String(status)).toMatch(/may be fine/u);
    }
  });

  it('does not blame the key for a rate limit', () => {
    expect(interpretCompaniesHouseStatus(429).note).toMatch(/may be fine/u);
  });
});
