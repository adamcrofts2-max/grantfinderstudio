/**
 * Reading 360Giving's published routes, over a real socket.
 *
 * The fixtures here are the shape the API actually sends, which is the whole
 * point of the file. The ones in `fixtures/` were written from the 360Giving
 * Data STANDARD and put the grant at the top level of each result; the API
 * wraps it in `data`. So the per-funder ingest was handing the wrapper to the
 * normaliser and would have rejected every real grant as having no id, no
 * currency and no date — and the tests passed, because they asserted against
 * the same wrong shape.
 *
 * A fixture written from a specification is a guess about a service. These are
 * read from `ThreeSixtyGiving/datastore` at 4a57c2e: `GrantSerializer` for the
 * grant routes, `OrganisationListSerializer` for the funder list.
 */

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readGrantRow, ThreeSixtyGivingConnector } from './connector.js';
import { FetchJsonClient } from './http.js';
import type { SourceDataset } from './types.js';

let server: Server;
let baseUrl: string;
let requests: string[] = [];
let respond: (url: URL) => { status: number; body: string; type?: string };

/** One row as `GrantSerializer` sends it: the standard record under `data`. */
const grantRow = (id: string, over: Record<string, unknown> = {}) => ({
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
    beneficiaryLocation: [{ name: 'Somerset' }, { name: 'England' }],
    classifications: [{ title: 'Children and young people' }],
  },
  data_license: {
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    name: 'Creative Commons Attribution-ShareAlike 4.0',
  },
  publisher: { org_id: 'GB-CHC-1054107' },
  recipients: [{ org_id: 'GB-COH-1' }],
  funders: [{ org_id: 'GB-CHC-1164883' }],
  ...over,
});

const LICENSED: SourceDataset = {
  id: 'ds_test',
  name: '360Giving — Test',
  publisher: 'Test',
  licence: 'CC-BY',
  licenceUrl: 'https://example.org/licence',
  attribution: 'Test, published to the 360Giving Data Standard',
  retrievedAt: '2026-09-13T00:00:00.000Z',
};

beforeEach(async () => {
  requests = [];
  respond = () => ({
    status: 200,
    body: JSON.stringify({ count: 1, next: null, results: [grantRow('g1')] }),
  });
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

const connector = () =>
  new ThreeSixtyGivingConnector(new FetchJsonClient({ timeoutMs: 5000 }), { baseUrl });

describe('reading one grant row', () => {
  it('unwraps `data`, which is the bug that would have rejected every grant', () => {
    const row = readGrantRow(grantRow('g1'));
    expect(row?.raw.id).toBe('g1');
    expect(row?.raw.currency).toBe('GBP');
  });

  it('still accepts a grant at the top level, so a flat fixture keeps working', () => {
    const row = readGrantRow({ id: 'flat', currency: 'GBP', amountAwarded: 1 });
    expect(row?.raw.id).toBe('flat');
  });

  it('reads the licence from `data_license` on the v1 routes', () => {
    const row = readGrantRow(grantRow('g1'));
    expect(row?.licence).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(row?.licenceName).toBe('Creative Commons Attribution-ShareAlike 4.0');
  });

  it('reads it from `additional_data.metadata` on the corpus shape', () => {
    const row = readGrantRow({
      grant_id: 'x',
      data: { id: 'x' },
      additional_data: { metadata: { source_license: 'https://example.org/l', source_license_name: 'L' } },
      funding_org_ids: ['GB-CHC-9'],
      publisher_org_id: 'GB-CHC-10',
    });
    expect(row?.licence).toBe('https://example.org/l');
    expect(row?.funderId).toBe('GB-CHC-9');
    expect(row?.publisherId).toBe('GB-CHC-10');
  });

  it('names the funder from the record, the only place a name exists', () => {
    // Their OrganisationRef dataclass holds an org_id and nothing else, so no
    // endpoint names a funder on a grant.
    const row = readGrantRow(grantRow('g1'));
    expect(row?.funderId).toBe('GB-CHC-1164883');
    expect(row?.funderName).toBe('The Somerset Trust');
  });

  it('reads a row with no licence and no organisations as missing, not broken', () => {
    const row = readGrantRow({ grant_id: 'bare', data: { id: 'bare' } });
    expect(row?.funderId).toBeNull();
    expect(row?.licence).toBeNull();
  });
});

describe('one funder’s awarded grants', () => {
  it('normalises what the API actually sends', async () => {
    // The regression that matters: before the shared reader, this produced
    // zero awards and a rejection for every row.
    const result = await connector().fetchAwardsByFunder('GB-CHC-1164883', LICENSED);
    expect(result.rejected).toHaveLength(0);
    expect(result.awards).toHaveLength(1);
    expect(result.awards[0]?.amountGbp).toBe(24_000);
    expect(result.awards[0]?.title).toBe('Green Skills Programme');
  });

  it('asks the published route for it', async () => {
    await connector().fetchAwardsByFunder('GB-CHC-1164883', LICENSED);
    expect(new URL(requests[0] ?? '', 'http://x').pathname).toBe(
      '/api/v1/org/GB-CHC-1164883/grants_made/',
    );
  });

  it('still refuses to ingest without a licence supplied', async () => {
    // Unchanged rule: a person ingesting one named funder asserts the licence.
    await expect(
      connector().fetchAwardsByFunder('GB-CHC-1', { ...LICENSED, licence: '' }),
    ).rejects.toThrow(/licence/u);
    expect(requests).toHaveLength(0);
  });

  it('follows pagination, and refuses a link to another host', async () => {
    respond = (url) =>
      url.pathname.endsWith('/grants_made/') && url.search === ''
        ? {
            status: 200,
            body: JSON.stringify({
              count: 2,
              next: 'https://elsewhere.example/api/v1/org/x/grants_made/?offset=1',
              results: [grantRow('g1')],
            }),
          }
        : { status: 200, body: JSON.stringify({ count: 2, next: null, results: [] }) };

    await expect(
      connector().fetchAwardsByFunder('GB-CHC-1164883', LICENSED),
    ).rejects.toThrow(/elsewhere\.example/u);
  });
});

describe('discovering the licence from the grants themselves', () => {
  it('reads it off the rows, so a funder off a list needs nobody to assert it', async () => {
    const found = await connector().fetchAwardsDiscoveringLicence('GB-CHC-1164883');
    expect(found.licence).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(found.licenceName).toBe('Creative Commons Attribution-ShareAlike 4.0');
    expect(found.funderName).toBe('The Somerset Trust');
    expect(found.awards).toHaveLength(1);
  });

  it('reports no licence rather than inventing one', async () => {
    // The caller SKIPS these. Refusing unlicensed data is still the rule; only
    // who states the licence changed.
    respond = () => ({
      status: 200,
      body: JSON.stringify({
        count: 1,
        next: null,
        results: [grantRow('g1', { data_license: null })],
      }),
    });
    const found = await connector().fetchAwardsDiscoveringLicence('GB-CHC-1164883');
    expect(found.licence).toBeNull();
    expect(found.awards).toHaveLength(1);
  });

  it('takes the first row that states one, tolerating a row that does not', async () => {
    respond = () => ({
      status: 200,
      body: JSON.stringify({
        count: 2,
        next: null,
        results: [grantRow('g1', { data_license: null }), grantRow('g2')],
      }),
    });
    const found = await connector().fetchAwardsDiscoveringLicence('GB-CHC-1164883');
    expect(found.licence).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
  });
});

describe('the funder list', () => {
  beforeEach(() => {
    respond = () => ({
      status: 200,
      body: JSON.stringify({
        count: 4200,
        results: [
          { org_id: 'GB-CHC-1', name: 'The First Trust', self: 'http://x/api/v1/org/GB-CHC-1/' },
          { org_id: 'GB-CHC-2', name: '' },
          { name: 'No id at all' },
        ],
      }),
    });
  });

  it('asks the published route with a limit and an offset', async () => {
    await connector().fetchFunderPage(1000, 500);
    const sent = new URL(requests[0] ?? '', 'http://x');
    expect(sent.pathname).toBe('/api/v1/org/funder/');
    expect(sent.searchParams.get('limit')).toBe('500');
    expect(sent.searchParams.get('offset')).toBe('1000');
  });

  it('never asks for more than a page than the service serves', async () => {
    // Their paginator's default is 1000 and asking beyond it gains nothing.
    await connector().fetchFunderPage(0, 99_999);
    expect(new URL(requests[0] ?? '', 'http://x').searchParams.get('limit')).toBe('1000');
  });

  it('keeps an unnamed funder under its id, and drops one with no id', async () => {
    // A blank name is allowed by their serialiser. The id is what fetches the
    // grants, so an unnamed funder is still worth having; an id-less row is not.
    const page = await connector().fetchFunderPage();
    expect(page.total).toBe(4200);
    expect(page.funders).toEqual([
      { orgId: 'GB-CHC-1', name: 'The First Trust' },
      { orgId: 'GB-CHC-2', name: 'GB-CHC-2' },
    ]);
  });

  it('fails loudly when the response is not a list', async () => {
    respond = () => ({ status: 200, body: JSON.stringify({ detail: 'Not found' }) });
    await expect(connector().fetchFunderPage()).rejects.toThrow(/no results array/u);
  });
});
