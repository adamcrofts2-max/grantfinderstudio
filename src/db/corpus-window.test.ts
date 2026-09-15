/**
 * The window in the SQL must be the window in the code.
 *
 * `RECENT_YEARS` bounds the ingest, `/grants` prints the same number in
 * words, and migration 0017 deletes what was stored before the window
 * existed. Three places, one number — and the SQL one cannot read the
 * constant, because a migration is a text file applied once.
 *
 * So it is asserted instead. Changing `RECENT_YEARS` without writing a new
 * migration would otherwise leave the corpus holding a different span from
 * the one every screen claims, with every other test still green.
 */

import { describe, expect, it } from 'vitest';

import { MIGRATION_SQL } from './migrations.generated.js';
import { RECENT_YEARS } from '../domain/grants/recency.js';

describe('migration 0017', () => {
  const sql = MIGRATION_SQL['0017_drop_stale_awards.sql'] ?? '';

  it('is present', () => {
    expect(sql).not.toBe('');
  });

  it('deletes at exactly the RECENT_YEARS boundary', () => {
    const match = /interval '(\d+) years'/u.exec(sql);
    expect(match, 'no year interval found in 0017').not.toBeNull();
    expect(Number(match?.[1])).toBe(RECENT_YEARS);
  });

  it('keeps grants whose award date is unknown', () => {
    // A missing field is not evidence of age. Dropping those rows would lose
    // data for a reason nobody could reconstruct afterwards.
    expect(sql).toContain('awarded_on IS NOT NULL');
  });

  it('touches only the derived corpus', () => {
    // `funder_awards` is a cache of open data and comes back on the next
    // walk. Nothing a tenant typed may be deleted by a migration, ever.
    const deletes = [...sql.matchAll(/DELETE\s+FROM\s+(\w+)/giu)].map((m) => m[1]);
    expect(deletes).toEqual(['funder_awards']);
  });
});
