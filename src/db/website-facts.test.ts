/**
 * Storing what a website said, against the real schema.
 *
 * Written because the register route had exactly this bug: a deterministic id
 * with a plain INSERT, so doing the same thing twice was a primary-key
 * violation and an "Application error" page. "Read my website again" is an
 * obviously repeatable action, so it is tested as one.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { saveWebsiteFacts } from './workspace.js';
import { createTestDatabase, ORG_A, ORG_B, type TestDatabase } from './testing/harness.js';
import type { Reconciliation } from '../domain/provenance/reconcile.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;
const tx = (): Queryable => harness.db as unknown as Queryable;

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
});

afterEach(async () => {
  await harness.close();
});

const proposal = (
  claim: string,
  value: string,
  kind: Reconciliation['kind'] = 'new',
): Reconciliation =>
  ({
    kind,
    candidate: {
      claim,
      value,
      sourceSpan: `The page said ${value}.`,
      confidence: 'medium',
    },
  }) as Reconciliation;

const PAGE = 'abc123def456';
const URL = 'https://rivermead.org.uk/about';

const factsFor = async (organisationId: string) => {
  const { rows } = await harness.db.query<{
    id: string;
    claim: string;
    value: string;
    source: string;
    source_ref: string | null;
    confirmed_by: string | null;
  }>(
    `SELECT id, claim, value, source, source_ref, confirmed_by
       FROM facts WHERE organisation_id = $1 ORDER BY id`,
    [organisationId],
  );
  return rows;
};

describe('what a website proposes', () => {
  it('is stored unconfirmed, sourced to the page', async () => {
    const stored = await saveWebsiteFacts(tx(), ORG_A, PAGE, URL, [
      proposal('area_of_operation', 'Somerset'),
    ]);
    expect(stored).toBe(1);

    const rows = (await factsFor(ORG_A)).filter((r) => r.source === 'ai_extraction');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source_ref).toBe(URL);
    // The property the whole feature rests on: extraction can never produce a
    // confirmed fact.
    expect(rows[0]?.confirmed_by).toBeNull();
  });

  it('can be read twice, which is what the register route could not', async () => {
    const proposals = [proposal('area_of_operation', 'Somerset')];
    await saveWebsiteFacts(tx(), ORG_A, PAGE, URL, proposals);
    await expect(
      saveWebsiteFacts(tx(), ORG_A, PAGE, URL, proposals),
    ).resolves.toBe(1);

    const rows = (await factsFor(ORG_A)).filter((r) => r.source === 'ai_extraction');
    expect(rows).toHaveLength(1);
  });

  it('refreshes a changed value and withdraws the confirmation', async () => {
    // What somebody checked is no longer what we hold, so it has been checked
    // by nobody — the same rule the register follows.
    await saveWebsiteFacts(tx(), ORG_A, PAGE, URL, [proposal('staff_count', 'four')]);
    await harness.db.query(
      `UPDATE facts SET confirmed_by = 'user_a', confirmed_at = now()
        WHERE organisation_id = $1 AND source = 'ai_extraction'`,
      [ORG_A],
    );

    await saveWebsiteFacts(tx(), ORG_A, PAGE, URL, [proposal('staff_count', 'six')]);

    const row = (await factsFor(ORG_A)).find((r) => r.source === 'ai_extraction');
    expect(row?.value).toBe('six');
    expect(row?.confirmed_by).toBeNull();
  });

  it('keeps a confirmation when the page still says the same thing', async () => {
    await saveWebsiteFacts(tx(), ORG_A, PAGE, URL, [proposal('staff_count', 'four')]);
    await harness.db.query(
      `UPDATE facts SET confirmed_by = 'user_a', confirmed_at = now()
        WHERE organisation_id = $1 AND source = 'ai_extraction'`,
      [ORG_A],
    );

    await saveWebsiteFacts(tx(), ORG_A, PAGE, URL, [proposal('staff_count', 'four')]);

    const row = (await factsFor(ORG_A)).find((r) => r.source === 'ai_extraction');
    expect(row?.confirmed_by).toBe('user_a');
  });

  it('adds a second page rather than overwriting the first', async () => {
    await saveWebsiteFacts(tx(), ORG_A, 'pageone', `${URL}`, [proposal('a', '1')]);
    await saveWebsiteFacts(tx(), ORG_A, 'pagetwo', `${URL}/team`, [proposal('b', '2')]);

    const rows = (await factsFor(ORG_A)).filter((r) => r.source === 'ai_extraction');
    expect(rows.map((r) => r.claim).toSorted()).toEqual(['a', 'b']);
  });

  it('lets two organisations read the SAME page without colliding', async () => {
    // An umbrella body and one of its members, say. The organisation is part
    // of the key for the same reason it is in the register route's key now.
    await saveWebsiteFacts(tx(), ORG_A, PAGE, URL, [proposal('a', '1')]);
    await expect(
      saveWebsiteFacts(tx(), ORG_B, PAGE, URL, [proposal('a', '1')]),
    ).resolves.toBe(1);

    expect((await factsFor(ORG_A)).filter((r) => r.source === 'ai_extraction')).toHaveLength(1);
    expect((await factsFor(ORG_B)).filter((r) => r.source === 'ai_extraction')).toHaveLength(1);
  });

  it('skips what reconciliation called a duplicate', async () => {
    const stored = await saveWebsiteFacts(tx(), ORG_A, PAGE, URL, [
      proposal('area_of_operation', 'Somerset', 'duplicate'),
      proposal('staff_count', 'four'),
    ]);
    expect(stored).toBe(1);
  });
});
