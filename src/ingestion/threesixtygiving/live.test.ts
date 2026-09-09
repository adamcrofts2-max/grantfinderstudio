/**
 * The whole ingest chain, over a real socket.
 *
 * Every other test in this directory substitutes something: a fake HttpClient,
 * or a fake fetch. This one starts an actual HTTP server, points the actual
 * `FetchJsonClient` at it, and runs the actual connector, normaliser and
 * persistence into the actual schema. The only things it cannot exercise are
 * TLS and 360Giving's own JSON — and the second of those is why the console
 * has a dry run.
 *
 * Worth having because the pieces were each correct and the seam between them
 * was never tested end to end: the connector took an HttpClient nothing
 * implemented, and the persistence had no caller.
 */

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FetchJsonClient } from './http.js';
import { ingestFunder, type IngestRequest } from './ingest.js';
import { probeFunder } from './probe.js';
import { readFunderHoldings } from '../../db/awards.js';
import { loadAllFunderAwards } from '../../db/queries.js';
import { summariseFunderBehaviour } from '../../domain/funder/behaviour.js';
import { createTestDatabase, type TestDatabase } from '../../db/testing/harness.js';
import type { Queryable } from '../../db/client.js';

let harness: TestDatabase;
let server: Server;
let baseUrl: string;
/** Every path the client asked for, in order. */
let asked: string[];
/** Set per test to control what the server serves. */
let respond: (path: string) => { status: number; body: string; type?: string };

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
  asked = [];

  server = createServer((req, res) => {
    const path = req.url ?? '';
    asked.push(path);
    const { status, body, type } = respond(path);
    res.writeHead(status, { 'content-type': type ?? 'application/json' });
    res.end(body);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/v1/`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  await harness.close();
});

const runInTransaction = async <T>(fn: (tx: Queryable) => Promise<T>): Promise<T> =>
  fn(harness.db as unknown as Queryable);

const request: IngestRequest = {
  orgId: 'GB-CHC-1164883',
  funderName: 'A Community Foundation',
  website: null,
  jurisdiction: 'england',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'Grant data © A Community Foundation, via 360Giving',
  publisher: 'A Community Foundation',
};

function grant(id: string, amount: number, date: string) {
  return {
    id,
    title: 'A grant',
    currency: 'GBP',
    amountAwarded: amount,
    awardDate: date,
    recipientOrganization: [{ id: `GB-COH-${id}`, name: `Recipient ${id}` }],
    classifications: [{ title: 'Children and young people' }],
    beneficiaryLocation: [{ name: 'Somerset', countryCode: 'GB' }],
  };
}

/** A client that does not wait a real half-second between pages. */
const fastClient = () => new FetchJsonClient({ minIntervalMs: 0 });

describe('the whole chain, over a socket', () => {
  it('fetches, normalises and stores a funder’s grants', async () => {
    respond = () => ({
      status: 200,
      body: JSON.stringify({
        count: 3,
        next: null,
        results: [
          grant('g1', 5000, '2024-03-01'),
          grant('g2', 9000, '2025-01-15'),
          grant('g3', 22_000, '2025-06-01'),
        ],
      }),
    });

    const outcome = await ingestFunder(fastClient(), request, runInTransaction, { baseUrl });

    expect(outcome.awardsWritten).toBe(3);
    expect(asked[0]).toContain('/api/v1/org/GB-CHC-1164883/grants_made/');

    const loaded = await loadAllFunderAwards(harness.db as unknown as Queryable);
    const found = loaded.find((f) => f.funderId === outcome.funderId);
    expect(found?.awards).toHaveLength(3);
    expect(found?.awards.map((a) => a.amountGbp).toSorted((a, b) => a - b)).toEqual([
      5000, 9000, 22_000,
    ]);
  });

  it('produces figures the prospect engine can actually use', async () => {
    // The point of ingesting at all: five or more grants is what lets the
    // product describe a funder rather than decline to.
    const amounts = [2000, 4000, 5000, 9000, 15_000, 22_000, 40_000];
    respond = () => ({
      status: 200,
      body: JSON.stringify({
        count: amounts.length,
        next: null,
        results: amounts.map((amount, i) => grant(`g${i}`, amount, '2025-06-01')),
      }),
    });

    const outcome = await ingestFunder(fastClient(), request, runInTransaction, { baseUrl });
    const loaded = await loadAllFunderAwards(harness.db as unknown as Queryable);
    const found = loaded.find((f) => f.funderId === outcome.funderId);

    const summary = summariseFunderBehaviour(found?.awards ?? [], '2025-09-01');
    expect(summary.kind).toBe('summary');
    if (summary.kind !== 'summary') return;
    expect(summary.behaviour.awardCount).toBe(7);
    expect(summary.behaviour.amounts.median).toBe(9000);
    expect(summary.behaviour.tags[0]?.value).toBe('Children and young people');
  });

  it('refuses an http pagination link even back to the host it is talking to', async () => {
    // Not a limitation of the test — the property. The stub here IS the origin,
    // and the link still has to be https, because a downgrade to plain http is
    // exactly how a paginating client gets walked somewhere in the middle.
    //
    // It does mean pagination cannot be followed over a plain socket, so the
    // multi-page path is covered in ingest.test.ts against a fake client and
    // the hop itself is proved by the real API on first use.
    respond = () => ({
      status: 200,
      body: JSON.stringify({
        count: 2,
        next: `${baseUrl}page2/`,
        results: [grant('g1', 5000, '2024-01-01')],
      }),
    });

    await expect(
      ingestFunder(fastClient(), request, runInTransaction, { baseUrl }),
    ).rejects.toThrow(/must use https/);
    // One request made, and no second page fetched.
    expect(asked).toHaveLength(1);
  });

  it('refuses to follow a pagination link to another host', async () => {
    // The server controls this field, so it is checked before it is followed.
    respond = () => ({
      status: 200,
      body: JSON.stringify({
        count: 2,
        next: 'https://elsewhere.example.org/api/v1/page2/',
        results: [grant('g1', 5000, '2024-01-01')],
      }),
    });
    await expect(
      ingestFunder(fastClient(), request, runInTransaction, { baseUrl }),
    ).rejects.toThrow(/elsewhere\.example\.org/);
  });

  it('does not empty a funder when the publisher starts failing', async () => {
    respond = () => ({
      status: 200,
      body: JSON.stringify({ count: 1, next: null, results: [grant('g1', 5000, '2024-01-01')] }),
    });
    const first = await ingestFunder(fastClient(), request, runInTransaction, { baseUrl });
    expect(first.awardsWritten).toBe(1);

    respond = () => ({ status: 503, body: 'maintenance', type: 'text/plain' });
    await expect(
      ingestFunder(fastClient(), request, runInTransaction, { baseUrl }),
    ).rejects.toThrow(/returned 503/);

    const loaded = await loadAllFunderAwards(harness.db as unknown as Queryable);
    expect(loaded.find((f) => f.funderId === first.funderId)?.awards).toHaveLength(1);
  });

  it('does not empty a funder when the publisher serves an error page as 200', async () => {
    // The nastiest case: a 200 carrying HTML. Parsed as "no grants" it would
    // delete everything we hold.
    respond = () => ({
      status: 200,
      body: JSON.stringify({ count: 2, next: null, results: [grant('g1', 5000, '2024-01-01'), grant('g2', 7000, '2024-02-01')] }),
    });
    const first = await ingestFunder(fastClient(), request, runInTransaction, { baseUrl });
    expect(first.awardsWritten).toBe(2);

    respond = () => ({ status: 200, body: '<html>we are down</html>', type: 'text/html' });
    await expect(
      ingestFunder(fastClient(), request, runInTransaction, { baseUrl }),
    ).rejects.toThrow(/did not return JSON/);

    const loaded = await loadAllFunderAwards(harness.db as unknown as Queryable);
    expect(loaded.find((f) => f.funderId === first.funderId)?.awards).toHaveLength(2);
  });

  it('records the licence the operator supplied', async () => {
    respond = () => ({
      status: 200,
      body: JSON.stringify({ count: 1, next: null, results: [grant('g1', 5000, '2024-01-01')] }),
    });
    const outcome = await ingestFunder(fastClient(), request, runInTransaction, { baseUrl });
    const holding = (await readFunderHoldings(harness.db as unknown as Queryable)).find(
      (f) => f.id === outcome.funderId,
    );
    expect(holding?.licence).toBe('CC BY 4.0');
  });
});

describe('the dry run, over a socket', () => {
  it('reports what it found and writes nothing', async () => {
    respond = () => ({
      status: 200,
      body: JSON.stringify({
        count: 41,
        next: null,
        results: [grant('g1', 9000, '2025-06-01')],
      }),
    });

    const result = await probeFunder(fastClient(), 'GB-CHC-1164883', baseUrl);
    expect(result.totalReported).toBe(41);
    expect(result.sample?.amountGbp).toBe(9000);

    const { rows } = await harness.db.query('SELECT id FROM funder_awards');
    expect(rows).toEqual([]);
  });

  it('surfaces a 404 as an error naming the status', async () => {
    respond = () => ({ status: 404, body: '{"detail":"Not found."}' });
    await expect(probeFunder(fastClient(), 'GB-CHC-nope', baseUrl)).rejects.toThrow(/404/);
  });
});
