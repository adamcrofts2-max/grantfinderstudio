import { describe, expect, it } from 'vitest';

import {
  ADMIN_CONSTANTS,
  adminPasswordProblems,
  adminSessionExpiry,
  claimAvailability,
  claimSecretProblem,
} from './admin.js';

describe('admin sessions', () => {
  it('last hours, not the month a customer gets', () => {
    const now = new Date('2026-09-09T09:00:00Z');
    const expiry = adminSessionExpiry(now);
    expect(expiry.toISOString()).toBe('2026-09-09T17:00:00.000Z');
    expect(ADMIN_CONSTANTS.sessionHours).toBeLessThan(24);
  });
});

describe('admin passwords', () => {
  it('demand more length than a customer’s', () => {
    expect(ADMIN_CONSTANTS.minPasswordLength).toBeGreaterThan(10);
  });

  it('report every problem at once', () => {
    const problems = adminPasswordProblems('  ', 'x@y.org');
    expect(problems.length).toBeGreaterThan(1);
  });

  it('accept a long passphrase', () => {
    expect(adminPasswordProblems('correct horse battery staple', 'x@y.org')).toEqual([]);
  });

  it('refuse the address inside the password', () => {
    expect(adminPasswordProblems('admin@example.org-and-more', 'admin@example.org')).toContain(
      'Do not put the email address in the password.',
    );
  });
});

describe('claiming the first admin', () => {
  it('is open on a fresh deployment that has configured a secret', () => {
    expect(claimAvailability({ existingAdmins: 0, secretConfigured: true })).toEqual({
      open: true,
    });
  });

  it('closes for good once an admin exists', () => {
    expect(claimAvailability({ existingAdmins: 1, secretConfigured: true })).toEqual({
      open: false,
      reason: 'already-claimed',
    });
  });

  it('stays shut when no secret is configured, rather than racing strangers', () => {
    expect(claimAvailability({ existingAdmins: 0, secretConfigured: false })).toEqual({
      open: false,
      reason: 'no-secret',
    });
  });

  it('closes on an existing admin even with no secret set', () => {
    // Order matters: "already claimed" is the stronger reason, and reporting
    // "no secret" would invite somebody to set one and try again.
    expect(claimAvailability({ existingAdmins: 2, secretConfigured: false })).toEqual({
      open: false,
      reason: 'already-claimed',
    });
  });
});

describe('the claim secret itself', () => {
  it('is not a problem when unset — that is a different failure', () => {
    expect(claimSecretProblem(null)).toBeNull();
  });

  it('rejects something short enough to guess', () => {
    expect(claimSecretProblem('admin')).toContain('guessable');
  });

  it('accepts a generated one', () => {
    expect(claimSecretProblem('Zx0J9m2QpL7vT4rN8sB6yH1kW3eC5gA=')).toBeNull();
  });
});
