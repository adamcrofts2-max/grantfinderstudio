/**
 * The filter vocabulary, with no database in sight.
 *
 * Every rule here is a product decision that can be argued about in one line,
 * which is exactly why it lives away from the SQL.
 */

import { describe, expect, it } from 'vitest';

import {
  AMOUNT_BANDS,
  NO_FILTERS,
  bandFor,
  bandsAroundAsk,
  filterCount,
  filtersFromParams,
  filtersToParams,
  hasFilters,
  isActive,
  toggle,
  without,
} from './facets.js';

describe('amount bands', () => {
  it('cover every amount with no gap and no overlap', () => {
    // A grant in two bands makes every count wrong; a grant in none makes it
    // unreachable. Both are silent faults, so they are asserted rather than
    // eyeballed.
    for (const amount of [0, 1, 4_999, 5_000, 24_999, 25_000, 99_999, 100_000, 499_999, 500_000, 9_000_000]) {
      const matching = AMOUNT_BANDS.filter(
        (band) => amount >= band.min && (band.max === null || amount < band.max),
      );
      expect(matching, `£${amount}`).toHaveLength(1);
      expect(bandFor(amount)).toBe(matching[0]);
    }
  });

  it('put a boundary in the upper band', () => {
    expect(bandFor(5_000)?.id).toBe('5k-25k');
    expect(bandFor(4_999)?.id).toBe('under5k');
  });

  it('have no band above the last one', () => {
    expect(AMOUNT_BANDS.at(-1)?.max).toBeNull();
  });
});

describe('a band around what they need', () => {
  it('spans half to double the ask', () => {
    // £8,000 is worth reading for a CIC asking £15,000; £400,000 is not.
    const around = bandsAroundAsk(15_000);
    expect(around).toContain('5k-25k');
    expect(around).toContain('25k-100k');
    expect(around).not.toContain('over500k');
  });

  it('is empty when nobody has said what they need', () => {
    expect(bandsAroundAsk(null)).toEqual([]);
    expect(bandsAroundAsk(0)).toEqual([]);
  });

  it('reaches the open-ended band for a large ask', () => {
    expect(bandsAroundAsk(400_000)).toContain('over500k');
  });
});

describe('reading filters off the URL', () => {
  it('reads every dimension', () => {
    const filters = filtersFromParams({
      amount: '5k-25k~25k-100k',
      since: '2y',
      place: 'Somerset',
      topic: 'Young people~Heritage',
    });
    expect(filters.bands).toEqual(['5k-25k', '25k-100k']);
    expect(filters.since).toBe('2y');
    expect(filters.places).toEqual(['Somerset']);
    expect(filters.topics).toEqual(['Young people', 'Heritage']);
  });

  it('drops ids it does not recognise rather than failing', () => {
    // A link shared last month should show something useful, not an error
    // about a band that was renamed since.
    const filters = filtersFromParams({ amount: 'made-up~5k-25k', since: 'never' });
    expect(filters.bands).toEqual(['5k-25k']);
    expect(filters.since).toBeNull();
  });

  it('is empty for an empty query string', () => {
    expect(filtersFromParams({})).toEqual(NO_FILTERS);
    expect(hasFilters(filtersFromParams({}))).toBe(false);
  });

  it('survives a repeated parameter', () => {
    expect(filtersFromParams({ place: ['Somerset', 'Devon'] }).places).toEqual([
      'Somerset',
      'Devon',
    ]);
  });

  it('caps how many values one dimension may carry', () => {
    // A hand-written URL with two hundred places in it would build a query
    // with two hundred LIKE clauses.
    const many = Array.from({ length: 50 }, (_, i) => `place${i}`).join('~');
    expect(filtersFromParams({ place: many }).places.length).toBeLessThanOrEqual(6);
  });

  it('round-trips through the query string', () => {
    const filters = filtersFromParams({
      amount: '5k-25k',
      since: '5y',
      place: 'Devon',
      topic: 'Heritage',
    });
    expect(filtersFromParams(filtersToParams(filters))).toEqual(filters);
  });

  it('writes nothing for an empty filter set', () => {
    expect(filtersToParams(NO_FILTERS)).toEqual({});
  });
});

describe('toggling', () => {
  it('adds then removes', () => {
    const once = toggle(NO_FILTERS, 'place', 'Devon');
    expect(isActive(once, 'place', 'Devon')).toBe(true);
    expect(isActive(toggle(once, 'place', 'Devon'), 'place', 'Devon')).toBe(false);
  });

  it('accumulates within a dimension', () => {
    const two = toggle(toggle(NO_FILTERS, 'amount', '5k-25k'), 'amount', '25k-100k');
    expect(two.bands).toEqual(['5k-25k', '25k-100k']);
  });

  it('replaces rather than accumulates for recency', () => {
    // "Gave in the last 2 years" and "in the last 5" are not two filters, they
    // are one answer. Holding both would mean the wider one silently winning.
    const first = toggle(NO_FILTERS, 'since', '2y');
    const second = toggle(first, 'since', '5y');
    expect(second.since).toBe('5y');
    expect(toggle(second, 'since', '5y').since).toBeNull();
  });

  it('counts the choices in force', () => {
    const filters = filtersFromParams({ amount: '5k-25k~25k-100k', since: '2y', place: 'Devon' });
    expect(filterCount(filters)).toBe(4);
  });
});

describe('releasing one dimension', () => {
  it('clears only that dimension', () => {
    // How a count is made honest: an option's count is computed with every
    // OTHER dimension applied and its own released.
    const filters = filtersFromParams({ amount: '5k-25k', place: 'Devon', since: '2y' });
    const released = without(filters, 'amount');
    expect(released.bands).toEqual([]);
    expect(released.places).toEqual(['Devon']);
    expect(released.since).toBe('2y');
  });
});
