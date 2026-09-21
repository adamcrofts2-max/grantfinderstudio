import { describe, expect, it } from 'vitest';
import {
  daysLeft,
  isNewVisit,
  isShareLength,
  refusalMessage,
  SHARE_DAYS,
  SHARE_LENGTHS,
  shareExpiry,
  shareStanding,
  VISIT_GAP_MINUTES,
} from './share.js';

const NOW = new Date('2026-09-21T12:00:00.000Z');
const inDays = (n: number): string =>
  new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000).toISOString();

describe('whether a review link still works', () => {
  it('is live until its expiry passes', () => {
    expect(shareStanding({ expiresAt: inDays(1), revokedAt: null }, NOW)).toBe('live');
    expect(shareStanding({ expiresAt: inDays(-1), revokedAt: null }, NOW)).toBe('expired');
  });

  it('counts the moment of expiry as expired', () => {
    // A link that works at exactly its expiry is a link whose expiry is a
    // suggestion. The boundary belongs to the refusal.
    expect(shareStanding({ expiresAt: NOW.toISOString(), revokedAt: null }, NOW)).toBe('expired');
  });

  it('says revoked rather than expired when it was withdrawn', () => {
    // Somebody who withdrew access should be told that is what happened, not
    // that the clock ran out — it is their own record of what they did.
    const withdrawn = { expiresAt: inDays(-3), revokedAt: inDays(-5) };
    expect(shareStanding(withdrawn, NOW)).toBe('revoked');
  });

  /**
   * A date nobody can parse is a share nobody can reason about, and the safe
   * reading of "I cannot tell whether this is still allowed" is no.
   */
  it('refuses a share whose expiry cannot be read', () => {
    expect(shareStanding({ expiresAt: 'sometime', revokedAt: null }, NOW)).toBe('revoked');
    expect(shareStanding({ expiresAt: '', revokedAt: null }, NOW)).toBe('revoked');
  });
});

describe('how long is left', () => {
  it('rounds up, so nine hours left is one day', () => {
    // "Expires today" is what somebody needs to hear; rounding down would say
    // nothing is left of a link that still works.
    expect(daysLeft({ expiresAt: inDays(0.375), revokedAt: null }, NOW)).toBe(1);
    expect(daysLeft({ expiresAt: inDays(6.2), revokedAt: null }, NOW)).toBe(7);
  });

  it('is zero once it has gone, whichever way', () => {
    expect(daysLeft({ expiresAt: inDays(-1), revokedAt: null }, NOW)).toBe(0);
    expect(daysLeft({ expiresAt: inDays(5), revokedAt: inDays(-1) }, NOW)).toBe(0);
  });
});

describe('choosing how long it lasts', () => {
  it('offers a few lengths and no unlimited option', () => {
    // A link that works forever is a copy of the data handed out, and nobody
    // revokes a link they have forgotten about.
    expect(SHARE_LENGTHS).toContain(SHARE_DAYS);
    expect(SHARE_LENGTHS.every((d) => d > 0 && d <= 31)).toBe(true);
    expect(isShareLength(0)).toBe(false);
    expect(isShareLength(365)).toBe(false);
    expect(isShareLength('14')).toBe(false);
  });

  it('falls back to the default rather than trusting a posted number', () => {
    // The length arrives from a form. Anything not on the list is the default,
    // not an error and certainly not honoured.
    expect(shareExpiry(NOW, 9_999).toISOString()).toBe(shareExpiry(NOW).toISOString());
    expect(shareExpiry(NOW, 7).toISOString()).toBe(inDays(7));
    expect(shareExpiry(NOW).toISOString()).toBe(inDays(SHARE_DAYS));
  });
});

describe('what a dead link says', () => {
  it('says which refusal it was, and what to do next', () => {
    expect(refusalMessage('revoked')).toMatch(/withdrawn/iu);
    expect(refusalMessage('expired')).toMatch(/expired/iu);
    for (const standing of ['revoked', 'expired'] as const) {
      expect(refusalMessage(standing)).toMatch(/new one/iu);
    }
  });

  it('never names the organisation or the application', () => {
    // Whoever is holding a dead link may not be the person it was sent to.
    for (const standing of ['revoked', 'expired'] as const) {
      expect(refusalMessage(standing)).not.toMatch(/application|organisation|fund/iu);
    }
  });
});

describe('what counts as a visit', () => {
  const at = (minutes: number): string =>
    new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();

  it('counts a first read', () => {
    expect(isNewVisit(null, NOW)).toBe(true);
  });

  it('does not count a reload as a second visit', () => {
    // Eleven reloads while reading are eleven views on the share row and one
    // line in a forty-line trail. The alternative pushes the application's
    // own history off the bottom of the screen.
    expect(isNewVisit(at(0), NOW)).toBe(false);
    expect(isNewVisit(at(VISIT_GAP_MINUTES - 1), NOW)).toBe(false);
  });

  it('counts coming back to it', () => {
    expect(isNewVisit(at(VISIT_GAP_MINUTES), NOW)).toBe(true);
    expect(isNewVisit(at(60 * 24), NOW)).toBe(true);
  });

  it('records rather than swallows when the time cannot be read', () => {
    // A line too many in an audit trail is a smaller fault than a missing one.
    expect(isNewVisit('not a date', NOW)).toBe(true);
  });
});
