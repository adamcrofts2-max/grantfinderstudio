/**
 * The audit trail, against the real schema.
 *
 * `audit_logs` was the last table 0001 created with nothing writing to it —
 * after `reviews`, `budgets`, `budget_lines` and `outcomes`, each closed in
 * turn. It is next because Phase 9 Step 2 shares an application read-only with
 * a reviewer the applicant names, and that access has to be audited to be
 * lawful. There is no audited access without an audit log.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { loadAuditTrail, recordAudit } from './audit.js';
import { createTestDatabase, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;
const tx = (): Queryable => harness.db as unknown as Queryable;

const ORG = 'org_audit';
const OTHER_ORG = 'org_audit_other';
const APP = 'app_audit';
const APP2 = 'app_audit_two';
const USER = 'usr_audit';
const COLLEAGUE = 'usr_audit_colleague';

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
  await harness.db.exec(`
    INSERT INTO organisations (id, name)
      VALUES ('${ORG}', 'Rivermead CIC'), ('${OTHER_ORG}', 'Somebody Else CIC');
    INSERT INTO users (id, email) VALUES
      ('${USER}', 'me@example.org'), ('${COLLEAGUE}', 'them@example.org');
    INSERT INTO applications (id, organisation_id, status)
      VALUES ('${APP}', '${ORG}', 'saved'), ('${APP2}', '${ORG}', 'saved');
  `);
});

afterEach(async () => {
  await harness.close();
});

describe('recording what happened', () => {
  it('writes a line that can be read back whole', async () => {
    await recordAudit(tx(), ORG, {
      userId: USER,
      action: 'budget_line.added',
      entityId: 'bl_1',
      applicationId: APP,
      metadata: { category: 'staff', amountGbp: 12_500 },
    });

    const [line] = await loadAuditTrail(tx(), ORG, { applicationId: APP });
    expect(line?.action).toBe('budget_line.added');
    expect(line?.entityId).toBe('bl_1');
    expect(line?.applicationId).toBe(APP);
    expect(line?.userId).toBe(USER);
    expect(line?.metadata).toEqual({ category: 'staff', amountGbp: 12_500 });
  });

  /**
   * DERIVED, never passed. `action: 'answer.saved', entityType: 'answers'`
   * type-checks, writes, and quietly splits the trail in two — so the caller
   * does not get to say.
   */
  it('derives the entity type from the action', async () => {
    for (const action of ['answer.saved', 'budget_line.removed', 'fact.confirmed'] as const) {
      await recordAudit(tx(), ORG, { userId: USER, action, applicationId: APP });
    }
    const types = (await loadAuditTrail(tx(), ORG, { applicationId: APP })).map((r) => r.entityType);
    expect(types.toSorted()).toEqual(['answer', 'budget_line', 'fact']);
  });

  it('accepts a line with no entity and no application', async () => {
    // Confirming a fact is about the organisation, not an application.
    await recordAudit(tx(), ORG, { userId: USER, action: 'fact.confirmed', entityId: 'f_1' });
    const [line] = await loadAuditTrail(tx(), ORG);
    expect(line?.applicationId).toBeNull();
    expect(line?.metadata).toEqual({});
  });

  it('emits a timestamp that `new Date()` accepts', async () => {
    // `created_at::text` renders a `+00` offset that `new Date()` refuses,
    // which degraded every stored review's date to the word "earlier" until a
    // browser showed it. Same column type, same trap.
    await recordAudit(tx(), ORG, { userId: USER, action: 'answer.saved', applicationId: APP });
    const [line] = await loadAuditTrail(tx(), ORG, { applicationId: APP });
    expect(line?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
    expect(Number.isNaN(new Date(line?.createdAt ?? '').getTime())).toBe(false);
  });
});

describe('reading it back', () => {
  it('scopes to one application, and leaves the organisation’s own events out', async () => {
    await recordAudit(tx(), ORG, { userId: USER, action: 'answer.saved', applicationId: APP });
    await recordAudit(tx(), ORG, { userId: USER, action: 'outcome.added', applicationId: APP2 });
    await recordAudit(tx(), ORG, { userId: USER, action: 'fact.confirmed' });

    // A reviewer given ONE application must not be shown the organisation's
    // others, nor its unrelated business. This is the reason 0022 put
    // `application_id` in a column rather than trusting a metadata key.
    const first = await loadAuditTrail(tx(), ORG, { applicationId: APP });
    expect(first.map((r) => r.action)).toEqual(['answer.saved']);

    // Unscoped is the organisation's whole trail, which is what its own
    // members may read.
    expect((await loadAuditTrail(tx(), ORG)).length).toBe(3);
    // AND NOT ANOTHER ORGANISATION'S. These tests run as a superuser, which
    // bypasses RLS entirely — so the filter in the query is the only thing
    // standing here, which is exactly why it is in the query. The shared
    // harness seeds a line for two other tenants; neither may appear.
    expect(await loadAuditTrail(tx(), OTHER_ORG)).toEqual([]);
  });

  it('puts the newest first', async () => {
    for (const action of ['application.started', 'answer.saved', 'review.read'] as const) {
      await recordAudit(tx(), ORG, { userId: USER, action, applicationId: APP });
    }
    const trail = await loadAuditTrail(tx(), ORG, { applicationId: APP });
    // Same-millisecond writes are ordered by id as a tie-break, and the ids
    // are not monotonic — so this asserts the set and the newest, which is
    // what a screen reading "newest first" actually promises.
    expect(trail).toHaveLength(3);
    expect(trail.map((r) => r.action).toSorted()).toEqual([
      'answer.saved', 'application.started', 'review.read',
    ]);
  });

  it('caps how many lines it returns', async () => {
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await recordAudit(tx(), ORG, { userId: USER, action: 'answer.saved', applicationId: APP });
    }
    expect(await loadAuditTrail(tx(), ORG, { applicationId: APP, limit: 5 })).toHaveLength(5);
  });

  it('survives metadata of a shape no version ever wrote', async () => {
    await harness.db.exec(`
      INSERT INTO audit_logs (id, organisation_id, user_id, action, entity_type, application_id, metadata)
        VALUES ('aud_odd', '${ORG}', '${USER}', 'answer.saved', 'answer', '${APP}', '[1,2,3]'::jsonb);
    `);
    const [line] = await loadAuditTrail(tx(), ORG, { applicationId: APP });
    // An array is not a record. Rendered as nothing rather than taking the
    // page down, for the reason `loadLatestReview` validates its own jsonb.
    expect(line?.metadata).toEqual({});
  });

  it('records who, so a colleague’s change is distinguishable from your own', async () => {
    await recordAudit(tx(), ORG, { userId: USER, action: 'answer.saved', applicationId: APP });
    await recordAudit(tx(), ORG, { userId: COLLEAGUE, action: 'answer.saved', applicationId: APP });
    const actors = (await loadAuditTrail(tx(), ORG, { applicationId: APP })).map((r) => r.userId);
    expect(actors.toSorted()).toEqual([COLLEAGUE, USER].toSorted());
  });
});

describe('what a trail must never carry', () => {
  /**
   * SHAPE, NOT CONTENT.
   *
   * Copying answer prose in here would make a second, unversioned store of
   * the applicant's writing outside `answer_versions` — and then hand it to
   * whoever the application gets shared with. This pins the shape the answer
   * action actually writes, because the rule is only worth as much as the
   * call sites keep it.
   */
  it('records a word count for a saved answer and not the words', async () => {
    const prose = 'We train young people aged 14 to 19 in Wells.';
    await recordAudit(tx(), ORG, {
      userId: USER,
      action: 'answer.saved',
      entityId: 'q_1',
      applicationId: APP,
      metadata: { wordCount: 9, wordLimit: 200 },
    });
    const [line] = await loadAuditTrail(tx(), ORG, { applicationId: APP });
    expect(line?.metadata).toEqual({ wordCount: 9, wordLimit: 200 });
    expect(JSON.stringify(line?.metadata)).not.toContain('Wells');
    expect(JSON.stringify(line?.metadata)).not.toContain(prose);
  });
});
