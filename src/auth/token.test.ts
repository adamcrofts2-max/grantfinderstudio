import { describe, expect, it } from 'vitest';

import { createSessionToken, hashSessionToken, tokensMatch } from './token.js';

describe('createSessionToken', () => {
  it('is 256 bits of randomness, url-safe', () => {
    const token = createSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, () => createSessionToken()));
    expect(seen.size).toBe(500);
  });
});

describe('hashSessionToken', () => {
  it('is stable for the same token', () => {
    const token = createSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it('differs for different tokens', () => {
    expect(hashSessionToken(createSessionToken())).not.toBe(hashSessionToken(createSessionToken()));
  });

  it('does not contain the token, which is the point', () => {
    // What is stored must not be replayable as a credential.
    const token = createSessionToken();
    expect(hashSessionToken(token)).not.toContain(token);
  });
});

describe('tokensMatch', () => {
  it('matches identical tokens and rejects others', () => {
    const token = createSessionToken();
    expect(tokensMatch(token, token)).toBe(true);
    expect(tokensMatch(token, createSessionToken())).toBe(false);
    expect(tokensMatch(token, `${token}x`)).toBe(false);
    expect(tokensMatch('', '')).toBe(true);
  });
});
