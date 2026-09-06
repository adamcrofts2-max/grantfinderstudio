import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CompaniesHouseClient,
  COMPANIES_HOUSE_BASE_URL,
  describeFailure,
  type FetchLike,
} from './client.js';

async function fixture(name: string): Promise<unknown> {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Records requests and replays a scripted response. */
function scripted(status: number, body: unknown) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return { status, json: async () => body };
  };
  return { calls, fetchImpl };
}

function client(fetchImpl: FetchLike) {
  return new CompaniesHouseClient({ apiKey: 'test-key', fetchImpl });
}

const throwsConnectionRefused: FetchLike = async () => {
  throw new Error('ECONNREFUSED');
};

const throwsAbort: FetchLike = async () => {
  const error = new Error('aborted');
  error.name = 'AbortError';
  throw error;
};

const throwsWithKeyInMessage: FetchLike = async () => {
  throw new Error('failed with key super-secret-key');
};

describe('construction', () => {
  it('requires a key', () => {
    expect(() => new CompaniesHouseClient({ apiKey: '  ' })).toThrow(/key is required/);
  });

  it('authenticates with the key as the basic-auth username', async () => {
    const { calls, fetchImpl } = scripted(200, { items: [] });
    await client(fetchImpl).searchByName('anything');
    const expected = `Basic ${Buffer.from('test-key:').toString('base64')}`;
    expect(calls[0]?.headers['Authorization']).toBe(expected);
  });
});

describe('searchByName', () => {
  it('returns usable matches from a real-shaped response', async () => {
    const { fetchImpl } = scripted(200, await fixture('search.json'));
    const result = await client(fetchImpl).searchByName('mendip green');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches).toHaveLength(3);
    expect(result.matches[0]).toMatchObject({
      companyNumber: '11111111',
      isCic: true,
      legalForm: 'cic_limited_by_guarantee',
    });
    // The second is a CIC limited by SHARES — the distinction that matters.
    expect(result.matches[1]).toMatchObject({
      isCic: true,
      legalForm: 'cic_limited_by_shares',
    });
    // The third is an ordinary dissolved company.
    expect(result.matches[2]).toMatchObject({ isCic: false, status: 'dissolved' });
  });

  it('encodes the query and asks for a bounded number of results', async () => {
    const { calls, fetchImpl } = scripted(200, { items: [] });
    await client(fetchImpl).searchByName('green & co');
    expect(calls[0]?.url).toContain(`${COMPANIES_HOUSE_BASE_URL}/search/companies?q=green%20%26%20co`);
    expect(calls[0]?.url).toContain('items_per_page=10');
  });

  it('does not call the API for a query too short to be meaningful', async () => {
    const { calls, fetchImpl } = scripted(200, { items: [] });
    const result = await client(fetchImpl).searchByName('a');
    expect(result).toEqual({ ok: true, matches: [] });
    expect(calls).toHaveLength(0);
  });

  it('tolerates a response with no items array', async () => {
    const { fetchImpl } = scripted(200, { total_results: 0 });
    const result = await client(fetchImpl).searchByName('nothing');
    expect(result).toEqual({ ok: true, matches: [] });
  });

  it('drops unusable records rather than failing the whole search', async () => {
    const { fetchImpl } = scripted(200, {
      items: [{ title: 'No number' }, { company_number: '1', title: 'Fine' }],
    });
    const result = await client(fetchImpl).searchByName('mixed');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches).toHaveLength(1);
  });
});

describe('fetchProfile', () => {
  it('returns a mapped profile', async () => {
    const { fetchImpl } = scripted(200, await fixture('profile.json'));
    const result = await client(fetchImpl).fetchProfile('11111111');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile).toMatchObject({
      name: 'MENDIP GREEN FUTURES CIC',
      legalForm: 'cic_limited_by_guarantee',
      incorporatedOn: '2020-01-15',
      jurisdiction: 'uk_wide',
    });
  });

  it('normalises the company number before requesting', async () => {
    const { calls, fetchImpl } = scripted(200, await fixture('profile.json'));
    await client(fetchImpl).fetchProfile('  sc123456 ');
    expect(calls[0]?.url).toContain('/company/SC123456');
  });

  it('reports a blank number as not found without calling the API', async () => {
    const { calls, fetchImpl } = scripted(200, {});
    const result = await client(fetchImpl).fetchProfile('   ');
    expect(result).toEqual({ ok: false, failure: { kind: 'not_found' } });
    expect(calls).toHaveLength(0);
  });

  it('fails when the record cannot be read', async () => {
    const { fetchImpl } = scripted(200, { company_status: 'active' });
    const result = await client(fetchImpl).fetchProfile('11111111');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('unavailable');
  });
});

describe('failure handling', () => {
  it.each([
    [401, 'unauthorised'],
    [403, 'unauthorised'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const { fetchImpl } = scripted(status, {});
    const result = await client(fetchImpl).searchByName('anything');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe(kind);
  });

  it('treats a network error as unavailable rather than throwing', async () => {
    const result = await client(throwsConnectionRefused).searchByName('anything');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({
      kind: 'unavailable',
      detail: 'Could not reach Companies House.',
    });
  });

  it('reports a timeout distinctly', async () => {
    const result = await new CompaniesHouseClient({
      apiKey: 'k', fetchImpl: throwsAbort, timeoutMs: 5,
    }).searchByName('anything');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ detail: 'Companies House did not respond in time.' });
  });

  it('never leaks the API key in a failure', async () => {
    const result = await new CompaniesHouseClient({
      apiKey: 'super-secret-key', fetchImpl: throwsWithKeyInMessage,
    }).searchByName('anything');
    expect(JSON.stringify(result)).not.toContain('super-secret-key');
  });
});

describe('describeFailure', () => {
  it('always offers the manual route when lookup is unavailable', () => {
    for (const failure of [
      { kind: 'unauthorised' } as const,
      { kind: 'rate_limited' } as const,
      { kind: 'unavailable', detail: 'x' } as const,
    ]) {
      expect(describeFailure(failure)).toContain('by hand');
    }
  });

  it('says plainly when nothing was found', () => {
    expect(describeFailure({ kind: 'not_found' })).toContain('No company');
  });
});
