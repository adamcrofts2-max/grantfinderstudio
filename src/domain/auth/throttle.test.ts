import { describe, expect, it } from 'vitest';

import {
  describeWait,
  isBlocked,
  recordFailure,
  retryAfterSeconds,
  THROTTLE,
  windowExpired,
  type AttemptRecord,
} from './throttle.js';

const NOW = new Date('2026-09-08T12:00:00Z');
const policy = { maxAttempts: 3, windowSeconds: 600 };
const at = (record: Partial<AttemptRecord> = {}): AttemptRecord => ({
  attempts: 1,
  windowStartedAt: NOW,
  ...record,
});
const plus = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

describe('isBlocked', () => {
  it('lets a first attempt through', () => {
    expect(isBlocked(null, NOW, policy)).toBe(false);
  });

  it('lets attempts through up to the limit, and refuses the one past it', () => {
    expect(isBlocked(at({ attempts: 2 }), NOW, policy)).toBe(false);
    expect(isBlocked(at({ attempts: 3 }), NOW, policy)).toBe(true);
  });

  it('forgets once the window has passed', () => {
    // Self-healing rather than a lockout: nobody has to be asked to lift it.
    expect(isBlocked(at({ attempts: 99 }), plus(600), policy)).toBe(false);
    expect(isBlocked(at({ attempts: 99 }), plus(599), policy)).toBe(true);
  });
});

describe('recordFailure', () => {
  it('opens a window on the first failure', () => {
    expect(recordFailure(null, NOW, policy)).toEqual({ attempts: 1, windowStartedAt: NOW });
  });

  it('counts up within a window without moving its start', () => {
    // Moving the start on every failure would make the window slide forever
    // under sustained load, and it would never lapse.
    const next = recordFailure(at({ attempts: 2 }), plus(120), policy);
    expect(next).toEqual({ attempts: 3, windowStartedAt: NOW });
  });

  it('starts fresh once the old window has lapsed', () => {
    // Someone who mistypes twice a month must never accumulate into a ban.
    expect(recordFailure(at({ attempts: 9 }), plus(601), policy)).toEqual({
      attempts: 1,
      windowStartedAt: plus(601),
    });
  });
});

describe('retryAfterSeconds', () => {
  it('counts down to the end of the window', () => {
    expect(retryAfterSeconds(at(), NOW, policy)).toBe(600);
    expect(retryAfterSeconds(at(), plus(540), policy)).toBe(60);
  });

  it('is zero once the window has gone', () => {
    expect(retryAfterSeconds(at(), plus(600), policy)).toBe(0);
    expect(retryAfterSeconds(at(), plus(9999), policy)).toBe(0);
  });
});

describe('windowExpired', () => {
  it('treats the exact boundary as expired', () => {
    expect(windowExpired(at(), plus(600), policy)).toBe(true);
    expect(windowExpired(at(), plus(599), policy)).toBe(false);
  });
});

describe('describeWait', () => {
  it('reads naturally at both scales', () => {
    expect(describeWait(1)).toBe('1 second');
    expect(describeWait(45)).toBe('45 seconds');
    expect(describeWait(120)).toBe('2 minutes');
    expect(describeWait(601)).toBe('11 minutes');
  });

  it('never says zero, which would read as "try again now"', () => {
    expect(describeWait(0)).toBe('1 second');
  });
});

describe('the shipped policies', () => {
  it('are stricter per address than per origin', () => {
    // An office, a school or anyone behind carrier-grade NAT shares an origin.
    // Locking out a whole building is its own outage.
    expect(THROTTLE.address.maxAttempts).toBeLessThan(THROTTLE.origin.maxAttempts);
  });

  it('heal on their own within the hour', () => {
    for (const p of [THROTTLE.address, THROTTLE.origin]) {
      expect(p.windowSeconds).toBeLessThanOrEqual(3600);
    }
  });
});
