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
  /**
   * Path of the corpus-wide grant search, relative to the base URL.
   *
   * Configurable because it could not be verified against the live API from
   * the build environment, and a route that moves would otherwise need a code
   * change and a redeploy to correct. The console can set it; `searchPath` on
   * the settings registry carries the same default.
   */
  searchPath?: string;
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
 * The corpus-wide grant search.
 *
 * Read from 360Giving's own `datastore/api/urls.py` at 4a57c2e, not guessed:
 *
 *     path("experimental/CurrentLatestGrants",
 *          api.experimental.api.CurrentLatestGrants.as_view(), ...)
 *
 * Three things in that line cost two wrong guesses and two 404s, and each is
 * the reason this constant looks the way it does:
 *
 *   - It hangs off `api/`, NOT `api/v1/`. So it cannot be written relative to
 *     the configured base (`.../api/v1/`) without a `../`, and a root-relative
 *     path says the same thing more plainly.
 *   - It has NO trailing slash, and Django's APPEND_SLASH only ever ADDS one.
 *     `CurrentLatestGrants/` therefore matches nothing and 404s — which is
 *     exactly what the live service reported.
 *   - `experimental` is 360Giving's own label for it. It is the only route
 *     they publish that searches across all grants rather than one named
 *     organisation, so the applicant's search depends on it; if they retire
 *     it, the setting below is how this is corrected without a redeploy.
 *
 * This is the route that makes a search belong to the APPLICANT rather than to
 * an operator. Without it the only grants searchable are the ones somebody
 * loaded funder by funder, which is how the product came to show "no grants
 * have been loaded yet" to a person who just wanted to look.
 */
export const DEFAULT_SEARCH_PATH = '/api/experimental/CurrentLatestGrants';

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

export interface GrantSearchResult {
  grants: CorpusGrant[];
  /** How many the corpus holds for this pattern, not how many came back. */
  total: number | null;
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
  private readonly searchPath: string;

  constructor(
    private readonly http: HttpClient,
    options: ConnectorOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? THREESIXTYGIVING_BASE_URL;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.searchPath = options.searchPath ?? DEFAULT_SEARCH_PATH;
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

  /**
   * Search every grant in the corpus.
   *
   * ONE page, and that is the design rather than a limitation. This runs while
   * somebody waits, against a service that allows two requests a second, so
   * walking pagination would turn a search into a minute of held breath and a
   * burst of load on an open API run by a charity. A broad alternation plus
   * local ranking puts the useful rows on the first page; somebody who needs
   * more narrows the search, which is cheaper for everybody.
   *
   * Nothing is stored. The grants are shown with their attribution and a link
   * to the funder, which is also what keeps this on the right side of the
   * database right: a page fetched for the person who asked, not a copy of
   * somebody's dataset.
   */
  private searchUrl(path: string, pattern: string, limit: number): string {
    const url = new URL(path, this.baseUrl);
    url.searchParams.set('search', pattern);
    url.searchParams.set('limit', String(Math.min(limit, 100)));
    return url.toString();
  }

  async searchGrants(pattern: string, limit = 50): Promise<GrantSearchResult> {
    if (pattern.trim() === '') {
      // An empty regex matches the whole corpus. Refused here as well as in
      // the domain, because this is the boundary that would actually make the
      // request.
      throw new IngestionError('A search pattern is required.');
    }

    let payload: unknown;
    try {
      payload = await this.http.getJson(this.searchUrl(this.searchPath, pattern, limit));
    } catch (error) {
      const missing = error instanceof IngestionError && /returned 404/u.test(error.message);
      if (!missing) throw error;

      // A 404 here has ONE cause worth naming, and it is not a wrong guess any
      // more: the route is read from 360Giving's own urls.py, so if it is
      // missing they have moved or retired it. An earlier version of this
      // asked the API for an index of its routes and suggested one; that could
      // never have worked — `/api/` serves an HTML landing page and `/` serves
      // their web UI, so there is no index to read. Guessing machinery that
      // cannot succeed is worse than a message that says what to do.
      throw new IngestionError(
        `The grant search route "${this.searchPath}" is not there (404). ` +
          'It is 360Giving\'s experimental all-grants search, and they may have ' +
          'moved it — the route is settable under Services, without a redeploy. ' +
          'Their published routes for one named organisation ' +
          '(org/{id}/grants_made/, org/{id}/grants_received/) are unaffected, so ' +
          'loading a single funder still works.',
      );
    }

    if (typeof payload !== 'object' || payload === null) {
      throw new IngestionError('The search response was not an object.');
    }
    const page = payload as { results?: unknown; count?: unknown };
    if (!Array.isArray(page.results)) {
      throw new IngestionError(
        'The search response has no results array. The search route may have moved — it is settable under Services.',
      );
    }

    const grants: CorpusGrant[] = [];
    for (const entry of page.results) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as {
        data?: unknown;
        additional_data?: unknown;
        funding_org_ids?: unknown;
        publisher_org_id?: unknown;
        funders?: unknown;
        publisher?: unknown;
      };
      // The standard record is wrapped in `data`; a response shaped the older
      // way, with the grant at the top level, is still readable.
      const raw = (typeof record.data === 'object' && record.data !== null
        ? record.data
        : record) as RawGrant;
      // Denormalised column first, because that is what the corpus search
      // serialises; the `funders` / `publisher` references are what the
      // per-organisation endpoints give, and both shapes are read so one
      // reader serves both.
      const funderId = firstId(record.funding_org_ids) ?? readOrgRef(record.funders);
      const licence = readLicence(record.additional_data);
      grants.push({
        raw,
        funderId,
        funderName: funderNameOf(raw),
        publisherId: firstId(record.publisher_org_id) ?? readOrgRef(record.publisher),
        licence: licence.licence,
        licenceName: licence.name,
      });
    }

    return {
      grants,
      total: typeof page.count === 'number' ? page.count : null,
    };
  }
}
