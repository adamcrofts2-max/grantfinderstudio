/**
 * Assembling the grant corpus locally, one bounded step at a time.
 *
 * ## Why the corpus is held rather than queried
 *
 * 360Giving's published API has no text search. `org/` and `org/funder/`
 * declare no filter backends at all, so `?search=` on them is silently
 * ignored; the two grant routes take a funder or recipient id and nothing
 * else. The all-grants search that would have made a live query possible
 * (`/api/experimental/CurrentLatestGrants`) is in their source and 404s on the
 * live host — it sits beside `control/trigger-datagetter`, so the whole
 * non-`v1` tree appears to be internal.
 *
 * Their own advice to developers is to store the data locally. That is what
 * this does, using only documented endpoints: walk `org/funder/` for the
 * names, then `org/{id}/grants_made/` for each one's awards. The search then
 * runs in Postgres, instantly, and no route can 404 it.
 *
 * ## Why it is a sequence of steps
 *
 * There are thousands of funders. 360Giving allow 100 funder-list requests a
 * minute and 1000 grant requests a minute, and a serverless function is killed
 * long before a full walk finishes. So each call does a bounded slice, records
 * where it reached, and returns; something calls it again. A step that dies
 * leaves the cursor where it was and the next step redoes that funder — which
 * is safe, because re-ingesting a funder replaces its awards.
 *
 * ## Only the last three years are kept
 *
 * `RECENT_YEARS`. 360Giving publish about a quarter of a million grants, which
 * measured at roughly 420 MB held locally — larger than any free managed
 * Postgres tier. Three years is about a quarter of the rows and still leaves
 * almost every active funder with enough awards to characterise.
 *
 * This saves STORAGE and NOT fetch time, and the difference matters. Their API
 * declares no filter fields on either grant route, so there is no `?since=`:
 * every grant a funder ever published is downloaded either way, read, and the
 * old ones dropped here. Anybody reading this looking for a speed-up should
 * look at step chaining instead.
 *
 * ## The licence rule is not relaxed
 *
 * The per-funder ingest refuses to run without a licence and an attribution,
 * supplied by the person doing it. Nobody can supply that for thousands of
 * funders, so here the licence is read from the grants themselves —
 * `data_license` on the v1 routes — and a funder whose grants state none is
 * SKIPPED and counted. Refusing unlicensed data is still the rule; what
 * changes is who states the licence, not whether one is required.
 */

import { ThreeSixtyGivingConnector, IngestionError, type HttpClient } from './connector.js';
import { datasetIdFor } from './ingest.js';
import type { SourceDataset } from './types.js';
import {
  funderIdFor360Giving,
  replaceFunderAwards,
  upsertFunder,
  upsertSourceDataset,
} from '../../db/awards.js';
import {
  readCorpusProgress,
  recordCorpusStep,
  type CorpusProgress,
} from '../../db/corpus.js';
import type { Queryable } from '../../db/client.js';
import { RECENT_YEARS, keepRecent } from '../../domain/grants/recency.js';

export interface CorpusStepOptions {
  /**
   * How long a step may run for, in milliseconds.
   *
   * TIME, not a funder count, and that is the important choice. A count has to
   * be guessed against the slowest publisher in the list: pick eight and a step
   * finishes in two seconds for most funders and times out on the one with
   * fifty pages of history. A deadline does as much as the request has room
   * for, whatever it meets, and stops cleanly — which is the only bound a
   * serverless function actually has.
   *
   * Default 210s, comfortably inside a 300s function and leaving room for the
   * final write.
   */
  deadlineMs?: number;
  /** A hard ceiling as well, so a fast run cannot walk the whole list at once. */
  maxFunders?: number;
  /** How many funders to ask the list for at a time. */
  pageSize?: number;
  /**
   * Pages of grants per funder, at 100 grants a page.
   *
   * Was 20 — two thousand grants — and the connector's `truncated` flag was
   * returned and then dropped. So the biggest funders in the corpus, the ones
   * that matter most, had their records silently cut short, and every figure
   * drawn from them was wrong: the median, the quartiles, "6 grants like
   * yours", the range. Quietly wrong, which is the only kind that matters.
   *
   * 300 pages is 30,000 grants, which covers all but the very largest
   * publishers, and 300 requests is well inside their 1,000-a-minute limit.
   * A cap still has to exist or one enormous publisher eats a whole step —
   * but it is COUNTED now, so it can never be silent again.
   */
  maxPagesPerFunder?: number;
  baseUrl?: string;
  now?: () => Date;
  /** Injectable clock for the deadline, so a test need not wait for one. */
  elapsed?: () => number;
  /**
   * Years of grant history to keep. Defaults to `RECENT_YEARS`.
   *
   * Settable only so a test can state the window it is testing rather than
   * computing dates three years back from whenever it runs.
   */
  recentYears?: number;
}

export interface CorpusStepResult {
  progress: CorpusProgress;
  /** Funders actually walked this step. */
  walked: number;
  awardsWritten: number;
  unlicensed: number;
  /** Funders whose record we know is incomplete. Never silent. */
  truncated: number;
  /** Grants fetched and dropped for falling outside the window. Never silent. */
  discarded: number;
  /**
   * Funders that threw, by org id. Never silent either.
   *
   * This was the last uncounted way for the corpus to be missing something.
   * A failure set `error` — one slot, overwritten by the next failure and
   * cleared by the next success — so a step could lose several publishers and
   * report nothing. Walking the product found three of them missing behind a
   * panel reading "42 of 42 — 100%".
   */
  failedOrgIds: string[];
  finished: boolean;
  error: string | null;
}

const DEFAULT_DEADLINE_MS = 210_000;
const DEFAULT_MAX_FUNDERS = 400;
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES_PER_FUNDER = 300;

/**
 * One step of the load. Fetches outside transactions, writes inside them.
 *
 * Bounded by TIME first. A funder count has to be guessed against the slowest
 * publisher in the list: pick eight and most steps finish in two seconds and
 * the one with fifty pages of history times out. A deadline does as much as
 * the request has room for, whatever it meets, and stops cleanly.
 *
 * Each funder is written in its OWN transaction, so a step that runs out of
 * time keeps every funder it already finished. One transaction round the whole
 * step would throw away good work on one publisher's bad row.
 */
export async function advanceCorpus(
  http: HttpClient,
  runInTransaction: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>,
  options: CorpusStepOptions = {},
): Promise<CorpusStepResult> {
  const deadlineMs = Math.max(options.deadlineMs ?? DEFAULT_DEADLINE_MS, 1);
  const maxFunders = Math.max(options.maxFunders ?? DEFAULT_MAX_FUNDERS, 1);
  const pageSize = Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1);
  const now = options.now ?? (() => new Date());
  const recentYears = Math.max(options.recentYears ?? RECENT_YEARS, 1);
  const startedAt = Date.now();
  const elapsed = options.elapsed ?? (() => Date.now() - startedAt);

  const connector = new ThreeSixtyGivingConnector(http, {
    maxPages: options.maxPagesPerFunder ?? DEFAULT_MAX_PAGES_PER_FUNDER,
    ...(options.baseUrl !== undefined && options.baseUrl !== ''
      ? { baseUrl: options.baseUrl }
      : {}),
  });

  const before = await runInTransaction((tx) => readCorpusProgress(tx));

  let cursor = before.cursor;
  let fundersTotal = before.fundersTotal;
  let awardsWritten = 0;
  let unlicensed = 0;
  let truncated = 0;
  let discarded = 0;
  const failedOrgIds: string[] = [];
  let walked = 0;
  let lastOrgId: string | null = null;
  let error: string | null = null;
  let finished = false;

  const record = async (): Promise<CorpusStepResult> => {
    await runInTransaction((tx) =>
      recordCorpusStep(tx, {
        cursor,
        fundersTotal,
        fundersDone: walked,
        awardsWritten,
        fundersUnlicensed: unlicensed,
        fundersTruncated: truncated,
        awardsDiscarded: discarded,
        failedOrgIds,
        lastOrgId,
        finished,
        error,
      }),
    );
    return {
      progress: await runInTransaction((tx) => readCorpusProgress(tx)),
      walked,
      awardsWritten,
      unlicensed,
      truncated,
      discarded,
      failedOrgIds,
      finished,
      error,
    };
  };

  while (elapsed() < deadlineMs && walked < maxFunders) {
    let page: Awaited<ReturnType<typeof connector.fetchFunderPage>>;
    try {
      // eslint-disable-next-line no-await-in-loop
      page = await connector.fetchFunderPage(cursor, pageSize);
    } catch (caught) {
      // The funder list failing is different from one publisher failing: there
      // is nothing to walk, so the step stops here with the cursor unmoved.
      error =
        caught instanceof Error ? caught.message : 'The funder list could not be read.';
      // eslint-disable-next-line no-await-in-loop
      return await record();
    }

    fundersTotal = page.total ?? fundersTotal;

    // An empty page means the list is exhausted, which is the only honest way
    // to know we are done: `count` can move while a walk is in progress.
    if (page.funders.length === 0) {
      finished = true;
      break;
    }

    for (const funder of page.funders) {
      if (elapsed() >= deadlineMs || walked >= maxFunders) break;

      cursor += 1;
      walked += 1;
      lastOrgId = funder.orgId;

      try {
        // eslint-disable-next-line no-await-in-loop
        const fetched = await connector.fetchAwardsDiscoveringLicence(funder.orgId);

        // Recorded BEFORE the licence check, because a funder can be both
        // truncated and unlicensed and the record is incomplete either way.
        if (fetched.truncated) truncated += 1;

        if (fetched.licence === null) {
          // No licence stated, so nothing is stored. Counted, not hidden: a
          // rule that silently drops part of the corpus is one nobody can
          // audit.
          unlicensed += 1;
          continue;
        }

        const dataset: SourceDataset = {
          id: datasetIdFor(funder.orgId),
          name: `360Giving — ${funder.name}`,
          publisher: funder.name,
          licence: fetched.licenceName ?? fetched.licence,
          licenceUrl: fetched.licence,
          attribution: `${funder.name}, published to the 360Giving Data Standard`,
          retrievedAt: now().toISOString(),
        };

        // The window is applied HERE rather than in the connector, because the
        // connector's job is to report faithfully what a publisher published —
        // including `truncated`, which is about their record and not our
        // policy. What we choose to keep is this module's decision.
        const recent = keepRecent(fetched.awards, now(), recentYears);
        discarded += recent.discarded;

        const funderId = funderIdFor360Giving(funder.orgId);
        // eslint-disable-next-line no-await-in-loop
        awardsWritten += await runInTransaction(async (tx) => {
          await upsertSourceDataset(tx, dataset);
          await upsertFunder(tx, {
            id: funderId,
            // The funder list's name, unless the grants give a better one —
            // the list can carry an org id where a name should be.
            name: fetched.funderName ?? funder.name,
            website: null,
            jurisdiction: null,
            sourceDatasetId: dataset.id,
          });
          return replaceFunderAwards(tx, funderId, recent.kept, dataset.id);
        });
      } catch (caught) {
        // One publisher's bad data must not stop the corpus. Recorded, and the
        // cursor has already moved past them — a funder that throws every time
        // would otherwise block the load for ever.
        //
        // COUNTED as well as described. `error` holds one message and the next
        // step clears it, so it was never a record of what the corpus is
        // missing — only of what went wrong most recently.
        failedOrgIds.push(funder.orgId);
        error =
          caught instanceof IngestionError || caught instanceof Error
            ? `${funder.orgId}: ${caught.message}`
            : `${funder.orgId}: could not be loaded.`;
      }
    }

    // Their `count` is the other way the end is reached, and the cheaper one:
    // it saves a request that would come back empty.
    if (fundersTotal !== null && cursor >= fundersTotal) {
      finished = true;
      break;
    }
  }

  return await record();
}
