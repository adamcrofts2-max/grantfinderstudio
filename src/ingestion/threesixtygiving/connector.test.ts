import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { summariseFunderBehaviour } from '../../domain/funder/behaviour.js';
import {
  assertSameOrigin,
  IngestionError,
  THREESIXTYGIVING_BASE_URL,
  ThreeSixtyGivingConnector,
  type HttpClient,
} from './connector.js';
import type { SourceDataset } from './types.js';

const LICENSED: SourceDataset = {
  id: 'ds_fictional',
  name: 'Fictional Trust grants (fixture)',
  publisher: 'The Fictional Trust',
  licence: 'CC-BY-4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'Fictional fixture data',
  retrievedAt: '2026-09-06T00:00:00Z',
};

async function fixture(name: string): Promise<unknown> {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Records the URLs requested so pagination behaviour can be asserted. */
class RecordingHttpClient implements HttpClient {
  readonly requested: string[] = [];
  constructor(private readonly responses: Map<string, unknown>) {}

  async getJson(url: string): Promise<unknown> {
    this.requested.push(url);
    const response = this.responses.get(url);
    if (response === undefined) throw new Error(`Unexpected request to ${url}`);
    return response;
  }
}

const PAGE_1 = `${THREESIXTYGIVING_BASE_URL}org/GB-FICTIONAL-001/grants_made/`;
const PAGE_2 =
  'https://api.threesixtygiving.org/api/v1/org/GB-FICTIONAL-001/grants_made/?page=2';

let http: RecordingHttpClient;
let connector: ThreeSixtyGivingConnector;

beforeEach(async () => {
  http = new RecordingHttpClient(
    new Map([
      [PAGE_1, await fixture('grants-page-1.json')],
      [PAGE_2, await fixture('grants-page-2.json')],
    ]),
  );
  connector = new ThreeSixtyGivingConnector(http);
});

describe('fetchAwardsByFunder', () => {
  it('follows pagination to the end', async () => {
    const result = await connector.fetchAwardsByFunder('GB-FICTIONAL-001', LICENSED);
    expect(http.requested).toEqual([PAGE_1, PAGE_2]);
    expect(result.pagesFetched).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('keeps only records it can read correctly', async () => {
    const result = await connector.fetchAwardsByFunder('GB-FICTIONAL-001', LICENSED);
    expect(result.awards.map((a) => a.id)).toEqual([
      '360G-fictional-0001',
      '360G-fictional-0002',
      '360G-fictional-0003',
      '360G-fictional-0004',
      '360G-fictional-0005',
    ]);
  });

  it('rejects the unusable records with stated reasons', async () => {
    const result = await connector.fetchAwardsByFunder('GB-FICTIONAL-001', LICENSED);
    expect(result.rejected).toHaveLength(3);
    const reasons = result.rejected.map((r) => r.reason).join(' ');
    expect(reasons).toContain('EUR');
    expect(reasons).toContain('amount');
    expect(reasons).toContain('award date');
  });

  it('drops the record duplicated across pages', async () => {
    const result = await connector.fetchAwardsByFunder('GB-FICTIONAL-001', LICENSED);
    const ids = result.awards.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries the licence through with the data', async () => {
    const result = await connector.fetchAwardsByFunder('GB-FICTIONAL-001', LICENSED);
    expect(result.dataset.licence).toBe('CC-BY-4.0');
    expect(result.dataset.attribution).toBe('Fictional fixture data');
  });

  it('stops at maxPages and says it was truncated', async () => {
    const limited = new ThreeSixtyGivingConnector(http, { maxPages: 1 });
    const result = await limited.fetchAwardsByFunder('GB-FICTIONAL-001', LICENSED);
    expect(result.pagesFetched).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.awards).toHaveLength(3);
  });

  it('requires a funder id', async () => {
    await expect(connector.fetchAwardsByFunder('  ', LICENSED)).rejects.toThrow(
      IngestionError,
    );
  });
});

describe('licence enforcement', () => {
  it('refuses to ingest a dataset with no licence', async () => {
    await expect(
      connector.fetchAwardsByFunder('GB-FICTIONAL-001', { ...LICENSED, licence: '' }),
    ).rejects.toThrow(/no licence or attribution/);
  });

  it('refuses to ingest a dataset with no attribution', async () => {
    await expect(
      connector.fetchAwardsByFunder('GB-FICTIONAL-001', { ...LICENSED, attribution: '  ' }),
    ).rejects.toThrow(/no licence or attribution/);
  });

  it('refuses before making any request', async () => {
    await expect(
      connector.fetchAwardsByFunder('GB-FICTIONAL-001', { ...LICENSED, licence: '' }),
    ).rejects.toThrow();
    expect(http.requested).toEqual([]);
  });
});

describe('assertSameOrigin', () => {
  it('accepts a link on the same host', () => {
    expect(assertSameOrigin(PAGE_2, THREESIXTYGIVING_BASE_URL).host).toBe(
      'api.threesixtygiving.org',
    );
  });

  it('rejects a link to another host', () => {
    expect(() =>
      assertSameOrigin('https://attacker.example/next', THREESIXTYGIVING_BASE_URL),
    ).toThrow(/points to attacker.example/);
  });

  it('rejects a link to an internal address', () => {
    expect(() =>
      assertSameOrigin('https://169.254.169.254/latest/meta-data/', THREESIXTYGIVING_BASE_URL),
    ).toThrow(IngestionError);
  });

  it('rejects a downgrade to http', () => {
    expect(() =>
      assertSameOrigin('http://api.threesixtygiving.org/api/v1/x', THREESIXTYGIVING_BASE_URL),
    ).toThrow(/must use https/);
  });

  it('rejects a non-URL', () => {
    expect(() => assertSameOrigin('/relative/path', THREESIXTYGIVING_BASE_URL)).toThrow(
      /not a valid URL/,
    );
  });

  it('is enforced while paginating', async () => {
    const hostile = new RecordingHttpClient(
      new Map<string, unknown>([
        [PAGE_1, { results: [], next: 'https://attacker.example/page2' }],
      ]),
    );
    const c = new ThreeSixtyGivingConnector(hostile);
    await expect(c.fetchAwardsByFunder('GB-FICTIONAL-001', LICENSED)).rejects.toThrow(
      /attacker.example/,
    );
  });
});

describe('malformed responses', () => {
  it.each([
    ['not an object', 'a string'],
    ['null', null],
    ['an object with no results array', { count: 3 }],
    ['results of the wrong type', { results: 'nope' }],
  ])('fails clearly when the response is %s', async (_label, payload) => {
    const bad = new RecordingHttpClient(new Map<string, unknown>([[PAGE_1, payload]]));
    const c = new ThreeSixtyGivingConnector(bad);
    await expect(c.fetchAwardsByFunder('GB-FICTIONAL-001', LICENSED)).rejects.toThrow(
      IngestionError,
    );
  });

  it('treats an empty next link as the end of pagination', async () => {
    const single = new RecordingHttpClient(
      new Map<string, unknown>([[PAGE_1, { results: [], next: '' }]]),
    );
    const c = new ThreeSixtyGivingConnector(single);
    const result = await c.fetchAwardsByFunder('GB-FICTIONAL-001', LICENSED);
    expect(result.pagesFetched).toBe(1);
    expect(result.awards).toEqual([]);
  });
});

describe('ingestion through to a funder summary', () => {
  it('produces figures a CIC could act on', async () => {
    const result = await connector.fetchAwardsByFunder('GB-FICTIONAL-001', LICENSED);
    const summary = summariseFunderBehaviour(result.awards, '2026-09-06');

    expect(summary.kind).toBe('summary');
    if (summary.kind !== 'summary') return;

    // Amounts across the five usable fixtures: 8k, 15k, 22k, 31k, 40k.
    expect(summary.behaviour.amounts).toEqual({
      min: 8000,
      lowerQuartile: 15_000,
      median: 22_000,
      upperQuartile: 31_000,
      max: 40_000,
    });
    expect(summary.behaviour.regions[0]).toEqual({ value: 'Somerset', count: 3 });
    expect(summary.behaviour.jurisdictions[0]).toEqual({ value: 'england', count: 4 });
  });
});
