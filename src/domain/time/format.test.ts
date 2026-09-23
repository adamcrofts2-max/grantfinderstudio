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
