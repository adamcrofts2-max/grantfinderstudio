/**
 * 360Giving awarded-grants connector.
 *
 * The API is open (https://api.threesixtygiving.org/api/v1/) and needs no
 * authentication. Two things about it shape this code:
 *
 *   - Publishers choose their own open licences, and some are share-alike.
 *     Licence therefore cannot be hardcoded here; it must be resolved from the
 *     publisher's metadata and passed in. This connector refuses to ingest
 *     anything without one, so unlicensed data cannot enter the system by
 *     accident.
 *
 *   - Pagination is driven by a `next` URL supplied by the response. That is a
 *     server-controlled redirect in all but name, so it is checked against the
 *     configured origin before being followed.
 */

import type { IngestedAward } from './normalise.js';
import { normaliseGrants } from './normalise.js';
import type { RawGrant, RawPage, SourceDataset } from './types.js';

export const THREESIXTYGIVING_BASE_URL = 'https://api.threesixtygiving.org/api/v1/';

export interface HttpClient {
  getJson(url: string): Promise<unknown>;
}

export class IngestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestionError';
  }
}

export interface ConnectorOptions {
  baseUrl?: string;
  /** Guard against a paginating loop or an unexpectedly enormous publisher. */
  maxPages?: number;
}

export interface IngestResult {
  awards: IngestedAward[];
  rejected: Array<{ id: string | null; reason: string }>;
  pagesFetched: number;
  /** True when maxPages stopped us before the data ran out. */
  truncated: boolean;
  dataset: SourceDataset;
}

const DEFAULT_MAX_PAGES = 50;

/**
 * Reject a pagination link that points somewhere other than the API we asked.
 *
 * Without this, a compromised or hostile response could walk the ingester onto
 * an internal address.
 */
export function assertSameOrigin(candidate: string, baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new IngestionError(`Pagination link is not a valid URL: ${candidate}`);
  }
  const base = new URL(baseUrl);
  if (url.protocol !== 'https:') {
    throw new IngestionError(`Pagination link must use https: ${candidate}`);
  }
  if (url.host !== base.host) {
    throw new IngestionError(
      `Pagination link points to ${url.host}, expected ${base.host}.`,
    );
  }
  return url;
}

function assertLicensed(dataset: SourceDataset): void {
  if (dataset.licence.trim() === '' || dataset.attribution.trim() === '') {
    throw new IngestionError(
      'Refusing to ingest: the source dataset has no licence or attribution. ' +
        'Licence must be resolved from the publisher before ingestion.',
    );
  }
}

function readPage(payload: unknown): { grants: RawGrant[]; next: string | null } {
  if (typeof payload !== 'object' || payload === null) {
    throw new IngestionError('The API response was not an object.');
  }
  const page = payload as RawPage;
  if (!Array.isArray(page.results)) {
    throw new IngestionError('The API response has no results array.');
  }
  const next = typeof page.next === 'string' && page.next !== '' ? page.next : null;
  return { grants: page.results as RawGrant[], next };
}

export class ThreeSixtyGivingConnector {
  private readonly baseUrl: string;
  private readonly maxPages: number;

  constructor(
    private readonly http: HttpClient,
    options: ConnectorOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? THREESIXTYGIVING_BASE_URL;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  }

  /**
   * Fetch every award made by one funder, following pagination.
   *
   * `funderId` is an org identifier such as `GB-CHC-1164883`.
   */
  async fetchAwardsByFunder(
    funderId: string,
    dataset: SourceDataset,
  ): Promise<IngestResult> {
    assertLicensed(dataset);
    if (funderId.trim() === '') {
      throw new IngestionError('A funder id is required.');
    }

    const start = new URL(
      `org/${encodeURIComponent(funderId)}/grants_made/`,
      this.baseUrl,
    ).toString();

    const collected: RawGrant[] = [];
    let url: string | null = start;
    let pagesFetched = 0;
    let truncated = false;

    while (url !== null) {
      if (pagesFetched >= this.maxPages) {
        truncated = true;
        break;
      }
      const payload: unknown = await this.http.getJson(url);
      const { grants, next } = readPage(payload);
      collected.push(...grants);
      pagesFetched += 1;
      url = next === null ? null : assertSameOrigin(next, this.baseUrl).toString();
    }

    const { awards, rejected } = normaliseGrants(collected);
    return { awards, rejected, pagesFetched, truncated, dataset };
  }
}
