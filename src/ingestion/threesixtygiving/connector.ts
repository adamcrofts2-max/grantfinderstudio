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
 * There is no public all-grants search, and this is where that is recorded.
 *
 * `/api/experimental/CurrentLatestGrants` is in 360Giving's own `urls.py` and
 * returns 404 on the live host. It sits in the same module as
 * `control/trigger-datagetter`, which plainly must not be reachable from
 * outside, so the whole non-`v1` tree looks to be internal. Their published
 * documentation agrees: it lists three data endpoints — Grants Made, Grants
 * Received, Organisation List — and no search.
 *
 * Three guesses at that route cost three deployments. The conclusion is not a
 * fourth guess but a different design: their API gives every grant a NAMED
 * funder made, so the corpus is assembled from the funder list and held
 * locally, which is what 360Giving themselves tell developers to do. Searching
 * grant TEXT is then a local query, and no route can 404 it.
 */

/**
 * One grant as the corpus search returns it.
 *
 * The search serialises 360Giving's own `Grant` row, which is the standard
 * record under `data` plus four denormalised columns beside it. Those columns
 * are where the identifiers live — the API's organisation references carry an
 * `org_id` and nothing else, so a funder's NAME is only ever available from
 * inside the grant the publisher wrote.
 */
export interface CorpusGrant {
  raw: RawGrant;
  funderId: string | null;
  funderName: string | null;
  publisherId: string | null;
  /**
   * The licence THIS grant was published under, carried per row.
   *
   * 360Giving publishers each choose their own open licence and some are
   * share-alike, so there is no single licence for the corpus to state. Their
   * data store attaches each grant's own licence at
   * `additional_data.metadata.source_license`, which means attribution can be
   * shown from the data rather than asserted by us.
   */
  licence: string | null;
  licenceName: string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** The first entry of a denormalised id array, such as `funding_org_ids`. */
function firstId(value: unknown): string | null {
  return Array.isArray(value) ? text(value[0]) : text(value);
}

/**
 * An organisation reference as the v1 org endpoints serialise it.
 *
 * `{ org_id, self }` — and no name, deliberately, on their side: the API's
 * `OrganisationRef` dataclass holds an `org_id` alone. Read here so a row from
 * `grants_made/` and a row from the corpus search are understood by the same
 * code, but it can only ever yield an identifier.
 */
function readOrgRef(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== 'object' || first === null) return null;
  return text((first as { org_id?: unknown }).org_id);
}

/** The funder's name, which only the publisher's own record carries. */
function funderNameOf(raw: RawGrant): string | null {
  const funders = (raw as { fundingOrganization?: unknown }).fundingOrganization;
  const first = Array.isArray(funders) ? funders[0] : undefined;
  if (typeof first !== 'object' || first === null) return null;
  return text((first as { name?: unknown }).name);
}

/** `additional_data.metadata` — where each grant's own licence is attached. */
function readLicence(value: unknown): { licence: string | null; name: string | null } {
  if (typeof value !== 'object' || value === null) return { licence: null, name: null };
  const metadata = (value as { metadata?: unknown }).metadata;
  if (typeof metadata !== 'object' || metadata === null) return { licence: null, name: null };
  const fields = metadata as { source_license?: unknown; source_license_name?: unknown };
  return {
    licence: text(fields.source_license),
    name: text(fields.source_license_name),
  };
}

/** `data_license: { url, name }` — how the v1 grant routes state the licence. */
function readDataLicense(value: unknown): { licence: string | null; name: string | null } {
  if (typeof value !== 'object' || value === null) return { licence: null, name: null };
  const fields = value as { url?: unknown; name?: unknown };
  return { licence: text(fields.url), name: text(fields.name) };
}

/**
 * ONE reader for a grant row, whichever endpoint it came from.
 *
 * This exists because there is no such thing as "the grant" in a response: the
 * 360Giving standard record is nested under `data`, and the fields around it
 * differ per route. Every place that read a row its own way got it wrong —
 * including the per-funder ingest, which handed the WRAPPER to the normaliser
 * and would therefore have rejected every real grant as having no id, no
 * currency and no date. Its fixtures were written from the Data Standard
 * rather than captured from the API, so they carried the grant at the top
 * level and the tests passed against a shape the service never sends.
 *
 * A top-level grant is still accepted, because that is what a fixture written
 * that way looks like and because being tolerant here costs nothing.
 */
export function readGrantRow(entry: unknown): CorpusGrant | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as {
    data?: unknown;
    additional_data?: unknown;
    data_license?: unknown;
    funding_org_ids?: unknown;
    publisher_org_id?: unknown;
    funders?: unknown;
    publisher?: unknown;
  };
  const raw = (typeof record.data === 'object' && record.data !== null
    ? record.data
    : record) as RawGrant;

  // Denormalised column first, because that is what the corpus search
  // serialises; the `funders` / `publisher` references are what the
  // per-organisation endpoints give, and both shapes are read so one reader
  // serves both.
  const funderId = firstId(record.funding_org_ids) ?? readOrgRef(record.funders);
  // Two places state a licence, one per route. Neither is present on both.
  const fromAdditional = readLicence(record.additional_data);
  const fromDataLicense = readDataLicense(record.data_license);
  return {
    raw,
    funderId,
    funderName: funderNameOf(raw),
    publisherId: firstId(record.publisher_org_id) ?? readOrgRef(record.publisher),
    licence: fromAdditional.licence ?? fromDataLicense.licence,
    licenceName: fromAdditional.name ?? fromDataLicense.name,
  };
}

/**
 * Reject a pagination link that points somewhere other than the API we asked.
 *
 * Without this, a compromised or hostile response could walk the ingester onto
 * an internal address.
 *
 * ## The SAME origin, not a hardcoded https
 *
 * This demanded `https:` outright, which is right for the live API and wrong
 * as a rule: the base URL is configurable precisely so a deployment can be
 * pointed at a mirror or a staging copy, and against an `http://` one every
 * publisher with more than one page failed — the `next` link was refused, the
 * error aborted that funder, and the rows already read were thrown away with
 * it. Found by loading a local corpus: the three biggest publishers of
 * thirteen wrote nothing at all and were counted "could not be read".
 *
 * Comparing against the base URL's own protocol keeps the property that
 * mattered. In production the base is `https://api.threesixtygiving.org`, so
 * an `http` link is still a downgrade and still refused; the check is now
 * "the origin we asked" rather than a guess at what that origin is.
 */
export function assertSameOrigin(candidate: string, baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new IngestionError(`Pagination link is not a valid URL: ${candidate}`);
  }
  const base = new URL(baseUrl);
  if (url.protocol !== base.protocol) {
    throw new IngestionError(
      `Pagination link uses ${url.protocol.replace(':', '')}, expected ` +
        `${base.protocol.replace(':', '')}: ${candidate}`,
    );
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

    const { rows, pagesFetched, truncated } = await this.walkGrants(start);
    const { awards, rejected } = normaliseGrants(rows.map((row) => row.raw));
    return { awards, rejected, pagesFetched, truncated, dataset };
  }

  /**
   * Every award a funder made, plus the licence the rows state themselves.
   *
   * `fetchAwardsByFunder` needs a licence BEFORE it will fetch anything, which
   * is right when a person is ingesting one named funder: they have read the
   * publisher's terms and are asserting them. It cannot work when the funder
   * came off a list of thousands, so this reads the licence off the grants —
   * `data_license` on the v1 routes — and leaves the caller to refuse the ones
   * that state none. The refusal stays; only who supplies the licence changes.
   */
  async fetchAwardsDiscoveringLicence(funderId: string): Promise<{
    awards: IngestedAward[];
    rejected: Array<{ id: string | null; reason: string }>;
    licence: string | null;
    licenceName: string | null;
    funderName: string | null;
    pagesFetched: number;
    truncated: boolean;
  }> {
    if (funderId.trim() === '') throw new IngestionError('A funder id is required.');
    const start = new URL(
      `org/${encodeURIComponent(funderId)}/grants_made/`,
      this.baseUrl,
    ).toString();
    const { rows, pagesFetched, truncated } = await this.walkGrants(start);
    const { awards, rejected } = normaliseGrants(rows.map((row) => row.raw));
    // The first row that states one. A publisher's licence is per source file,
    // so every grant of theirs carries the same; taking the first that has one
    // tolerates a row where the field is absent.
    const licensed = rows.find((row) => row.licence !== null);
    return {
      awards,
      rejected,
      licence: licensed?.licence ?? null,
      licenceName: licensed?.licenceName ?? null,
      funderName: rows.find((row) => row.funderName !== null)?.funderName ?? null,
      pagesFetched,
      truncated,
    };
  }

  /** Follow pagination from one address, reading every row the same way. */
  private async walkGrants(
    start: string,
  ): Promise<{ rows: CorpusGrant[]; pagesFetched: number; truncated: boolean }> {
    const rows: CorpusGrant[] = [];
    let url: string | null = start;
    let pagesFetched = 0;
    let truncated = false;

    while (url !== null) {
      if (pagesFetched >= this.maxPages) {
        truncated = true;
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      const payload: unknown = await this.http.getJson(url);
      const { grants, next } = readPage(payload);
      for (const entry of grants) {
        const row = readGrantRow(entry);
        if (row !== null) rows.push(row);
      }
      pagesFetched += 1;
      url = next === null ? null : assertSameOrigin(next, this.baseUrl).toString();
    }

    return { rows, pagesFetched, truncated };
  }

  /**
   * One page of every funder 360Giving holds.
   *
   * `org/funder/` — `org_id` and `name`, nothing else, up to 1000 a page and
   * 100 requests a minute. It is the list that makes a corpus-wide search
   * possible at all, now that the all-grants search has turned out not to be
   * public: their published API can give you every grant a NAMED funder made,
   * so the names have to come from somewhere first.
   */
  async fetchFunderPage(
    offset = 0,
    limit = 1000,
  ): Promise<{ funders: Array<{ orgId: string; name: string }>; total: number | null }> {
    const url = new URL('org/funder/', this.baseUrl);
    url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 1000)));
    url.searchParams.set('offset', String(Math.max(offset, 0)));

    const payload: unknown = await this.http.getJson(url.toString());
    if (typeof payload !== 'object' || payload === null) {
      throw new IngestionError('The funder list response was not an object.');
    }
    const page = payload as { results?: unknown; count?: unknown };
    if (!Array.isArray(page.results)) {
      throw new IngestionError('The funder list response has no results array.');
    }

    const funders: Array<{ orgId: string; name: string }> = [];
    for (const entry of page.results) {
      if (typeof entry !== 'object' || entry === null) continue;
      const row = entry as { org_id?: unknown; name?: unknown };
      const orgId = text(row.org_id);
      if (orgId === null) continue;
      // A blank name is allowed by their serialiser, and an unnamed funder is
      // still worth holding: the id is what fetches its grants.
      funders.push({ orgId, name: text(row.name) ?? orgId });
    }

    return { funders, total: typeof page.count === 'number' ? page.count : null };
  }

}
