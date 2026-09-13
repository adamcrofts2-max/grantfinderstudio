/**
 * The corpus-wide grant search, over a real socket.
 *
 * A fixture test would prove the parsing and nothing else. Every fault found
 * during the first real deployment lived in the gap between "the code is
 * shaped right" and "the service agrees" — so this stands up an HTTP server,
 * points the real `FetchJsonClient` at it, and asserts on what the connector
 * does with real responses, real status codes and a real query string.
 *
 * The live 360Giving API is unreachable from the build environment. What IS
 * reachable is their source: this file's fixtures are the shape produced by
 * `CurrentLatestGrantSerializer` in `ThreeSixtyGiving/datastore` at 4a57c2e —
 * a `ModelSerializer` over their `Grant` model excluding `id`, `getter_run`,
 * `latest` and `source_file`. So a row is `grant_id`, `data`,
 * `additional_data` and the three denormalised org columns, and NOT the
 * `{ funders: [...], publisher: {...} }` shape the per-organisation endpoints
 * return. Getting that wrong is why the first version read nulls for every
 * funder.
 */

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SEARCH_PATH, IngestionError, ThreeSixtyGivingConnector } from './connector.js';
import { FetchJsonClient } from './http.js';

let server: Server;
let baseUrl: string;
let requests: string[] = [];
let respond: (url: URL) => { status: number; body: string; type?: string };

/** One row as `CurrentLatestGrants` serialises it. */
const grant = (id: string, over: Record<string, unknown> = {}) => ({
  grant_id: id,
  data: {
    id,
    title: 'Green Skills Programme',
    description: 'Practical skills for young people',
    currency: 'GBP',
    amountAwarded: 24_000,
    awardDate: '2025-06-01',
    fundingOrganization: [{ id: 'GB-CHC-1164883', name: 'The Somerset Trust' }],
    recipientOrganization: [{ id: 'GB-COH-1', name: 'Wells Youth Collective' }],
    beneficiaryLocation: [{ name: 'Somerset' }],
    classifications: [{ title: 'Children and young people' }],
  },
  additional_data: {
    metadata: {
      source_license: 'https://creativecommons.org/licenses/by-sa/4.0/',
      source_license_name: 'Creative Commons Attribution-ShareAlike 4.0',
    },
  },
  publisher_org_id: 'GB-CHC-1054107',
  recipient_org_ids: ['GB-COH-1'],
  funding_org_ids: ['GB-CHC-1164883'],
  ...over,
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

describe('the route the search is actually at', () => {
  it('sits beside the versioned API rather than under it', async () => {
    // Two 404s came from writing this relative to the base. `experimental/` is
    // mounted on `api/`, not on `api/v1/`, so a base-relative path lands in
    // the wrong place.
    await connector().searchGrants('youth');
    expect(new URL(requests[0] ?? '', 'http://x').pathname).toBe(
      '/api/experimental/CurrentLatestGrants',
    );
  });

  it('carries no trailing slash, because Django will not remove one', async () => {
    // APPEND_SLASH only ever ADDS a slash. Their path is declared without one,
    // so `CurrentLatestGrants/` matches no pattern and 404s — which is the
    // 404 the live service actually returned.
    expect(DEFAULT_SEARCH_PATH.endsWith('/')).toBe(false);
    expect(DEFAULT_SEARCH_PATH).toBe('/api/experimental/CurrentLatestGrants');
  });
});

describe('searching the whole corpus', () => {
  it('sends the pattern and a bounded limit', async () => {
    await connector().searchGrants('youth|skills', 25);
    const sent = new URL(requests[0] ?? '', 'http://x');
    expect(sent.searchParams.get('search')).toBe('youth|skills');
    expect(sent.searchParams.get('limit')).toBe('25');
  });

  it('never asks for more than the service should be asked for at once', async () => {
    await connector().searchGrants('youth', 100_000);
    expect(new URL(requests[0] ?? '', 'http://x').searchParams.get('limit')).toBe('100');
  });

  it('reads the denormalised columns the corpus search actually returns', async () => {
    const { grants, total } = await connector().searchGrants('youth');
    expect(total).toBe(1);
    expect(grants[0]?.raw.id).toBe('g1');
    expect(grants[0]?.funderId).toBe('GB-CHC-1164883');
    expect(grants[0]?.publisherId).toBe('GB-CHC-1054107');
  });

  it('takes the funder NAME from the publisher record, the only place it exists', async () => {
    // Their `OrganisationRef` dataclass holds an org_id and nothing else, so
    // no endpoint names a funder. The 360G record the publisher wrote does.
    const { grants } = await connector().searchGrants('youth');
    expect(grants[0]?.funderName).toBe('The Somerset Trust');
  });

  it('carries the licence THIS publisher chose, per grant', async () => {
    // Not one licence for the corpus: publishers pick their own and some are
    // share-alike, so attribution has to come from the row.
    const { grants } = await connector().searchGrants('youth');
    expect(grants[0]?.licence).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(grants[0]?.licenceName).toBe('Creative Commons Attribution-ShareAlike 4.0');
  });

  it('reads the per-organisation shape too, where ids arrive as references', async () => {
    // `grants_made/` serialises `funders: [{ org_id, self }]` instead. One
    // reader serves both so a row means the same thing wherever it came from.
    respond = () => ({
      status: 200,
      body: JSON.stringify({
        count: 1,
        results: [
          {
            grant_id: 'ref',
            data: { id: 'ref', fundingOrganization: [{ id: 'GB-CHC-9', name: 'Ref Trust' }] },
            funders: [{ org_id: 'GB-CHC-9' }],
            publisher: { org_id: 'GB-CHC-10' },
          },
        ],
      }),
    });
    const { grants } = await connector().searchGrants('youth');
    expect(grants[0]?.funderId).toBe('GB-CHC-9');
    expect(grants[0]?.publisherId).toBe('GB-CHC-10');
    expect(grants[0]?.funderName).toBe('Ref Trust');
  });

  it('survives a row with no licence and no funder id', async () => {
    // Their additional_data is nullable, and a publisher can omit a funder id.
    // Missing provenance must read as missing, not throw.
    respond = () => ({
      status: 200,
      body: JSON.stringify({ count: 1, results: [{ grant_id: 'bare', data: { id: 'bare' } }] }),
    });
    const { grants } = await connector().searchGrants('youth');
    expect(grants[0]?.funderId).toBeNull();
    expect(grants[0]?.licence).toBeNull();
    expect(grants[0]?.licenceName).toBeNull();
  });

  it('reads a response with the grant at the top level too', async () => {
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
});

describe('when the route is gone', () => {
  beforeEach(() => {
    respond = () => ({ status: 404, body: JSON.stringify({ detail: 'Not found' }) });
  });

  it('makes exactly one request, and does not go hunting', async () => {
    // An earlier version asked the API for an index of its routes and
    // suggested one. That could never have worked: `/api/` serves an HTML
    // landing page and `/` serves their web UI, so there was no index to
    // read — three round trips to produce a worse message.
    await expect(connector().searchGrants('youth')).rejects.toThrow(IngestionError);
    expect(requests).toHaveLength(1);
  });

  it('says where to correct it, and that loading one funder still works', async () => {
    // The two things a person needs: this is fixable without a redeploy, and
    // the rest of the product has not stopped.
    await expect(connector().searchGrants('youth')).rejects.toThrow(/settable under Services/u);
    await expect(connector().searchGrants('youth')).rejects.toThrow(/grants_made/u);
  });

  it('names the route it asked for, so the report is checkable', async () => {
    await expect(connector('/api/nope').searchGrants('youth')).rejects.toThrow(
      /"\/api\/nope" is not there/u,
    );
  });
});

describe('correcting the route without a redeploy', () => {
  it('honours a configured path', async () => {
    await connector('/api/v2/grants').searchGrants('youth');
    expect(new URL(requests[0] ?? '', 'http://x').pathname).toBe('/api/v2/grants');
  });

  it('honours a base-relative path, for a route that does live under the base', async () => {
    await connector('grants/').searchGrants('youth');
    expect(new URL(requests[0] ?? '', 'http://x').pathname).toBe('/api/v1/grants/');
  });
});
