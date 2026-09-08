import { describe, expect, it } from 'vitest';

import { hashPassword, needsRehash, SCRYPT, verifyPassword } from './password.js';

describe('hashPassword', () => {
  it('verifies the password it was made from', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a different password', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery stapl', stored)).toBe(false);
  });

  it('salts, so the same password twice is two different hashes', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse battery staple', b)).toBe(true);
  });

  it('carries its own parameters, so the cost can be raised later', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith(`scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$`)).toBe(true);
    expect(stored.split('$')).toHaveLength(6);
  });

  it('normalises unicode, so the same typed characters match', async () => {
    // é as one code point and as e + combining accent are the same password.
    const stored = await hashPassword('café passphrase here');
    expect(await verifyPassword('café passphrase here', stored)).toBe(true);
  });
});

describe('verifyPassword on a hash it cannot trust', () => {
  it('returns false rather than throwing', async () => {
    // A corrupted row must lock that one account out, not crash sign-in for
    // everybody — and must look exactly like a wrong password.
    const bad = ['', 'nonsense', 'scrypt$1$2$3', 'bcrypt$1$1$1$aa$bb',
                 'scrypt$x$8$1$aa$bb', 'scrypt$65536$8$1$$bb', 'scrypt$65536$8$1$aa$'];
    const results = await Promise.all(bad.map((h) => verifyPassword('anything', h)));
    expect(results).toEqual(bad.map(() => false));
  });

  it('refuses parameters that would exhaust the machine', async () => {
    // A hostile row must not be able to turn one sign-in into a denial of
    // service by naming an enormous work factor.
    const started = Date.now();
    expect(await verifyPassword('anything', 'scrypt$1073741824$32$16$aa$bb')).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('needsRehash', () => {
  it('is false for a hash at current parameters', async () => {
    expect(needsRehash(await hashPassword('correct horse battery staple'))).toBe(false);
  });

  it('is true for a weaker one, so it is upgraded at next sign-in', () => {
    expect(needsRehash('scrypt$16384$8$1$aa$bb')).toBe(true);
  });

  it('is true for anything it does not recognise', () => {
    expect(needsRehash('bcrypt$whatever')).toBe(true);
  });
});

describe('the absent-account hash', () => {
  it('is a real hash that makes verify do the work', async () => {
    // If it were malformed, verifyPassword would reject it before running
    // scrypt — and "no such account" would return in a millisecond while a
    // wrong password took 200ms. That difference is an account-enumeration
    // oracle, and it would look identical from the outside.
    const { ABSENT_ACCOUNT_HASH } = await import('./absent-account.js');
    expect(needsRehash(ABSENT_ACCOUNT_HASH)).toBe(false);

    const started = Date.now();
    expect(await verifyPassword('whatever someone typed', ABSENT_ACCOUNT_HASH)).toBe(false);
    const absentCost = Date.now() - started;

    const real = await hashPassword('a real account password');
    const then = Date.now();
    await verifyPassword('whatever someone typed', real);
    const realCost = Date.now() - then;

    // Same order of magnitude is the property that matters, not equality.
    expect(absentCost).toBeGreaterThan(realCost / 4);
  });
});
