import { describe, expect, it } from 'vitest';

import { createSessionToken } from '../../auth/token.js';
import {
  RESET,
  resetEmail,
  resetExpiry,
  resetLink,
  tokenFromFragment,
  usableBaseUrl,
} from './reset.js';

describe('a reset link', () => {
  it('lasts thirty minutes', () => {
    const now = new Date('2026-09-24T10:00:00Z');
    expect(resetExpiry(now).toISOString()).toBe('2026-09-24T10:30:00.000Z');
    expect(RESET.minutes).toBe(30);
  });

  it('carries its token in the fragment, which no server and no Referer ever sees', () => {
    const token = createSessionToken();
    const link = new URL(resetLink(new URL('https://grants.example.org/anything'), token));
    expect(link.origin).toBe('https://grants.example.org');
    expect(link.pathname).toBe('/reset-password');
    expect(link.search).toBe('');
    expect(link.hash).toBe(`#token=${token}`);
  });

  it('reads the token back out, and nothing else', () => {
    const token = createSessionToken();
    expect(tokenFromFragment(`#token=${token}`)).toBe(token);
    expect(tokenFromFragment(`token=${token}`)).toBe(token);
    expect(tokenFromFragment('')).toBeNull();
    expect(tokenFromFragment('#token=short')).toBeNull();
    expect(tokenFromFragment(`#token=${token}&next=https://evil.example`)).toBeNull();
    expect(tokenFromFragment(`#token=${token.slice(0, 20)}`)).toBeNull();
  });
});

describe('the base a link is built on', () => {
  it('is https, or plain http only to this machine', () => {
    expect(usableBaseUrl('https://grants.example.org')?.origin).toBe('https://grants.example.org');
    expect(usableBaseUrl('http://localhost:3100')?.origin).toBe('http://localhost:3100');
    expect(usableBaseUrl('http://127.0.0.1:3000')?.origin).toBe('http://127.0.0.1:3000');
    expect(usableBaseUrl('http://grants.example.org')).toBeNull();
    expect(usableBaseUrl('javascript:alert(1)')).toBeNull();
    expect(usableBaseUrl('not a url')).toBeNull();
    expect(usableBaseUrl(null)).toBeNull();
  });

  it('refuses credentials in the address, which would be mailed to everybody', () => {
    expect(usableBaseUrl('https://user:pass@grants.example.org')).toBeNull();
  });
});

describe('the email', () => {
  it('holds the link, says how long it lasts, and what to do if it was not you', () => {
    const { subject, text } = resetEmail('https://grants.example.org/reset-password#token=x');
    expect(subject).toMatch(/reset/iu);
    expect(text).toContain('https://grants.example.org/reset-password#token=x');
    expect(text).toContain('30 minutes');
    expect(text).toMatch(/If it was not you, ignore this email/u);
  });
});
