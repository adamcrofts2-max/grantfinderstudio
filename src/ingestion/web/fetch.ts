/**
 * Fetching a page somebody gave us the address of.
 *
 * Separate from `FetchJsonClient`, which fetches a CONFIGURED base URL. This
 * one fetches user input, and that is a different problem: the server's
 * network position is the thing being protected, so every hop is checked
 * rather than only the first.
 *
 *  - the address must pass `checkWebAddress` — https, public hostname, no
 *    credentials, no port;
 *  - the address it RESOLVES to must not be private, which is the control
 *    that actually stops the attack, since a public name can point anywhere;
 *  - each redirect is re-checked the same way, because the first response is
 *    an attacker's chance to move us somewhere the first check would have
 *    refused;
 *  - the body is capped and the whole thing is on a timeout, so a slow or
 *    enormous page cannot hold a request open or exhaust memory;
 *  - nothing is sent: no cookies, no credentials, no authorization header.
 */

import { lookup } from 'node:dns/promises';

import { checkWebAddress, isPrivateAddress } from '../../domain/web/address.js';

export const MAX_BYTES = 2 * 1024 * 1024;
export const TIMEOUT_MS = 12_000;
export const MAX_REDIRECTS = 3;

export class WebFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebFetchError';
  }
}

export interface FetchedPage {
  /** The address actually read, after redirects. */
  url: string;
  html: string;
}

/** Resolve a hostname and refuse if any answer is a private address. */
async function assertResolvesPublicly(hostname: string): Promise<void> {
  let answers: Array<{ address: string }>;
  try {
    answers = await lookup(hostname, { all: true });
  } catch {
    throw new WebFetchError(`We could not find a website at ${hostname}.`);
  }
  if (answers.length === 0) {
    throw new WebFetchError(`We could not find a website at ${hostname}.`);
  }
  // EVERY answer, not the first: a name with one public and one private
  // address would otherwise be a coin toss that eventually lands inside.
  for (const answer of answers) {
    if (isPrivateAddress(answer.address)) {
      throw new WebFetchError(
        `${hostname} points inside a private network, so we will not read it.`,
      );
    }
  }
}

/**
 * Read one page, following a few redirects and checking each one.
 *
 * `redirect: 'manual'` rather than letting fetch follow: an automatic follow
 * would take the second hop before anything could look at it, which is the
 * whole attack.
 */
export async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  const first = checkWebAddress(rawUrl);
  if (!first.ok || first.url === null) {
    throw new WebFetchError(first.message ?? 'That address cannot be read.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let target = first.url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const url = new URL(target);
      await assertResolvesPublicly(url.hostname);

      const response = await fetch(target, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'GrantFinderStudio (+reads a page its owner asked us to read)',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location === null) {
          throw new WebFetchError('That page redirected to nowhere.');
        }
        const next = checkWebAddress(new URL(location, target).toString());
        if (!next.ok || next.url === null) {
          // The interesting refusal: the page tried to move us somewhere the
          // first check would never have allowed.
          throw new WebFetchError(
            'That page redirects somewhere we will not follow. Give us the address it ends up at.',
          );
        }
        target = next.url;
        continue;
      }

      if (!response.ok) {
        throw new WebFetchError(
          `That page answered ${response.status}. Check the address in a browser first.`,
        );
      }

      const type = response.headers.get('content-type') ?? '';
      if (!/text\/html|application\/xhtml/iu.test(type)) {
        throw new WebFetchError(
          'That address is not a web page. Give us the page a funder would read, not a file.',
        );
      }

      const body = response.body;
      if (body === null) throw new WebFetchError('That page sent nothing.');

      // Streamed with a running total rather than read whole: a declared
      // content-length can lie, and the point is never to hold more than the
      // cap in memory.
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value === undefined) continue;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel();
          throw new WebFetchError('That page is too large to read.');
        }
        chunks.push(value);
      }

      return { url: target, html: Buffer.concat(chunks).toString('utf8') };
    }

    throw new WebFetchError('That address redirects too many times.');
  } catch (error) {
    if (error instanceof WebFetchError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new WebFetchError('That page took too long to answer.');
    }
    throw new WebFetchError('We could not reach that page.');
  } finally {
    clearTimeout(timer);
  }
}
