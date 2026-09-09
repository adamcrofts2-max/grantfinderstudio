import { describe, expect, it } from 'vitest';

import { probeFunder } from './probe.js';
import { IngestionError, type HttpClient } from './connector.js';

const BASE = 'https://api.threesixtygiving.org/api/v1/';

function api(page: unknown): HttpClient & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    async getJson(url: string) {
      urls.push(url);
      return page;
    },
  };
}

const grant = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  currency: 'GBP',
  amountAwarded: 9000,
  awardDate: '2025-06-01',
  recipientOrganization: [{ id: 'GB-COH-1', name: 'A Recipient CIC' }],
  ...over,
});

describe('the dry run', () => {
  it('asks for that funder’s grants and writes nothing', async () => {
    const http = api({ count: 41, next: null, results: [grant()] });
    const result = await probeFunder(http, 'GB-CHC-1164883', BASE);
    expect(http.urls[0]).toContain('org/GB-CHC-1164883/grants_made/');
    expect(result.totalReported).toBe(41);
    expect(result.usableOnFirstPage).toBe(1);
  });

  it('shows one award, so the right funder can be recognised', async () => {
    const http = api({ count: 1, next: null, results: [grant()] });
    const result = await probeFunder(http, 'GB-CHC-1', BASE);
    expect(result.sample).toEqual({
      amountGbp: 9000,
      awardedOn: '2025-06-01',
      recipientName: 'A Recipient CIC',
    });
  });

  it('reports what it could not read, once per reason', async () => {
    const http = api({
      count: 3,
      next: null,
      results: [grant(), grant({ id: 'g2', currency: 'EUR' }), grant({ id: 'g3', currency: 'EUR' })],
    });
    const result = await probeFunder(http, 'GB-CHC-1', BASE);
    expect(result.usableOnFirstPage).toBe(1);
    expect(result.rejectedOnFirstPage).toBe(2);
    expect(result.rejectionReasons).toHaveLength(1);
  });

  it('says when there are more pages', async () => {
    const http = api({ count: 200, next: `${BASE}p2/`, results: [grant()] });
    expect((await probeFunder(http, 'GB-CHC-1', BASE)).hasMore).toBe(true);
  });

  it('refuses a next link pointing at another host', async () => {
    // Not followed here, but reporting "there are more pages" on the strength
    // of a link to somebody else's server would be reporting their fact.
    const http = api({ count: 2, next: 'https://elsewhere.example.org/p2/', results: [grant()] });
    await expect(probeFunder(http, 'GB-CHC-1', BASE)).rejects.toThrow(/elsewhere/);
  });

  it('points at the organisation id when the shape is wrong', async () => {
    const http = api({ detail: 'Not found.' });
    await expect(probeFunder(http, 'GB-CHC-nope', BASE)).rejects.toThrow(/organisation id/);
  });

  it('needs an organisation id', async () => {
    await expect(probeFunder(api({}), '  ', BASE)).rejects.toThrow(IngestionError);
  });

  it('handles a publisher with nothing published', async () => {
    const result = await probeFunder(api({ count: 0, next: null, results: [] }), 'GB-CHC-1', BASE);
    expect(result.usableOnFirstPage).toBe(0);
    expect(result.sample).toBeNull();
  });
});
