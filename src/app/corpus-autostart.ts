import { withAdmin } from '@/db';
import { readEnvironment } from '@/env';
import { claimCorpusStep, readCorpusProgress } from '@/db/corpus';
import { readEffectiveSettings } from '@/settings/store';
import { THREESIXTYGIVING_BASE_URL_KEY } from '@/settings/registry';
import { advanceCorpus } from '@/ingestion/threesixtygiving/corpus';
import { FetchJsonClient } from '@/ingestion/threesixtygiving/http';

/**
 * Keep the grant record filling itself, without anybody being asked to.
 *
 * ## Why this exists
 *
 * The record has to be held locally — 360Giving publish no search across all
 * grants, so there is nothing to query live. That part is forced. What was NOT
 * forced, and was wrong, is that filling it needed an operator: a console, a
 * "Start the walk" button, and an environment variable before the scheduler
 * would even run. An applicant arriving at an empty search was still waiting
 * on somebody else's admin work, which is the exact complaint that started
 * all of this.
 *
 * So the load starts on first use and advances on use. A visit to the grant
 * search is enough; the scheduled job is a backstop for a quiet week, not the
 * only engine. Nothing has to be configured and nothing has to be pressed.
 *
 * ## Why it is safe to hang off a page view
 *
 *  - It runs in `after()`, so it cannot delay the response it was triggered
 *    by. A person looking at the page is never waiting for this.
 *  - `claimCorpusStep` is a database lease: at most one step per interval for
 *    everybody, whoever asked and however often. A hundred visitors in a
 *    minute produce one step.
 *  - A visit-triggered step gets a SHORT deadline. It is a nudge, not a
 *    batch — the long steps belong to the scheduler, which is allowed to take
 *    the whole function.
 *  - It never throws into the caller. A page must not fail because a
 *    background fetch did.
 */

/** A visit is a nudge: short, and often. */
export const VISIT_DEADLINE_MS = 20_000;
export const VISIT_MIN_SECONDS = 90;

/** The scheduler is a batch: long, and rare. */
export const SCHEDULED_DEADLINE_MS = 210_000;
export const SCHEDULED_MIN_SECONDS = 30;

export interface CorpusNudge {
  /** False when the lease was held by somebody else, or the load is done. */
  ran: boolean;
  walked: number;
  awardsWritten: number;
  finished: boolean;
  error: string | null;
}

const IDLE: CorpusNudge = {
  ran: false,
  walked: 0,
  awardsWritten: 0,
  finished: false,
  error: null,
};

/**
 * Advance the corpus if it is this caller's turn.
 *
 * `deadlineMs` and `minSeconds` are what separate a nudge from a batch; the
 * work itself is identical either way.
 */
export async function nudgeCorpus(
  deadlineMs: number,
  minSeconds: number,
): Promise<CorpusNudge> {
  const env = readEnvironment();
  // No database means nowhere to load into, and no point asking 360Giving.
  if (env.databaseUrl === null) return IDLE;

  try {
    const progress = await withAdmin((tx) => readCorpusProgress(tx));
    if (progress.finishedAt !== null) return IDLE;

    const mine = await withAdmin((tx) => claimCorpusStep(tx, minSeconds));
    if (!mine) return IDLE;

    const settings = await withAdmin((tx) => readEffectiveSettings(tx));
    const baseUrl =
      settings.find((s) => s.definition.key === THREESIXTYGIVING_BASE_URL_KEY)?.value ?? '';

    const result = await advanceCorpus(new FetchJsonClient(), (fn) => withAdmin(fn), {
      baseUrl,
      deadlineMs,
    });
    return {
      ran: true,
      walked: result.walked,
      awardsWritten: result.awardsWritten,
      finished: result.finished,
      error: result.error,
    };
  } catch (error) {
    // Logged and swallowed. This is background work behind somebody's page
    // view; it must never become their error.
    console.error('[grantfinderstudio] corpus nudge failed:', error);
    return { ...IDLE, error: error instanceof Error ? error.message : 'unknown' };
  }
}

/**
 * The version a page calls, from inside `after()`.
 *
 * Fire and forget by design: the return value is for tests and for the
 * scheduler, not for a renderer.
 */
export async function nudgeCorpusOnVisit(): Promise<CorpusNudge> {
  return nudgeCorpus(VISIT_DEADLINE_MS, VISIT_MIN_SECONDS);
}
