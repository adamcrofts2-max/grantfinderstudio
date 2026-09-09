/**
 * One funder, ingested end to end.
 *
 * Fetch → normalise → persist, in that order and in one transaction, so a
 * failure part way through leaves the funder's previous awards intact rather
 * than emptying them.
 *
 * ## Per funder, not the whole corpus
 *
 * 360Giving publishes a great deal, and the temptation is to pull all of it.
 * A funder somebody is actually looking at is worth more than a million rows
 * nobody asked for, and a targeted ingest finishes inside a request rather
 * than needing a job runner this product does not have yet.
 *
 * ## Why the licence is supplied rather than inferred
 *
 * Publishers choose their own open licences and some are share-alike, so the
 * connector refuses to ingest anything without a licence and an attribution.
 * Those come from the caller — today, from an operator who has looked at the
 * publisher's own terms. Guessing "CC BY 4.0" because that is the common case
 * would put the wrong licence on somebody else's data, which is the one
 * mistake here that is not ours to make.
 */

import type { Queryable } from '../../db/client.js';
import {
  funderIdFor360Giving,
  replaceFunderAwards,
  upsertFunder,
  upsertSourceDataset,
} from '../../db/awards.js';
import type { Jurisdiction } from '../../domain/types.js';
import { IngestionError, ThreeSixtyGivingConnector, type HttpClient } from './connector.js';
import type { SourceDataset } from './types.js';

export interface IngestRequest {
  /** A 360Giving org identifier, e.g. GB-CHC-1164883. */
  orgId: string;
  /** How the funder should be named in the product. */
  funderName: string;
  website: string | null;
  jurisdiction: Jurisdiction | null;
  licence: string;
  licenceUrl: string | null;
  attribution: string;
  publisher: string;
}

export interface IngestOutcome {
  funderId: string;
  awardsWritten: number;
  rejected: number;
  rejectionReasons: string[];
  pagesFetched: number;
  truncated: boolean;
}

/** A stable dataset id per publisher, so re-ingesting updates one row. */
export function datasetIdFor(orgId: string): string {
  return `ds_360g_${orgId.trim()}`;
}

export function buildDataset(request: IngestRequest, retrievedAt: string): SourceDataset {
  return {
    id: datasetIdFor(request.orgId),
    name: `360Giving — ${request.publisher}`,
    publisher: request.publisher,
    licence: request.licence,
    licenceUrl: request.licenceUrl,
    attribution: request.attribution,
    retrievedAt,
  };
}

/**
 * Fetch a funder's grants and write them.
 *
 * The fetch happens BEFORE the transaction opens. A network call inside an
 * open transaction holds a connection for however long the publisher takes to
 * answer, and a paginating ingest of fifty pages at two a second holds it for
 * half a minute.
 */
export async function ingestFunder(
  http: HttpClient,
  request: IngestRequest,
  runInTransaction: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T>,
  options: { now?: () => Date; maxPages?: number } = {},
): Promise<IngestOutcome> {
  const now = options.now ?? (() => new Date());
  const orgId = request.orgId.trim();
  if (orgId === '') throw new IngestionError('A 360Giving organisation id is required.');
  if (request.funderName.trim() === '') {
    throw new IngestionError('A funder name is required.');
  }

  const dataset = buildDataset(request, now().toISOString());
  const connector = new ThreeSixtyGivingConnector(http, { maxPages: options.maxPages ?? 50 });
  const result = await connector.fetchAwardsByFunder(orgId, dataset);

  const funderId = funderIdFor360Giving(orgId);
  const awardsWritten = await runInTransaction(async (tx) => {
    await upsertSourceDataset(tx, dataset);
    await upsertFunder(tx, {
      id: funderId,
      name: request.funderName.trim(),
      website: request.website,
      jurisdiction: request.jurisdiction,
      sourceDatasetId: dataset.id,
    });
    return replaceFunderAwards(tx, funderId, result.awards, dataset.id);
  });

  // Distinct reasons rather than one per record: a publisher with 400 non-GBP
  // grants should say "not in GBP", not say it four hundred times.
  const rejectionReasons = [...new Set(result.rejected.map((r) => r.reason))].toSorted();

  return {
    funderId,
    awardsWritten,
    rejected: result.rejected.length,
    rejectionReasons,
    pagesFetched: result.pagesFetched,
    truncated: result.truncated,
  };
}
