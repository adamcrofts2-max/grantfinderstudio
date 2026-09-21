/**
 * The two clocks, against the real schema.
 *
 * `updated_at` is written by the lease before the work, so it answers "was a
 * step attempted". `progressed_at` (0026) is written only when a step read a
 * funder or wrote a grant, so it answers "is the load moving". Everything the
 * applicant's search screen and the console say about the record rests on the
 * difference, so it is asserted here rather than inferred from the SQL.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import {
  claimCorpusStep,
  corpusStanding,
  readCorpusProgress,
  recordCorpusStep,
  startCorpusLoad,
} from './corpus.js';
import { createTestDatabase, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;
const tx = (): Queryable => harness.db as unknown as Queryable;

const step = (over: Partial<Parameters<typeof recordCorpusStep>[1]> = {}) =>
  recordCorpusStep(tx(), {
    cursor: 3,
    fundersTotal: 200,
    fundersDone: 0,
    awardsWritten: 0,
    fundersUnlicensed: 0,
    fundersTruncated: 0,
    awardsDiscarded: 0,
    failedOrgIds: [],
    lastOrgId: null,
    finished: false,
    error: null,
    ...over,
  });

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
  await startCorpusLoad(tx());
});

afterEach(async () => {
  await harness.close();
});

describe('the progress clock', () => {
  it('is empty on a fresh load, and reads as filling until it goes quiet', async () => {
    // Nothing has progressed yet, but the load began a moment ago and its
    // first step is in flight. The start itself is the last thing that
    // happened, so it is the clock to reason from.
    const progress = await readCorpusProgress(tx());
    expect(progress.startedAt).not.toBeNull();
    expect(progress.progressedAt).toBeNull();
    expect(progress.updatedAt).toBeNull();
    expect(corpusStanding(progress, new Date())).toBe('filling');
    // Two days on with still nothing behind it, it is what it is.
    const later = new Date(Date.now() + 48 * 60 * 60 * 1000);
    expect(corpusStanding(progress, later)).toBe('stalled');
  });

  it('does not move when a step read nothing', async () => {
    await claimCorpusStep(tx(), 0);
    await step({ fundersDone: 0, awardsWritten: 0, error: 'the API timed out' });
    const progress = await readCorpusProgress(tx());
    // Attempted — the lease says so — and no progress behind it.
    expect(progress.updatedAt).not.toBeNull();
    expect(progress.progressedAt).toBeNull();
    expect(progress.lastError).toBe('the API timed out');
  });

  it('moves when a funder was read', async () => {
    await claimCorpusStep(tx(), 0);
    await step({ fundersDone: 4, awardsWritten: 0 });
    const progress = await readCorpusProgress(tx());
    expect(progress.progressedAt).not.toBeNull();
    expect(corpusStanding(progress, new Date())).toBe('filling');
  });

  it('moves when grants were written even if no funder finished', async () => {
    await claimCorpusStep(tx(), 0);
    await step({ fundersDone: 0, awardsWritten: 120 });
    expect((await readCorpusProgress(tx())).progressedAt).not.toBeNull();
  });

  it('keeps the last progress when a later step reads nothing', async () => {
    await claimCorpusStep(tx(), 0);
    await step({ fundersDone: 4 });
    const moved = (await readCorpusProgress(tx())).progressedAt;

    await claimCorpusStep(tx(), 0);
    await step({ fundersDone: 0, awardsWritten: 0, error: 'still timing out' });
    const after = await readCorpusProgress(tx());

    // THE WHOLE POINT: the attempt is fresh, the progress is not.
    expect(after.progressedAt).toBe(moved);
    expect(after.updatedAt).not.toBe(moved);
  });

  it('clears on a restart, like every other counter', async () => {
    await claimCorpusStep(tx(), 0);
    await step({ fundersDone: 4 });
    await startCorpusLoad(tx());
    expect((await readCorpusProgress(tx())).progressedAt).toBeNull();
  });

  it('emits timestamps `new Date()` accepts', async () => {
    // `::text` renders a timestamptz with a +00 offset that some engines
    // refuse, and these go out over /api/corpus as well as being parsed by
    // `corpusStanding`.
    await claimCorpusStep(tx(), 0);
    await step({ fundersDone: 1 });
    const progress = await readCorpusProgress(tx());
    for (const stamp of [progress.startedAt, progress.updatedAt, progress.progressedAt]) {
      expect(stamp).toMatch(/Z$/u);
      expect(Number.isNaN(Date.parse(stamp ?? ''))).toBe(false);
    }
  });
});
