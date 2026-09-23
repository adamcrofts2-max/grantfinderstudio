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
 *  - the address the SOCKET CONNECTS TO must not be private. That is the
 *    control that actually stops the attack, and it lives inside the
 *    connection (`guardedLookup`), not before it: see "Rebinding" below;
 *  - each redirect is re-checked the same way, because the first response is
 *    an attacker's chance to move us somewhere the first check would have
 *    refused;
 *  - the body is capped and the whole thing is on a timeout, so a slow or
 *    enormous page cannot hold a request open or exhaust memory;
 *  - nothing is sent: no cookies, no credentials, no authorization header.
 *
 * ## Rebinding
 *
 * The first version resolved the hostname, checked every answer, and then
 * called `fetch` — which resolved the hostname AGAIN, on its own, and
 * connected to whatever that second answer was. A hostile DNS server with a
 * zero TTL answers the check with a public address and the connection with
 * 127.0.0.1 or 169.254.169.254, and the check has approved a request it never
 * saw. Found by the September 2026 security review.
 *
 * So there is now exactly one lookup: the one the socket uses. `https.request`
 * takes a `lookup` function, and the one passed here refuses a private answer
 * at the moment of connection. There is no second resolution to disagree with
 * the first, because there is no first.
 */

import { lookup as dnsLookup } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { LookupAddress, LookupOptions } from 'node:dns';

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

/** How a hostname becomes addresses. Injectable so rebinding can be tested. */
export type Resolve = (
  hostname: string,
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

const systemResolve: Resolve = (hostname, callback) =>
  dnsLookup(hostname, { all: true }, callback);

/** The shape Node's socket code calls `lookup` with. */
type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A `lookup` for `https.request` that refuses to connect anywhere private.
 *
 * This is the control. It runs INSIDE the connection, on the answer the
 * socket is about to use, so there is no gap between checking an address and
 * connecting to it.
 *
 * EVERY answer is checked, not the first: a name with one public and one
 * private address would otherwise be a coin toss that eventually lands inside.
 *
 * Node calls this two ways. With `all: true` — which is how dual-stack
 * connection attempts ask, and the default in Node 20 and later — it wants
 * the whole list back; otherwise it wants one address and its family.
 * Answering the wrong shape fails every request, so both are handled and both
 * are tested.
 */
export function guardedLookup(resolve: Resolve = systemResolve) {
  return (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    resolve(hostname, (error, answers) => {
      if (error !== null || answers.length === 0) {
        callback(
          new WebFetchError(`We could not find a website at ${hostname}.`) as NodeJS.ErrnoException,
          [],
        );
        return;
      }
      if (answers.some((answer) => isPrivateAddress(answer.address))) {
        callback(
          new WebFetchError(
            `${hostname} points inside a private network, so we will not read it.`,
          ) as NodeJS.ErrnoException,
          [],
        );
        return;
      }
      const family = options.family === 4 || options.family === 6 ? options.family : 0;
      const usable = family === 0 ? answers : answers.filter((a) => a.family === family);
      if (options.all === true) {
        callback(null, usable);
        return;
      }
      const first = usable[0];
      if (first === undefined) {
        callback(
          new WebFetchError(`We could not find a website at ${hostname}.`) as NodeJS.ErrnoException,
          [],
        );
        return;
      }
      callback(null, first.address, first.family);
    });
  };
}

/** One GET, through the guarded lookup, returning the raw response. */
function requestOnce(
  target: string,
  signal: AbortSignal,
  resolve: Resolve,
): Promise<IncomingMessage> {
  return new Promise((resolvePromise, reject) => {
    const req = httpsRequest(
      target,
      {
        method: 'GET',
        signal,
        lookup: guardedLookup(resolve),
        // A fresh socket every time. A pooled one could have been opened for
        // a different hop and would skip this request's lookup entirely.
        agent: false,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'GrantFinderStudio (+reads a page its owner asked us to read)',
        },
      },
      resolvePromise,
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Read one page, following a few redirects and checking each one.
 *
 * `redirect: 'manual'` rather than letting fetch follow: an automatic follow
 * would take the second hop before anything could look at it, which is the
 * whole attack.
 */
export async function fetchPage(
  rawUrl: string,
  /** For tests only: how hostnames resolve. Never reachable from user input. */
  options: { resolve?: Resolve } = {},
): Promise<FetchedPage> {
  const resolve = options.resolve ?? systemResolve;
  const first = checkWebAddress(rawUrl);
  if (!first.ok || first.url === null) {
    throw new WebFetchError(first.message ?? 'That address cannot be read.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let target = first.url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await requestOnce(target, controller.signal, resolve);
      const status = response.statusCode ?? 0;
      const header = (name: string): string | null => {
        const value = response.headers[name];
        return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
      };

      if (status >= 300 && status < 400) {
        response.resume();
        const location = header('location');
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

      if (status < 200 || status >= 300) {
        response.resume();
        throw new WebFetchError(
          `That page answered ${status}. Check the address in a browser first.`,
        );
      }

      const type = header('content-type') ?? '';
      if (!/text\/html|application\/xhtml/iu.test(type)) {
        response.resume();
        throw new WebFetchError(
          'That address is not a web page. Give us the page a funder would read, not a file.',
        );
      }

      // Streamed with a running total rather than read whole: a declared
      // content-length can lie, and the point is never to hold more than the
      // cap in memory.
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of response) {
        const piece = chunk as Buffer;
        total += piece.byteLength;
        if (total > MAX_BYTES) {
          response.destroy();
          throw new WebFetchError('That page is too large to read.');
        }
        chunks.push(piece);
      }

      return { url: target, html: Buffer.concat(chunks).toString('utf8') };
    }

    throw new WebFetchError('That address redirects too many times.');
  } catch (error) {
    if (error instanceof WebFetchError) throw error;
    // The guarded lookup's refusal arrives as the request's error. Keep its
    // words: "points inside a private network" is the useful sentence.
    if (error instanceof Error && error.name === 'WebFetchError') {
      throw new WebFetchError(error.message);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new WebFetchError('That page took too long to answer.');
    }
    throw new WebFetchError('We could not reach that page.');
  } finally {
    clearTimeout(timer);
  }
}
