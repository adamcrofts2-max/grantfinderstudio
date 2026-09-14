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
  started_at: string | null;
  updated_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  last_org_id: string | null;
}

export async function readCorpusProgress(tx: Queryable): Promise<CorpusProgress> {
  const { rows } = await tx.query<Row>(
    `SELECT cursor, funders_total, funders_done, awards_written, funders_unlicensed,
            started_at::text, updated_at::text, finished_at::text, last_error, last_org_id
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
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    lastError: row.last_error,
    lastOrgId: row.last_org_id,
  };
}

/** Begin, or begin again from the top. Counters reset; loaded grants do not. */
export async function startCorpusLoad(tx: Queryable): Promise<void> {
  // Deliberately does NOT delete anything. A restart re-walks the funder list
  // and replaces each funder's awards as it reaches them, so the corpus stays
  // searchable throughout rather than emptying for an hour.
  await tx.query(
    `INSERT INTO corpus_load
       (id, cursor, funders_total, funders_done, awards_written, funders_unlicensed,
        started_at, updated_at, finished_at, last_error, last_org_id)
     VALUES ($1, 0, NULL, 0, 0, 0, now(), now(), NULL, NULL, NULL)
     ON CONFLICT (id) DO UPDATE SET
       cursor = 0, funders_total = NULL, funders_done = 0, awards_written = 0,
       funders_unlicensed = 0, started_at = now(), updated_at = now(),
       finished_at = NULL, last_error = NULL, last_org_id = NULL`,
    [ID],
  );
}

export interface CorpusStep {
  cursor: number;
  fundersTotal: number | null;
  fundersDone: number;
  awardsWritten: number;
  fundersUnlicensed: number;
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
       last_org_id = COALESCE($7, last_org_id),
       finished_at = CASE WHEN $8 THEN now() ELSE NULL END,
       last_error = $9,
       updated_at = now()
     WHERE id = $1`,
    [
      ID,
      step.cursor,
      step.fundersTotal,
      step.fundersDone,
      step.awardsWritten,
      step.fundersUnlicensed,
      step.lastOrgId,
      step.finished,
      step.error,
    ],
  );
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
