/**
 * Whether the company search is offered at all.
 *
 * Worth its own test because the condition was wrong for the entire life of
 * the screen and no test could have caught it: it read an optional base-URL
 * override rather than the key, so the search box was hidden on every
 * deployment configured the ordinary way, and the failure looked like a
 * missing feature rather than a bug.
 */

import { describe, expect, it } from 'vitest';

import { lookupAvailableFrom } from './lookup.js';
import type { CredentialStatus } from '@/secrets/store';

const status = (over: Partial<CredentialStatus> = {}): CredentialStatus => ({
  provider: 'companies_house',
  masked: null,
  lastCheckedAt: null,
  lastCheckOk: null,
  lastCheckNote: null,
  ...over,
});

describe('offering the company search', () => {
  it('is offered when a key is stored and last verified', () => {
    expect(lookupAvailableFrom(status({ masked: '••••1234', lastCheckOk: true }))).toBe(true);
  });

  it('is offered when a key is stored and has never been checked', () => {
    // Unchecked is not the same as broken, and refusing here would hide the
    // search from anybody whose verification call happened to time out.
    expect(lookupAvailableFrom(status({ masked: '••••1234', lastCheckOk: null }))).toBe(true);
  });

  it('is not offered when the stored key failed its last check', () => {
    // Stored is not the same as working. Offering a box that will fail spends
    // somebody's first minute on it.
    expect(lookupAvailableFrom(status({ masked: '••••1234', lastCheckOk: false }))).toBe(false);
  });

  it('is not offered when no key is stored', () => {
    expect(lookupAvailableFrom(status())).toBe(false);
  });

  it('does not depend on the base-URL override in any way', () => {
    // The whole bug. A base URL says where to ask; a key says whether we may.
    // This function cannot see the environment at all, which is the fix.
    expect(lookupAvailableFrom.length).toBe(1);
  });
});
