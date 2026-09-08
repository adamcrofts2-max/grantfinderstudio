import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_CONSTANTS,
  isExpired,
  isPlausibleEmail,
  normaliseEmail,
  passwordProblems,
  sessionExpiry,
} from './account.js';

describe('normaliseEmail', () => {
  it('folds case and trims, because that is how mail works', () => {
    expect(normaliseEmail('  Jo@Example.ORG ')).toBe('jo@example.org');
  });

  it('leaves the local part otherwise alone', () => {
    // Stripping dots or +tags is a guess about one provider's routing, and
    // guessing wrong merges two real people's accounts.
    expect(normaliseEmail('first.last+grants@example.org')).toBe('first.last+grants@example.org');
  });
});

describe('isPlausibleEmail', () => {
  it('accepts ordinary addresses', () => {
    for (const email of ['jo@example.org', 'a@b.co', "o'brien@example.co.uk"]) {
      expect(isPlausibleEmail(email), email).toBe(true);
    }
  });

  it('rejects the typo and the empty box', () => {
    for (const email of ['', 'jo', 'jo@', '@example.org', 'jo@example', 'jo @example.org',
                         'jo@@example.org', 'jo@.org', 'jo@example.']) {
      expect(isPlausibleEmail(email), email).toBe(false);
    }
  });

  it('rejects an address too long to store', () => {
    expect(isPlausibleEmail(`${'a'.repeat(250)}@example.org`)).toBe(false);
  });
});

describe('passwordProblems', () => {
  it('accepts a long passphrase with no symbols in it', () => {
    // The point of dropping composition rules: this is a good password.
    expect(passwordProblems('correct horse battery staple', 'jo@example.org')).toEqual([]);
  });

  it('rejects a short one, however clever', () => {
    expect(passwordProblems('P@ssw0rd!', 'jo@example.org')).toHaveLength(1);
  });

  it('reports every problem at once', () => {
    // Making someone resubmit to discover the next rule is how you get
    // people typing their old password with a 1 on the end.
    const problems = passwordProblems('a@b.co', 'a@b.co');
    expect(problems).toHaveLength(2); // too short, and it is the address
  });

  it('catches the email hidden in the password whatever the case', () => {
    const problems = passwordProblems('xxJO@EXAMPLE.ORGxx', 'jo@example.org');
    expect(problems.some((p) => p.includes('email address'))).toBe(true);
  });

  it('does not count spaces towards the length', () => {
    expect(passwordProblems('              ', 'jo@example.org')).toContain(
      'A password of only spaces is not a password.',
    );
  });

  it('bounds the work it will do', () => {
    const problems = passwordProblems('a'.repeat(500), 'jo@example.org');
    expect(problems.some((p) => p.includes('under'))).toBe(true);
  });
});

describe('sessions', () => {
  it('expires the configured number of days out', () => {
    const now = new Date('2026-09-08T10:00:00Z');
    expect(sessionExpiry(now).toISOString()).toBe(
      new Date('2026-10-08T10:00:00Z').toISOString(),
    );
    expect(ACCOUNT_CONSTANTS.sessionDays).toBe(30);
  });

  it('treats the moment of expiry as expired', () => {
    const at = new Date('2026-09-08T10:00:00Z');
    expect(isExpired(at, at)).toBe(true);
    expect(isExpired(at, new Date('2026-09-08T09:59:59Z'))).toBe(false);
  });
});
