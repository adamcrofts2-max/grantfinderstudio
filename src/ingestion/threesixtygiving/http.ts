/**
 * The HTTP side of ingestion.
 *
 * `ThreeSixtyGivingConnector` takes an `HttpClient` and never constructs one,
 * which is what made it testable without a network. This is the implementation
 * that talks to the real API — and it is the only file in the ingestion path
 * that does any I/O at all.
 *
 * Three things it has to get right:
 *
 *   1. The published rate limit is 2 requests a second. A paginating ingest
 *      walks straight through that unless something holds it back, and the
 *      polite failure mode of exceeding it is being blocked. The limiter is a
 *      serialised queue rather than a counter: requests are already sequential
 *      here, so spacing them is both sufficient and simpler than a bucket.
 *   2. A timeout. A request that never returns would hang an ingest and, in a
 *      serverless function, burn the whole invocation.
 *   3. A response that is not JSON, or not 200, must fail loudly. Returning
 *      an empty page instead would look to the connector like a publisher with
 *      no grants, and it would then cheerfully delete every award we hold.
 */

import { IngestionError, type HttpClient } from './connector.js';

/** The API's published limit. */
export const REQUESTS_PER_SECOND = 2;
const MIN_INTERVAL_MS = 1000 / REQUESTS_PER_SECOND;
const DEFAULT_TIMEOUT_MS = 20_000;
/** Bounded so a hostile or broken response cannot exhaust memory. */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface FetchClientOptions {
  timeoutMs?: number;
  minIntervalMs?: number;
  /** Injected in tests. Defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * A polite, bounded JSON client.
 *
 * Not exported as a singleton: an ingest run owns its own limiter, so two
 * concurrent runs are two independent 2/second streams rather than one that
 * silently shares state.
 */
export class FetchJsonClient implements HttpClient {
  private readonly timeoutMs: number;
  private readonly minIntervalMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** The tail of the queue that serialises requests. */
  private chain: Promise<unknown> = Promise.resolve();
  private lastStartedAt = 0;

  constructor(options: FetchClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.minIntervalMs = options.minIntervalMs ?? MIN_INTERVAL_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? realSleep;
  }

  async getJson(url: string): Promise<unknown> {
    const run = this.chain.then(
      () => this.spaced(url),
      () => this.spaced(url),
    );
    // Swallow the outcome so one failure does not poison the queue.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async spaced(url: string): Promise<unknown> {
    const wait = this.lastStartedAt + this.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastStartedAt = this.now();
    return this.request(url);
  }

  private async request(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          // Identifies us to the publisher, which is the courtesy an open API
          // is owed and what lets them contact us rather than block us.
          'user-agent': 'GrantFinderStudio/1.0 (+https://grantfinderstudio.vercel.app)',
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new IngestionError(`Could not reach ${url}: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new IngestionError(
        `${url} returned ${response.status} ${response.statusText}. ` +
          (response.status === 429
            ? 'That is the rate limit; the ingest is going too fast.'
            : 'Nothing has been written.'),
      );
    }

    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > MAX_RESPONSE_BYTES) {
      throw new IngestionError(
        `${url} returned ${length} bytes, over the ${MAX_RESPONSE_BYTES} limit.`,
      );
    }

    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) {
      throw new IngestionError(`${url} returned more than ${MAX_RESPONSE_BYTES} bytes.`);
    }

    try {
      return JSON.parse(body) as unknown;
    } catch {
      // A publisher outage that serves an HTML error page must not look like
      // a funder with no grants — that would delete every award we hold.
      throw new IngestionError(`${url} did not return JSON.`);
    }
  }
}
