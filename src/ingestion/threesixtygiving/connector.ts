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
 * From 360Giving's own `datastore/api/urls.py` (see docs/360GIVING_API.md):
 * every current grant, filtered by a regular expression over the whole grant
 * JSON. This is the route that makes a search belong to the APPLICANT rather
 * than to an operator — without it the only grants searchable are the ones
 * somebody loaded funder by funder, which is how the product came to show
 * "no grants have been loaded yet" to a person who just wanted to look.
 */
export const DEFAULT_SEARCH_PATH = 'CurrentLatestGrants/';

/** One grant as the search returns it: the standard record, plus who gave it. */
export interface CorpusGrant {
  raw: RawGrant;
  funderId: string | null;
  funderName: string | null;
  publisherName: string | null;
}

export interface GrantSearchResult {
  grants: CorpusGrant[];
  /** How many the corpus holds for this pattern, not how many came back. */
  total: number | null;
  /**
   * The route the results actually came from.
   *
   * Set when it differs from the configured one — that is, when the configured
   * route 404ed and discovery found the real one. The caller can then tell the
   * operator what to save, rather than paying for a discovery round trip on
   * every search for ever.
   */
  routeUsed: string | null;
}

/** An organisation reference on a search result: `{ org_id, name, self }`. */
function readOrgRef(value: unknown): { id: string | null; name: string | null } {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first !== 'object' || first === null) return { id: null, name: null };
  const ref = first as { org_id?: unknown; name?: unknown };
  return {
    id: typeof ref.org_id === 'string' ? ref.org_id : null,
    name: typeof ref.name === 'string' ? ref.name : null,
  };
}

/**
 * Reject a pagination link that points somewhere other than the API we asked.
 *
 * Without this, a compromised or hostile response could walk the ingester onto
 * an internal address.
 */
/**
 * Same origin as the configured base, and nothing more.
 *
 * Distinct from `assertSameOrigin`, which additionally demands https. That is
 * right for a pagination link, and wrong here for a reason worth writing down:
 * requiring https made this branch impossible to exercise against a local
 * server, and an untestable security check is how every fault this week
 * survived. The https guarantee has not been given up — it lives on the base
 * URL setting, which `settingProblem` refuses unless it is https, and a link
 * matching that origin is therefore https too.
 */
export function assertSameOriginAsBase(candidate: string, baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(candidate, baseUrl);
  } catch {
    throw new IngestionError(`Not a usable address: ${candidate}`);
  }
  const base = new URL(baseUrl);
  if (url.origin !== base.origin) {
    throw new IngestionError(
      `That route points to ${url.host}, expected ${base.host}.`,
    );
  }
  return url;
}

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
  /**
   * What routes this API actually offers.
   *
   * A Django REST Framework project answers its root with an index of
   * `{ name: url }`, which is the authoritative answer to "where is the grant
   * search" — better than anything guessed from reading source, as
   * `CurrentLatestGrants` proved by 404ing: it was a viewset CLASS name in
   * their `urls.py`, not a path.
   *
   * Only ever called after a 404, so a working deployment never pays for it.
   */
  private async routeIndex(): Promise<Record<string, string>> {
    const payload: unknown = await this.http.getJson(this.baseUrl);
    if (typeof payload !== 'object' || payload === null) return {};
    const routes: Record<string, string> = {};
    for (const [name, value] of Object.entries(payload as Record<string, unknown>)) {
      if (typeof value === 'string') routes[name] = value;
    }
    return routes;
  }

  /** Routes whose name or address mentions grants, likeliest first. */
  private static grantRoutes(routes: Record<string, string>): string[] {
    return Object.entries(routes)
      .filter(([name, url]) => /grant/iu.test(name) || /grant/iu.test(url))
      .map(([, url]) => url);
  }

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
    let routeUsed: string | null = null;
    try {
      payload = await this.http.getJson(this.searchUrl(this.searchPath, pattern, limit));
    } catch (error) {
      const missing = error instanceof IngestionError && /returned 404/u.test(error.message);
      if (!missing) throw error;

      // The configured route is not there. Ask the API where its grant search
      // lives and try that once, rather than reporting a bare 404 and leaving
      // somebody to guess — which is what the first attempt at this did.
      const routes = await this.routeIndex().catch(() => ({}));
      const candidates = ThreeSixtyGivingConnector.grantRoutes(routes);
      const names = Object.keys(routes);
      if (candidates.length === 0) {
        throw new IngestionError(
          `The grant search route "${this.searchPath}" is not there (404)` +
            (names.length === 0
              ? ', and this API did not list its routes. Check the base URL under Services.'
              : `. This API offers: ${names.join(', ')}. Set the right one as the grant search route under Services.`),
        );
      }

      // Same origin, checked the same way a pagination link is: this is a URL
      // taken from a response body and then fetched, so a hostile or
      // compromised index could otherwise walk the search onto another host.
      const found = assertSameOriginAsBase(candidates[0] as string, this.baseUrl);
      payload = await this.http.getJson(this.searchUrl(found.toString(), pattern, limit));
      // Relative to the base, so it can be pasted straight into the setting.
      routeUsed = found.toString().startsWith(this.baseUrl)
        ? found.toString().slice(this.baseUrl.length)
        : found.pathname;
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
      const record = entry as { data?: unknown; funders?: unknown; publisher?: unknown };
      // The standard record is wrapped in `data`; a response shaped the older
      // way, with the grant at the top level, is still readable.
      const raw = (typeof record.data === 'object' && record.data !== null
        ? record.data
        : record) as RawGrant;
      const funder = readOrgRef(record.funders);
      const publisher = readOrgRef(record.publisher);
      grants.push({
        raw,
        funderId: funder.id,
        funderName: funder.name,
        publisherName: publisher.name,
      });
    }

    return {
      grants,
      total: typeof page.count === 'number' ? page.count : null,
      routeUsed,
    };
  }
}
