import { describe, expect, it } from 'vitest';
import { since } from './since.js';

const NOW = Date.parse('2026-09-17T12:00:00.000Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('since', () => {
  it('reads as a person would say it', () => {
    expect(since(ago(0), NOW)).toBe('just now');
    expect(since(ago(30_000), NOW)).toBe('just now');
    // The boundary, both sides. Under a minute is "just now"; a minute is a
    // minute. The version this replaced rounded first and called thirty
    // seconds "1 minute ago".
    expect(since(ago(MINUTE - 1), NOW)).toBe('just now');
    expect(since(ago(MINUTE), NOW)).toBe('1 minute ago');
    expect(since(ago(5 * MINUTE), NOW)).toBe('5 minutes ago');
    expect(since(ago(2 * HOUR), NOW)).toBe('2 hours ago');
    expect(since(ago(DAY), NOW)).toBe('yesterday');
    expect(since(ago(4 * DAY), NOW)).toBe('4 days ago');
    expect(since(ago(60 * DAY), NOW)).toBe('2 months ago');
  });

  it('accepts what Postgres renders as well as an ISO string', () => {
    // `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` gives the second form;
    // a `::text` timestamptz gives a space and a `+00`, which `new Date()`
    // refuses outright — which is how every stored review's date degraded to
    // the word "earlier" until a browser showed it.
    expect(since('2026-09-17T11:55:00.000Z', NOW)).toBe('5 minutes ago');
    expect(since('2026-09-17 11:55:00.000Z', NOW)).toBe('5 minutes ago');
  });

  it('says "earlier" rather than throwing on something it cannot read', () => {
    expect(since('not a date', NOW)).toBe('earlier');
    expect(since('', NOW)).toBe('earlier');
  });

  it('rounds a future timestamp to now rather than counting forwards', () => {
    // The database's clock and the renderer's are not the same clock, and "in
    // 2 minutes" about something that has already happened reads as a bug.
    expect(since(new Date(NOW + 2 * MINUTE).toISOString(), NOW)).toBe('just now');
  });
});
