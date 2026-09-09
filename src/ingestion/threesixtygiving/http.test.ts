import { describe, expect, it, vi } from 'vitest';

import { FetchJsonClient, MAX_RESPONSE_BYTES } from './http.js';
import { IngestionError } from './connector.js';

function ok(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers });
}

/** A clock and a sleep that advance together, so no test waits in real time. */
function fakeTime() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    get value() {
      return t;
    },
  };
}

describe('the JSON client', () => {
  it('returns a parsed body', async () => {
    const fetchImpl = vi.fn(async () => ok({ results: [1, 2] }));
    const client = new FetchJsonClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.getJson('https://example.org/a')).toEqual({ results: [1, 2] });
  });

  it('sends an identifying user agent', async () => {
    const seen: RequestInit[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init) seen.push(init);
      return ok({});
    });
    const client = new FetchJsonClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.getJson('https://example.org/a');
    const headers = seen[0]?.headers as Record<string, string> | undefined;
    expect(headers?.['user-agent']).toContain('GrantFinderStudio');
  });

  it('spaces requests to the published rate limit', async () => {
    // Two a second. A paginating ingest walks straight through that unless
    // something holds it back, and being blocked is the polite failure mode.
    const clock = fakeTime();
    const startedAt: number[] = [];
    const fetchImpl = vi.fn(async () => {
      startedAt.push(clock.now());
      return ok({});
    });
    const client = new FetchJsonClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: clock.now,
      sleep: clock.sleep,
    });

    await client.getJson('https://example.org/1');
    await client.getJson('https://example.org/2');
    await client.getJson('https://example.org/3');

    expect(startedAt).toHaveLength(3);
    expect((startedAt[1] ?? 0) - (startedAt[0] ?? 0)).toBeGreaterThanOrEqual(500);
    expect((startedAt[2] ?? 0) - (startedAt[1] ?? 0)).toBeGreaterThanOrEqual(500);
  });

  it('does not wait when enough time has already passed', async () => {
    const clock = fakeTime();
    const startedAt: number[] = [];
    const fetchImpl = vi.fn(async () => {
      startedAt.push(clock.now());
      return ok({});
    });
    const client = new FetchJsonClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: clock.now,
      sleep: clock.sleep,
    });
    await client.getJson('https://example.org/1');
    clock.advance(5000);
    await client.getJson('https://example.org/2');
    expect((startedAt[1] ?? 0) - (startedAt[0] ?? 0)).toBe(5000);
  });

  it('keeps limiting after a failure rather than letting the queue break', async () => {
    const clock = fakeTime();
    let call = 0;
    const startedAt: number[] = [];
    const fetchImpl = vi.fn(async () => {
      startedAt.push(clock.now());
      call += 1;
      if (call === 1) throw new Error('network down');
      return ok({});
    });
    const client = new FetchJsonClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: clock.now,
      sleep: clock.sleep,
    });
    await expect(client.getJson('https://example.org/1')).rejects.toThrow(IngestionError);
    await client.getJson('https://example.org/2');
    expect((startedAt[1] ?? 0) - (startedAt[0] ?? 0)).toBeGreaterThanOrEqual(500);
  });

  it('fails loudly on a non-200 rather than returning nothing', async () => {
    // The dangerous failure: an empty page looks to the connector like a
    // publisher with no grants, and it would then delete every award we hold.
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const client = new FetchJsonClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.getJson('https://example.org/a')).rejects.toThrow(/returned 500/);
  });

  it('names the rate limit when it is the reason', async () => {
    const fetchImpl = vi.fn(async () => new Response('slow down', { status: 429 }));
    const client = new FetchJsonClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.getJson('https://example.org/a')).rejects.toThrow(/rate limit/);
  });

  it('fails on an HTML error page rather than parsing it as empty', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<html>maintenance</html>', { status: 200 }),
    );
    const client = new FetchJsonClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.getJson('https://example.org/a')).rejects.toThrow(/did not return JSON/);
  });

  it('refuses a response larger than the cap', async () => {
    const fetchImpl = vi.fn(async () =>
      ok({}, { 'content-length': String(MAX_RESPONSE_BYTES + 1) }),
    );
    const client = new FetchJsonClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.getJson('https://example.org/a')).rejects.toThrow(/over the/);
  });

  it('reports an unreachable host as an ingestion error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    const client = new FetchJsonClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.getJson('https://example.org/a')).rejects.toThrow(/Could not reach/);
  });
});
