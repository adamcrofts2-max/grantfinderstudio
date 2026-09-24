import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy, makeNonce } from './csp';

const directive = (policy: string, name: string): string =>
  policy.split('; ').find((part) => part.startsWith(`${name} `)) ?? '';

describe('contentSecurityPolicy', () => {
  const policy = contentSecurityPolicy('abc123');

  it('allows scripts only by this request’s nonce', () => {
    const script = directive(policy, 'script-src');
    expect(script).toContain(`'nonce-abc123'`);
    expect(script).toContain(`'strict-dynamic'`);
    // The two that would make the policy theatre.
    expect(script).not.toContain(`'unsafe-inline'`);
    expect(script).not.toContain(`'unsafe-eval'`);
  });

  it('allows eval only in development', () => {
    expect(directive(contentSecurityPolicy('n', { development: true }), 'script-src')).toContain(
      `'unsafe-eval'`,
    );
  });

  it('keeps the framing protection the header used to carry alone', () => {
    expect(directive(policy, 'frame-ancestors')).toBe(`frame-ancestors 'none'`);
  });

  it('lets forms post only here, and loads no plugins', () => {
    expect(directive(policy, 'form-action')).toBe(`form-action 'self'`);
    expect(directive(policy, 'object-src')).toBe(`object-src 'none'`);
  });
});

describe('makeNonce', () => {
  it('is fresh every time and long enough not to be guessed', () => {
    const seen = new Set(Array.from({ length: 200 }, () => makeNonce()));
    expect(seen.size).toBe(200);
    for (const nonce of seen) expect(atob(nonce)).toHaveLength(16);
  });
});
