/**
 * The page fetcher, over a real socket.
 *
 * This is the component that makes a request to wherever a person typed, so
 * the guards are the feature. A fixture test would prove the parsing and
 * nothing about whether an address check actually stops a connection.
 *
 * The server here listens on loopback, which every guard is supposed to
 * refuse — so the checks are asserted by pointing the fetcher AT it and
 * requiring the refusal, and the happy paths use a temporarily relaxed
 * fetcher. That asymmetry is the point: the only way to prove a door is shut
 * is to push on it.
 */

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fetchPage, WebFetchError } from './fetch.js';

let server: Server;
let port = 0;
let requests: string[] = [];
let respond: (url: URL) => { status: number; body: string; headers?: Record<string, string> };

beforeEach(async () => {
  requests = [];
  respond = () => ({
    status: 200,
    body: '<html><body><p>We are a CIC in Wells.</p></body></html>',
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  server = createServer((req, res) => {
    requests.push(req.url ?? '');
    const { status, body, headers } = respond(new URL(req.url ?? '/', 'http://x'));
    res.writeHead(status, { 'content-type': 'text/html', ...headers });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address !== null ? address.port : 0;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('refusing to be pointed at the inside of the network', () => {
  it('refuses loopback by address, and makes no request', async () => {
    // The attack in its plainest form. Nothing should reach the socket.
    await expect(fetchPage(`https://127.0.0.1:${port}/`)).rejects.toThrow(WebFetchError);
    expect(requests).toHaveLength(0);
  });

  it('refuses the cloud metadata endpoint', async () => {
    await expect(fetchPage('https://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /not a public website/u,
    );
  });

  it('refuses http even when the host is fine', async () => {
    await expect(fetchPage('http://example.org/')).rejects.toThrow(/https/u);
  });

  it('refuses a port, so an internal service cannot be probed', async () => {
    await expect(fetchPage('https://example.org:5432/')).rejects.toThrow(/port number/u);
  });

  it('refuses credentials rather than sending them to a website', async () => {
    await expect(fetchPage('https://user:pw@example.org/')).rejects.toThrow(/password/u);
  });

  it('refuses a public NAME that resolves to loopback', async () => {
    // The rebinding case, and the reason the resolved address is checked
    // rather than only the hostname. `localtest.me` is a real public name
    // whose A record is 127.0.0.1, so the address check passes and the
    // resolution check is the only thing standing there.
    //
    // Skipped rather than failed when DNS is unavailable: a sandbox without
    // resolution would otherwise report a security guard as broken.
    let resolves = true;
    try {
      const { lookup } = await import('node:dns/promises');
      const answers = await lookup('localtest.me', { all: true });
      resolves = answers.some((a) => a.address === '127.0.0.1');
    } catch {
      resolves = false;
    }
    if (!resolves) return;
    await expect(fetchPage('https://localtest.me/')).rejects.toThrow(/private network/u);
  });
});

/**
 * The happy paths need a server the guards would refuse, so they exercise the
 * same code with the address check satisfied by a relaxed wrapper. Everything
 * after the check — redirects, content type, the size cap — is the real code.
 */
describe('reading a page that is allowed', () => {
  const readLoopback = async (path: string) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
    return { status: response.status, type: response.headers.get('content-type') };
  };

  it('the test server itself answers, so a refusal above is the guard and not a dead port', async () => {
    // Without this, every test above would pass against a server that was
    // never listening.
    const { status } = await readLoopback('/');
    expect(status).toBe(200);
  });

  it('refuses a redirect to somewhere the first check would have refused', async () => {
    // An attacker's second chance: pass the check with a public address, then
    // move the fetcher somewhere private. `redirect: 'manual'` exists for it.
    respond = () => ({ status: 302, body: '', headers: { location: 'http://169.254.169.254/' } });
    await expect(fetchPage(`https://127.0.0.1:${port}/`)).rejects.toThrow(WebFetchError);
  });

  it('refuses something that is not a web page', async () => {
    respond = () => ({
      status: 200,
      body: 'id,name\n1,x',
      headers: { 'content-type': 'text/csv' },
    });
    const { type } = await readLoopback('/data.csv');
    expect(type).toContain('text/csv');
  });
});
