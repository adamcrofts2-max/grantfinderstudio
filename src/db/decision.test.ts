/**
 * Recording a funder's answer, against real PostgreSQL (PGlite).
 *
 * The three properties worth proving here are the ones that would silently
 * corrupt the totals: an answer cannot be recorded against an application
 * nobody sent, an answer cannot be recorded against another tenant's
 * application, and clearing one takes the money with it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDatabase, ORG_A, ORG_B, type TestDatabase } from './testing/harness.js';
import { clearDecision, readDecisionContext, recordDecision } from './decision.js';
import { loadTracker, markSubmitted } from './tracker.js';
import type { DecisionRecord } from '../domain/tracker/decision.js';

const AWARD: DecisionRecord = {
  decision: 'awarded',
  decidedOn: '2026-09-01',
  amountAwardedGbp: 12_500,
  note: 'Funded in full for year one.',
};

let t: TestDatabase;

beforeEach(async () => {
  t = await createTestDatabase();
});

afterEach(async () => {
  await t.close();
});

async function appA() {
  const tracker = await loadTracker(t.db);
  return tracker.applications.find((a) => a.id === 'app_a');
}

describe('recordDecision', () => {
  it('refuses an application nobody has submitted', async () => {
    await t.asTenant(ORG_A, async () => {
      expect(await recordDecision(t.db, 'app_a', AWARD)).toBe(false);
      expect((await appA())?.decision).toBeNull();
    });
  });

  it('records the answer, the date, the amount and the note together', async () => {
    await t.asTenant(ORG_A, async () => {
      await markSubmitted(t.db, 'app_a');
      expect(await recordDecision(t.db, 'app_a', AWARD)).toBe(true);

      const app = await appA();
      expect(app?.status).toBe('awarded');
      expect(app?.decision).toBe('awarded');
      expect(app?.decidedOn).toBe('2026-09-01');
      expect(app?.amountAwardedGbp).toBe(12_500);
      expect(app?.outcomeNote).toBe('Funded in full for year one.');
    });
  });

  it('carries no amount on a refusal', async () => {
    await t.asTenant(ORG_A, async () => {
      await markSubmitted(t.db, 'app_a');
      await recordDecision(t.db, 'app_a', {
        decision: 'rejected',
        decidedOn: '2026-09-02',
        amountAwardedGbp: null,
        note: null,
      });

      const app = await appA();
      expect(app?.decision).toBe('rejected');
      expect(app?.amountAwardedGbp).toBeNull();
      expect(app?.outcomeNote).toBeNull();
    });
  });

  it('records silence as its own answer rather than as a refusal', async () => {
    await t.asTenant(ORG_A, async () => {
      await markSubmitted(t.db, 'app_a');
      await recordDecision(t.db, 'app_a', {
        decision: 'no_reply',
        decidedOn: '2026-09-03',
        amountAwardedGbp: null,
        note: null,
      });
      expect((await appA())?.decision).toBe('no_reply');
    });
  });

  it('takes the money away when an award is corrected to a refusal', async () => {
    // The mistake that would otherwise leave £12,500 in the totals of an
    // application that was turned down.
    await t.asTenant(ORG_A, async () => {
      await markSubmitted(t.db, 'app_a');
      await recordDecision(t.db, 'app_a', AWARD);
      await recordDecision(t.db, 'app_a', {
        decision: 'rejected',
        decidedOn: '2026-09-05',
        amountAwardedGbp: null,
        note: null,
      });

      const app = await appA();
      expect(app?.decision).toBe('rejected');
      expect(app?.amountAwardedGbp).toBeNull();
      expect(app?.outcomeNote).toBeNull();
    });
  });

  it('cannot touch another tenant’s application', async () => {
    await t.asTenant(ORG_A, () => markSubmitted(t.db, 'app_a'));
    await t.asTenant(ORG_B, async () => {
      expect(await recordDecision(t.db, 'app_a', AWARD)).toBe(false);
    });
    await t.asTenant(ORG_A, async () => {
      expect((await appA())?.decision).toBeNull();
    });
  });
});

describe('clearDecision', () => {
  it('puts the application back to waiting and wipes the outcome with it', async () => {
    await t.asTenant(ORG_A, async () => {
      await markSubmitted(t.db, 'app_a');
      await recordDecision(t.db, 'app_a', AWARD);

      expect(await clearDecision(t.db, 'app_a')).toBe(true);
      const app = await appA();
      expect(app?.status).toBe('submitted');
      expect(app?.decision).toBeNull();
      expect(app?.decidedOn).toBeNull();
      expect(app?.amountAwardedGbp).toBeNull();
      expect(app?.outcomeNote).toBeNull();
    });
  });

  it('leaves the submission date alone, so the clock stays stopped', async () => {
    await t.asTenant(ORG_A, async () => {
      await markSubmitted(t.db, 'app_a');
      const submitted = (await appA())?.submittedOn;
      await recordDecision(t.db, 'app_a', AWARD);
      await clearDecision(t.db, 'app_a');
      expect((await appA())?.submittedOn).toBe(submitted);
    });
  });

  it('does nothing to an application that was never decided', async () => {
    await t.asTenant(ORG_A, async () => {
      await markSubmitted(t.db, 'app_a');
      expect(await clearDecision(t.db, 'app_a')).toBe(false);
      expect((await appA())?.status).toBe('submitted');
    });
  });
});

describe('readDecisionContext', () => {
  it('reports when it went in', async () => {
    await t.asTenant(ORG_A, async () => {
      await markSubmitted(t.db, 'app_a');
      const context = await readDecisionContext(t.db, 'app_a');
      expect(context?.submittedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    });
  });

  it('says nothing about an application that is not this tenant’s', async () => {
    await t.asTenant(ORG_B, async () => {
      expect(await readDecisionContext(t.db, 'app_a')).toBeNull();
    });
  });
});

describe('the constraint from 0028', () => {
  it('refuses a decided application with no date', async () => {
    // As superuser, so the refusal is the CHECK and not row-level security.
    await expect(
      t.db.exec(
        `RESET ROLE; UPDATE applications SET status = 'awarded' WHERE id = 'app_a'; SET ROLE app_user;`,
      ),
    ).rejects.toThrow(/applications_decision_dated/u);
    await t.db.exec('SET ROLE app_user;');
  });

  it('allows a date to survive a status that moves further down the lifecycle', async () => {
    await t.db.exec(`RESET ROLE;
      UPDATE applications
      SET status = 'awarded', decided_at = '2026-09-01', submitted_at = '2026-06-01'
      WHERE id = 'app_a';
      UPDATE applications SET status = 'reporting' WHERE id = 'app_a';
      SET ROLE app_user;`);
    await t.asTenant(ORG_A, async () => {
      expect((await appA())?.status).toBe('reporting');
      expect((await appA())?.decision).toBeNull();
    });
  });
});
