/**
 * Where the corpus load got to. OWNER scope for writes, readable by everyone.
 *
 * The load cannot happen in one request — thousands of funders, published rate
 * limits of 100 funder-list and 1000 grant requests a minute, and a serverless
 * function killed long before that finishes. So it is a sequence of bounded
 * steps and this is the only thing that joins them up.
 */

import type { Queryable } from './client.js';

export interface CorpusProgress {
  cursor: number;
  fundersTotal: number | null;
  fundersDone: number;
  awardsWritten: number;
  fundersUnlicensed: number;
  /** Funders whose record we KNOW is incomplete, because the page cap stopped us. */
  fundersTruncated: number;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  lastOrgId: string | null;
}

const ID = 'corpus';

const EMPTY: CorpusProgress = {
  cursor: 0,
  fundersTotal: null,
  fundersDone: 0,
  awardsWritten: 0,
  fundersUnlicensed: 0,
  fundersTruncated: 0,
  startedAt: null,
  updatedAt: null,
  finishedAt: null,
  lastError: null,
  lastOrgId: null,
};

interface Row {
  cursor: number;
  funders_total: number | null;
  funders_done: number;
  awards_written: number;
  funders_unlicensed: number;
  funders_truncated: number;
  started_at: string | null;
  updated_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  last_org_id: string | null;
}

export async function readCorpusProgress(tx: Queryable): Promise<CorpusProgress> {
  const { rows } = await tx.query<Row>(
    `SELECT cursor, funders_total, funders_done, awards_written, funders_unlicensed,
            funders_truncated, started_at::text, updated_at::text, finished_at::text,
            last_error, last_org_id
       FROM corpus_load WHERE id = $1`,
    [ID],
  );
  const row = rows[0];
  if (row === undefined) return EMPTY;
  return {
    cursor: row.cursor,
    fundersTotal: row.funders_total,
    fundersDone: row.funders_done,
    awardsWritten: row.awards_written,
    fundersUnlicensed: row.funders_unlicensed,
    fundersTruncated: row.funders_truncated,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    lastError: row.last_error,
    lastOrgId: row.last_org_id,
  };
}

/**
 * Begin again from the top. Counters reset; loaded grants do not.
 *
 * `updated_at` is set to NULL rather than `now()`, which the lease reads as
 * "claimable immediately". Setting it to now() made a restart wait out the
 * whole interval before the first step could run — so somebody who had just
 * asked for a re-read watched nothing happen for a minute and a half. A
 * deliberate restart should take effect at once.
 *
 * Deliberately does NOT delete anything: the walk replaces each funder's
 * awards as it reaches them, so the search keeps working all the way through
 * rather than going blank while it refills.
 */
export async function startCorpusLoad(tx: Queryable): Promise<void> {
  await tx.query(
    `INSERT INTO corpus_load
       (id, cursor, funders_total, funders_done, awards_written, funders_unlicensed,
        funders_truncated, started_at, updated_at, finished_at, last_error, last_org_id)
     VALUES ($1, 0, NULL, 0, 0, 0, 0, now(), NULL, NULL, NULL, NULL)
     ON CONFLICT (id) DO UPDATE SET
       cursor = 0, funders_total = NULL, funders_done = 0, awards_written = 0,
       funders_unlicensed = 0, funders_truncated = 0, started_at = now(),
       updated_at = NULL, finished_at = NULL, last_error = NULL, last_org_id = NULL`,
    [ID],
  );
}

export interface CorpusStep {
  cursor: number;
  fundersTotal: number | null;
  fundersDone: number;
  awardsWritten: number;
  fundersUnlicensed: number;
  fundersTruncated: number;
  lastOrgId: string | null;
  finished: boolean;
  /** Null clears a previous failure; a string records this one. */
  error: string | null;
}

/** Record one step's worth of progress, adding to the running totals. */
export async function recordCorpusStep(tx: Queryable, step: CorpusStep): Promise<void> {
  await tx.query(
    `UPDATE corpus_load SET
       cursor = $2,
       funders_total = COALESCE($3, funders_total),
       funders_done = funders_done + $4,
       awards_written = awards_written + $5,
       funders_unlicensed = funders_unlicensed + $6,
       funders_truncated = funders_truncated + $7,
       last_org_id = COALESCE($8, last_org_id),
       finished_at = CASE WHEN $9 THEN now() ELSE NULL END,
       last_error = $10,
       updated_at = now()
     WHERE id = $1`,
    [
      ID,
      step.cursor,
      step.fundersTotal,
      step.fundersDone,
      step.awardsWritten,
      step.fundersUnlicensed,
      step.fundersTruncated,
      step.lastOrgId,
      step.finished,
      step.error,
    ],
  );
}

/**
 * Take the right to run a step, if nobody has run one recently.
 *
 * This is the whole of the concurrency control, and it is also the whole of
 * the abuse control — which is why it is a database write rather than a flag
 * in memory. Steps are triggered by ordinary page visits now, so on a busy
 * minute a hundred people could each start one; and the route that runs them
 * needs no secret, so anybody who finds it could poke it as often as they
 * like. Both come to the same thing: at most one step per interval, decided by
 * Postgres, for everyone.
 *
 * Returns true if this caller may work. It sets `updated_at` BEFORE the work
 * rather than after, so a step that dies still holds the interval off and a
 * crash loop cannot become a request loop.
 *
 * A row that does not exist yet is created and claimed, which is what makes
 * the load start on its own: nobody has to press anything.
 */
export async function claimCorpusStep(
  tx: Queryable,
  minSeconds: number,
): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO corpus_load (id, cursor, funders_done, awards_written,
                              funders_unlicensed, started_at, updated_at)
     VALUES ($1, 0, 0, 0, 0, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       -- Starting on its own, too: a row that exists but was never started
       -- (created by a reset, say) gets its clock set here.
       started_at = COALESCE(corpus_load.started_at, now()),
       updated_at = now()
     WHERE corpus_load.finished_at IS NULL
       AND (corpus_load.updated_at IS NULL
            OR corpus_load.updated_at < now() - make_interval(secs => $2::double precision))
     RETURNING corpus_load.id`,
    [ID, minSeconds],
  );
  return rows.length > 0;
}

/**
 * How much room the grant record is taking, including its indexes.
 *
 * Because the number nobody can guess is the one that decides which database
 * tier this needs — and estimating it from a row count was going to be wrong.
 * The first real run put 10,935 grants in from 16 of 355 funders; extrapolated
 * that is a quarter of a million rows, and three trigram indexes are not free.
 *
 * Null rather than an error when the function is unavailable: this is a
 * diagnostic, and a managed host that withholds `pg_total_relation_size`
 * should not make the progress endpoint fail.
 */
export async function corpusBytes(tx: Queryable): Promise<number | null> {
  try {
    const { rows } = await tx.query<{ bytes: string }>(
      `SELECT (pg_total_relation_size('funder_awards')
             + pg_total_relation_size('funders')
             + pg_total_relation_size('source_datasets'))::text AS bytes`,
    );
    const bytes = Number(rows[0]?.bytes ?? '');
    return Number.isFinite(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

/** True when a load has been started and has not finished. */
export function isLoading(progress: CorpusProgress): boolean {
  return progress.startedAt !== null && progress.finishedAt === null;
}

/** How far through, where the total is known. 0–1, or null. */
export function loadFraction(progress: CorpusProgress): number | null {
  if (progress.fundersTotal === null || progress.fundersTotal <= 0) return null;
  return Math.min(progress.fundersDone / progress.fundersTotal, 1);
}
