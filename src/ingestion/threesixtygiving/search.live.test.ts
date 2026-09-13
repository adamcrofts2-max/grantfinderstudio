/**
 * The corpus-wide grant search, over a real socket.
 *
 * A fixture test would prove the parsing and nothing else. Every fault found
 * during the first real deployment lived in the gap between "the code is
 * shaped right" and "the service agrees" — so this stands up an HTTP server,
 * points the real `FetchJsonClient` at it, and asserts on what the connector
 * does with real responses, real status codes and a real query string.
 *
 * The live 360Giving API is unreachable from the build environment, so this is
 * the closest thing to the truth available here.
 */

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IngestionError, ThreeSixtyGivingConnector } from './connector.js';
import { FetchJsonClient } from './http.js';

let server: Server;
let baseUrl: string;
let requests: string[] = [];
let respond: (url: URL) => { status: number; body: string; type?: string };

const grant = (id: string, over: Record<string, unknown> = {}) => ({
  data: {
    id,
    title: 'Green Skills Programme',
    description: 'Practical skills for young people',
    currency: 'GBP',
    amountAwarded: 24_000,
    awardDate: '2025-06-01',
    recipientOrganization: [{ id: 'GB-COH-1', name: 'Wells Youth Collective' }],
    beneficiaryLocation: [{ name: 'Somerset' }],
    classifications: [{ title: 'Children and young people' }],
    ...over,
  },
  funders: [{ org_id: 'GB-CHC-1164883', name: 'The Somerset Trust' }],
  publisher: { org_id: 'GB-CHC-1164883', name: 'Somerset Community Foundation' },
});

beforeEach(async () => {
  requests = [];
  respond = () => ({ status: 200, body: JSON.stringify({ count: 1, results: [grant('g1')] }) });
  server = createServer((req, res) => {
    requests.push(req.url ?? '');
    const { status, body, type } = respond(new URL(req.url ?? '/', 'http://x'));
    res.writeHead(status, { 'content-type': type ?? 'application/json' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/v1/`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const connector = (searchPath?: string) =>
  new ThreeSixtyGivingConnector(new FetchJsonClient({ timeoutMs: 5000 }), {
    baseUrl,
    ...(searchPath === undefined ? {} : { searchPath }),
  });

describe('searching the whole corpus', () => {
  it('sends the pattern and a bounded limit', async () => {
    await connector().searchGrants('youth|skills', 25);
    const sent = new URL(requests[0] ?? '', 'http://x');
    expect(sent.pathname).toBe('/api/v1/CurrentLatestGrants/');
    expect(sent.searchParams.get('search')).toBe('youth|skills');
    expect(sent.searchParams.get('limit')).toBe('25');
  });

  it('never asks for more than the service should be asked for at once', async () => {
    await connector().searchGrants('youth', 100_000);
    expect(new URL(requests[0] ?? '', 'http://x').searchParams.get('limit')).toBe('100');
  });

  it('unwraps the standard record and names who gave the grant', async () => {
    const { grants, total } = await connector().searchGrants('youth');
    expect(total).toBe(1);
    expect(grants[0]?.raw.id).toBe('g1');
    expect(grants[0]?.funderId).toBe('GB-CHC-1164883');
    expect(grants[0]?.funderName).toBe('The Somerset Trust');
    expect(grants[0]?.publisherName).toBe('Somerset Community Foundation');
  });

  it('reads a response with the grant at the top level too', async () => {
    // Tolerating both shapes because the wrapper could not be confirmed
    // against the live service, and a search that returns nothing looks
    // identical to a corpus with no match.
    respond = () => ({
      status: 200,
      body: JSON.stringify({ count: 1, results: [{ id: 'flat', amountAwarded: 1 }] }),
    });
    const { grants } = await connector().searchGrants('youth');
    expect(grants[0]?.raw.id).toBe('flat');
  });

  it('refuses an empty pattern at the boundary that would make the request', async () => {
    // An empty regex matches the whole corpus.
    await expect(connector().searchGrants('  ')).rejects.toThrow(IngestionError);
    expect(requests).toHaveLength(0);
  });

  it('says the route may have moved when the shape is wrong', async () => {
    // The most likely failure in production: the path could not be verified
    // from here. A 200 carrying something else must not read as "no grants".
    respond = () => ({ status: 200, body: JSON.stringify({ detail: 'Not found' }) });
    await expect(connector().searchGrants('youth')).rejects.toThrow(/route may have moved/u);
  });

  it('fails loudly on HTML served with a 200', async () => {
    respond = () => ({ status: 200, body: '<html>maintenance</html>', type: 'text/html' });
    await expect(connector().searchGrants('youth')).rejects.toThrow();
  });

  it('fails loudly on a 503 rather than reporting no results', async () => {
    respond = () => ({ status: 503, body: 'unavailable', type: 'text/plain' });
    await expect(connector().searchGrants('youth')).rejects.toThrow();
  });

  it('honours a corrected search path without a code change', async () => {
    await connector('grants/').searchGrants('youth');
    expect(new URL(requests[0] ?? '', 'http://x').pathname).toBe('/api/v1/grants/');
  });
});
