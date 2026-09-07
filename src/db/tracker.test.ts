/**
 * Tracker read-model tests, against real PostgreSQL (PGlite).
 *
 * Two properties matter enough to prove rather than assume: that question
 * progress is attributed to the right application, and that "not started"
 * means not started *by this organisation* — a fund another tenant is working
 * on must still appear as untouched here.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, ORG_A, ORG_B, type TestDatabase } from './testing/harness.js';
import { loadTracker, markSubmitted, unmarkSubmitted } from './tracker.js';

let t: TestDatabase;

beforeEach(async () => {
  t = await createTestDatabase();
  // Seeded as superuser so the fixtures exist regardless of policy.
  await t.db.exec(`
    RESET ROLE;
    INSERT INTO opportunities
      (id, funder_id, title, deadline, deadline_kind, freshness_state, source_url, retrieved_at)
    VALUES
      ('opp_soon', 'funder_demo', 'Closing Soon Fund', '2026-10-01', 'confirmed',
       'current', 'https://example.org/soon', now()),
      ('opp_roll', 'funder_demo', 'Rolling Fund', NULL, 'rolling',
       'current', NULL, now()),
      ('opp_free', 'funder_demo', 'Nobody Has Started This', '2026-12-01', 'estimated',
       'current', NULL, now());

    UPDATE applications SET opportunity_id = 'opp_soon' WHERE id = 'app_a';
    UPDATE applications SET opportunity_id = 'opp_roll' WHERE id = 'app_b';

    INSERT INTO application_questions
      (id, organisation_id, application_id, position, question, word_limit)
    VALUES
      ('q1', '${ORG_A}', 'app_a', 1, 'What will you do?', 500),
      ('q2', '${ORG_A}', 'app_a', 2, 'Who benefits?', 300),
      ('q3', '${ORG_A}', 'app_a', 3, 'How will you know it worked?', NULL),
      ('qb1', '${ORG_B}', 'app_b', 1, 'Beta question', 100);

    INSERT INTO answers (id, organisation_id, question_id, content, word_count)
    VALUES
      ('ans_q1', '${ORG_A}', 'q1', 'A drafted answer.', 3),
      ('ans_q2', '${ORG_A}', 'q2', '', 0);

    INSERT INTO answer_fact_refs
      (id, organisation_id, answer_id, fact_id, claim_text, is_unsupported)
    VALUES
      ('ref_1', '${ORG_A}', 'ans_q1', NULL, 'An unevidenced claim.', true);

    SET ROLE app_user;
  `);
});

afterEach(async () => {
  await t.close();
});

describe('loadTracker', () => {
  it('returns this tenant’s applications with their opportunity and funder', async () => {
    const tracker = await t.asTenant(ORG_A, () => loadTracker(t.db));
    expect(tracker.applications).toHaveLength(1);
    const app = tracker.applications[0];
    expect(app?.id).toBe('app_a');
    expect(app?.title).toBe('Closing Soon Fund');
    expect(app?.funderName).toBe('Demonstration Trust (fictional)');
    expect(app?.deadline).toBe('2026-10-01');
    expect(app?.deadlineKind).toBe('confirmed');
    expect(app?.sourceUrl).toBe('https://example.org/soon');
  });

  it('never leaks another tenant’s application', async () => {
    const tracker = await t.asTenant(ORG_A, () => loadTracker(t.db));
    expect(tracker.applications.map((a) => a.id)).not.toContain('app_b');
  });

  it('reports question progress, counting an empty answer as unanswered', async () => {
    const tracker = await t.asTenant(ORG_A, () => loadTracker(t.db));
    const app = tracker.applications[0];
    expect(app?.questions).toHaveLength(3);
    expect(app?.answered).toBe(1);
    expect(app?.questions.map((q) => q.wordLimit)).toEqual([500, 300, null]);
    expect(app?.questions.map((q) => q.answered)).toEqual([true, false, false]);
  });

  it('does not attribute another tenant’s questions to this one', async () => {
    const tracker = await t.asTenant(ORG_B, () => loadTracker(t.db));
    expect(tracker.applications[0]?.questions).toHaveLength(1);
  });

  it('surfaces unsupported claims so they can block a submission', async () => {
    const tracker = await t.asTenant(ORG_A, () => loadTracker(t.db));
    expect(tracker.applications[0]?.unsupported).toBe(1);
  });

  it('lists opportunities this organisation has not started', async () => {
    const tracker = await t.asTenant(ORG_A, () => loadTracker(t.db));
    const ids = tracker.notStarted.map((o) => o.id);
    expect(ids).toContain('opp_free');
    expect(ids).not.toContain('opp_soon');
  });

  it('still counts a fund as not started when only another tenant has started it', async () => {
    // Row-level security scopes the "already started" check to this tenant, so
    // Alpha must still be told about a fund Beta is quietly working on.
    const tracker = await t.asTenant(ORG_A, () => loadTracker(t.db));
    expect(tracker.notStarted.map((o) => o.id)).toContain('opp_roll');
  });

  it('carries the deadline kind through so a soft date can be labelled', async () => {
    const tracker = await t.asTenant(ORG_A, () => loadTracker(t.db));
    const free = tracker.notStarted.find((o) => o.id === 'opp_free');
    expect(free?.deadlineKind).toBe('estimated');
  });

  it('is empty for an application with no questions pasted in yet', async () => {
    await t.db.exec(`RESET ROLE; DELETE FROM application_questions WHERE application_id = 'app_a'; SET ROLE app_user;`);
    const tracker = await t.asTenant(ORG_A, () => loadTracker(t.db));
    expect(tracker.applications[0]?.questions).toEqual([]);
  });
});

describe('markSubmitted', () => {
  it('records the submission and moves the status', async () => {
    await t.asTenant(ORG_A, async () => {
      await markSubmitted(t.db, 'app_a');
      const tracker = await loadTracker(t.db);
      expect(tracker.applications[0]?.submittedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(tracker.applications[0]?.status).toBe('submitted');
    });
  });

  it('does not move the date if it is already recorded', async () => {
    await t.asTenant(ORG_A, async () => {
      await markSubmitted(t.db, 'app_a');
      const first = (await loadTracker(t.db)).applications[0]?.submittedOn;
      await markSubmitted(t.db, 'app_a');
      expect((await loadTracker(t.db)).applications[0]?.submittedOn).toBe(first);
    });
  });

  it('cannot mark another tenant’s application', async () => {
    await t.asTenant(ORG_A, () => markSubmitted(t.db, 'app_b'));
    const beta = await t.asTenant(ORG_B, () => loadTracker(t.db));
    expect(beta.applications[0]?.submittedOn).toBeNull();
  });

  it('can be undone when recorded by mistake', async () => {
    await t.asTenant(ORG_A, async () => {
      await markSubmitted(t.db, 'app_a');
      await unmarkSubmitted(t.db, 'app_a');
      const tracker = await loadTracker(t.db);
      expect(tracker.applications[0]?.submittedOn).toBeNull();
      expect(tracker.applications[0]?.status).toBe('drafting');
    });
  });
});
