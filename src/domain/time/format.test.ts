import { describe, expect, it } from 'vitest';

import { formatDate } from './format.js';

describe('formatDate', () => {
  it('writes a date the way a sentence wants it', () => {
    expect(formatDate('2026-09-23')).toBe('23 September 2026');
    expect(formatDate('2026-01-05')).toBe('5 January 2026');
  });

  it('reads a timestamp by its date', () => {
    expect(formatDate('2026-09-23T14:05:00Z')).toBe('23 September 2026');
  });

  it('hands back anything it cannot read, rather than inventing a date', () => {
    expect(formatDate('not a date')).toBe('not a date');
    expect(formatDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('formatDate with the weekday', () => {
  it('names the day, in the same form as every other date', () => {
    expect(formatDate('2026-11-01', { weekday: true })).toBe('Sunday 1 November 2026');
    expect(formatDate('2026-11-02', { weekday: true })).toBe('Monday 2 November 2026');
  });

  it('does not move the day with the server’s time zone', () => {
    // 1 January 2027 is a Friday wherever the server happens to be.
    expect(formatDate('2027-01-01', { weekday: true })).toBe('Friday 1 January 2027');
  });
});

