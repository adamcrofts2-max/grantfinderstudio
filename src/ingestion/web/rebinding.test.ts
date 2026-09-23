/**
 * DNS rebinding, and the lookup that closes it.
 *
 * Found by the September 2026 security review. The fetcher resolved a name,
 * checked the answers, and then let `fetch` resolve the same name AGAIN and
 * connect to whatever the second answer was. A hostile DNS server with a zero
 * TTL answers the first with a public address and the second with loopback
 * or the cloud metadata address, and the check has approved a connection it
 * never saw.
 *
 * The fix is one lookup — the one the socket uses — refused inside the
 * connection. These tests prove the lookup itself, then prove it over a real
 * socket: a listener on 127.0.0.1:443 must receive nothing at all.
 */

import { createServer, type Server } from 'node:net';
import type { LookupAddress } from 'node:dns';
import { afterEach, describe, expect, it } from 'vitest';

import { fetchPage, guardedLookup, type Resolve, WebFetchError } from './fetch.js';

const PUBLIC: LookupAddress = { address: '93.184.216.34', family: 4 };
const LOOPBACK: LookupAddress = { address: '127.0.0.1', family: 4 };
const METADATA: LookupAddress = { address: '169.254.169.254', family: 4 };
const PUBLIC_V6: LookupAddress = { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 };

const always =
  (...answers: LookupAddress[]): Resolve =>
  (_host, callback) =>
    callback(null, answers);

/** Call the guarded lookup the way Node's socket code does, and collect the answer. */
function ask(
  resolve: Resolve,
  options: { all?: boolean; family?: number },
): Promise<{ error: Error | null; address: unknown; family?: number }> {
  return new Promise((done) => {
    guardedLookup(resolve)('rebind.example', options, (error, address, family) =>
      done({ error, address, family }),
    );
  });
}

describe('the lookup the socket connects with', () => {
  it('hands back the whole list when asked for all of it', async () => {
    // How Node 20+ asks by default, for dual-stack connection attempts.
    // Answering the single-address shape here would fail every request.
    const { error, address } = await ask(always(PUBLIC, PUBLIC_V6), { all: true });
    expect(error).toBeNull();
    expect(address).toEqual([PUBLIC, PUBLIC_V6]);
  });

  it('hands back one address and its family when asked for one', async () => {
    const { error, address, family } = await ask(always(PUBLIC), {});
    expect(error).toBeNull();
    expect(address).toBe(PUBLIC.address);
    expect(family).toBe(4);
  });

  it('honours a requested family', async () => {
    const { address } = await ask(always(PUBLIC, PUBLIC_V6), { all: true, family: 6 });
    expect(address).toEqual([PUBLIC_V6]);
  });

  it('refuses loopback', async () => {
    const { error } = await ask(always(LOOPBACK), { all: true });
    expect(error?.message).toMatch(/private network/u);
  });

  it('refuses the cloud metadata address', async () => {
    const { error } = await ask(always(METADATA), {});
    expect(error?.message).toMatch(/private network/u);
  });

  it('refuses a name with one public and one private answer', async () => {
    // Otherwise a coin toss that eventually lands inside.
    const { error } = await ask(always(PUBLIC, LOOPBACK), { all: true });
    expect(error?.message).toMatch(/private network/u);
  });

  it('refuses a name that resolves to nothing', async () => {
    const { error } = await ask(always(), {});
    expect(error?.message).toMatch(/could not find a website/u);
  });
});

describe('rebinding itself', () => {
  it('resolves exactly once per request, so there is no second answer to trust', async () => {
    // The whole attack is the gap between two lookups. A resolver that
    // answers "public" first and "loopback" after is only dangerous if there
    // is an "after". Here there is one lookup, it is the socket's, and a
    // loopback answer there is refused.
    let calls = 0;
    const rebinding: Resolve = (_host, callback) => {
      calls += 1;
      callback(null, calls === 1 ? [LOOPBACK] : [PUBLIC]);
    };
    await expect(fetchPage('https://rebind.example/', { resolve: rebinding })).rejects.toThrow(
      /private network/u,
    );
    expect(calls).toBe(1);
  });
});

describe('over a real socket', () => {
  let listener: Server | null = null;
  let connections = 0;

  afterEach(async () => {
    if (listener !== null) {
      await new Promise<void>((done) => listener?.close(() => done()));
      listener = null;
    }
  });

  /**
   * A listener where the attack would land: loopback, on the one port the
   * fetcher allows. Binding 443 needs privileges some CI runners do not have,
   * so this skips rather than fails there — the same courtesy the live test
   * beside it extends to a sandbox without DNS. It is not skipped here.
   */
  async function listenOn443(): Promise<boolean> {
    connections = 0;
    const server = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    const bound = await new Promise<boolean>((done) => {
      server.once('error', () => done(false));
      server.listen(443, '127.0.0.1', () => done(true));
    });
    if (bound) listener = server;
    return bound;
  }

  it('makes no connection at all when the name rebinds to loopback', async () => {
    if (!(await listenOn443())) return;

    // The control first: the listener IS there, so a zero below is the guard
    // and not a dead port.
    const { connect } = await import('node:net');
    await new Promise<void>((done) => {
      const probe = connect(443, '127.0.0.1', () => {
        probe.destroy();
        done();
      });
    });
    await new Promise((done) => setTimeout(done, 50));
    expect(connections).toBe(1);

    connections = 0;
    await expect(
      fetchPage('https://rebind.example/', { resolve: always(LOOPBACK) }),
    ).rejects.toThrow(WebFetchError);
    await new Promise((done) => setTimeout(done, 50));
    expect(connections).toBe(0);
  });
});
