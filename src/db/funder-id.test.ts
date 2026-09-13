/**
 * One funder, one row — however somebody arrives at it.
 *
 * A funder can now be met three ways: enriched by the console ingest, found
 * through the corpus search, or typed in by name. The first two carry a
 * 360Giving organisation id and must land on the SAME row, or an applicant's
 * award history and the application built from it end up joined to nothing.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { funderIdFor360Giving } from './awards.js';
import { ensureFunderNamed, ensureFunderWithId, findFunderById } from './catalogue.js';
import { createTestDatabase, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;
const tx = (): Queryable => harness.db as unknown as Queryable;

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
});

afterEach(async () => {
  await harness.close();
});

describe('a funder met through the corpus search', () => {
  const orgId = 'GB-CHC-1164883';

  it('is created under the id the ingest would use', async () => {
    const id = funderIdFor360Giving(orgId);
    await ensureFunderWithId(tx(), id, 'The Somerset Trust');
    expect((await findFunderById(tx(), id))?.name).toBe('The Somerset Trust');
  });

  it('is the same row when the same funder is met twice', async () => {
    const id = funderIdFor360Giving(orgId);
    await ensureFunderWithId(tx(), id, 'The Somerset Trust');
    await ensureFunderWithId(tx(), id, 'Somerset Trust (renamed)');

    // By id, not a global count: the harness seeds fixture funders of its own.
    const { rows } = await harness.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM funders WHERE id = $1',
      [id],
    );
    expect(rows[0]?.n).toBe(1);
    // The first name stands: the row is keyed on identity, and a search
    // result's label is not a reason to rewrite what an ingest recorded.
    expect((await findFunderById(tx(), id))?.name).toBe('The Somerset Trust');
  });

  it('would have been a SECOND row through the name-based creator', async () => {
    // The bug this exists to prevent. `ensureFunderNamed` appends a random
    // suffix to whatever prefix it is given, so handing it the deterministic
    // id produces something else entirely — and the next ingest of the same
    // funder writes its awards to the id this row does not have.
    const id = funderIdFor360Giving(orgId);
    const invented = await ensureFunderNamed(tx(), 'The Somerset Trust', id);
    expect(invented).not.toBe(id);
    expect(await findFunderById(tx(), id)).toBeNull();
  });
});
