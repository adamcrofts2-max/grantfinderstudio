/**
 * A fund an organisation added itself: its details and its rules, against the
 * real schema and its row-level security.
 *
 * The property that matters most is the one a query cannot show by working:
 * that nothing here reaches a shared catalogue fund (visible to every tenant)
 * or another organisation's fund, and that it SAYS so rather than reporting
 * a change that never happened.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evaluateEligibility } from '../domain/eligibility/engine.js';
import { HAND_RULE_KINDS, readHandRule, type HandRule } from '../domain/eligibility/hand-rule.js';
import type { ManualFund } from '../domain/opportunity/manual.js';
import {
  addHandRule,
  loadOwnFund,
  loadRulesInUse,
  removeRule,
  updateOwnFund,
} from './own-funds.js';
import { loadCriteria } from './queries.js';
import { createTestDatabase, ORG_A, ORG_B, type TestDatabase } from './testing/harness.js';

let t: TestDatabase;

beforeEach(async () => {
  t = await createTestDatabase();
  await t.db.exec(`
    RESET ROLE;
    INSERT INTO opportunities
      (id, funder_id, title, deadline_kind, freshness_state, retrieved_at, origin, added_by_organisation_id)
    VALUES
      ('mine', 'funder_demo', 'Our typed fund', 'unknown', 'needs_verification', now(), 'user', '${ORG_A}'),
      ('theirs', 'funder_demo', 'Their typed fund', 'unknown', 'needs_verification', now(), 'user', '${ORG_B}');
    INSERT INTO eligibility_criteria
      (id, opportunity_id, kind, label, params, proposed_by, source_span, verified_by, verified_at)
    VALUES
      ('read_rule', 'mine', 'match_funding', 'Match funding required', '{"required": true}',
       'ai_extraction', 'You must show match funding.', 'user_a', now());
    SET ROLE app_user;
  `);
});

afterEach(async () => {
  await t.close();
});

const fund: ManualFund = {
  funderName: 'Demonstration Trust (fictional)',
  title: 'Renamed fund',
  summary: 'Ring first.',
  sourceUrl: 'https://example.org/fund',
  jurisdiction: 'england',
  minAmountGbp: 1000,
  maxAmountGbp: 9000,
  deadline: '2027-01-31',
  deadlineKind: 'confirmed',
};

/** A valid rule of every kind, as the form would submit it. */
const SAMPLES: Record<(typeof HAND_RULE_KINDS)[number], Record<string, string | string[]>> = {
  legal_form: { cicTreatment: 'explicitly_permitted' },
  organisation_age: { minYears: '2' },
  jurisdiction: { nations: ['england', 'wales'] },
  region: { regions: 'Somerset, Devon' },
  beneficiary: { groups: ['young people'] },
  amount: { max: '25000' },
  duration: { max: '24' },
  capital_revenue: { spend: ['revenue'] },
  turnover: { max: '500000' },
  match_funding: {},
};

function rule(kind: string, fields: Record<string, string | string[]>): HandRule {
  const all = { kind, ...fields };
  const read = readHandRule({
    one: (name) => {
      const value = all[name as keyof typeof all];
      return typeof value === 'string' ? value : '';
    },
    all: (name) => {
      const value = all[name as keyof typeof all];
      return Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    },
  });
  if (read.rule === null) throw new Error(`${kind}: ${JSON.stringify(read.errors)}`);
  return read.rule;
}

describe('loadOwnFund', () => {
  it('returns a fund this organisation added', async () => {
    const own = await t.asTenant(ORG_A, () => loadOwnFund(t.db, 'mine'));
    expect(own?.title).toBe('Our typed fund');
    expect(own?.funderName).toBe('Demonstration Trust (fictional)');
  });

  it('returns nothing for a shared fund, though every tenant can see it', async () => {
    expect(await t.asTenant(ORG_A, () => loadOwnFund(t.db, 'opp_seed'))).toBeNull();
  });

  it('returns nothing for another organisation’s fund', async () => {
    expect(await t.asTenant(ORG_A, () => loadOwnFund(t.db, 'theirs'))).toBeNull();
  });
});

describe('updateOwnFund', () => {
  it('changes a fund this organisation added', async () => {
    const changed = await t.asTenant(ORG_A, () => updateOwnFund(t.db, 'mine', fund, 'funder_demo'));
    expect(changed).toBe(true);
    const after = await t.asTenant(ORG_A, () => loadOwnFund(t.db, 'mine'));
    expect(after).toMatchObject({
      title: 'Renamed fund',
      deadline: '2027-01-31',
      deadlineKind: 'confirmed',
      maxAmountGbp: 9000,
      jurisdiction: 'england',
    });
  });

  it('says so, and changes nothing, for a fund that is not theirs', async () => {
    expect(await t.asTenant(ORG_A, () => updateOwnFund(t.db, 'opp_seed', fund, 'funder_demo')))
      .toBe(false);
    expect(await t.asTenant(ORG_A, () => updateOwnFund(t.db, 'theirs', fund, 'funder_demo')))
      .toBe(false);
    const theirs = await t.asTenant(ORG_B, () => loadOwnFund(t.db, 'theirs'));
    expect(theirs?.title).toBe('Their typed fund');
  });
});

describe('a rule typed in by hand', () => {
  it.each(Object.entries(SAMPLES))(
    '%s is stored in the shape the engine evaluates',
    async (kind, fields) => {
      const id = await t.asTenant(ORG_A, () => addHandRule(t.db, 'mine', rule(kind, fields), 'user_a'));
      expect(id).not.toBeNull();
      // Through the same mapper every verdict goes through: a row it
      // rejected would be a rule the person entered and nothing applied.
      const mapped = await t.asTenant(ORG_A, () => loadCriteria(t.db, 'mine'));
      expect(mapped.rejected).toEqual([]);
      const criterion = mapped.criteria.find((c) => c.id === id);
      expect(criterion?.kind).toBe(kind);
      const verdict = evaluateEligibility(
        {
          legalForm: 'cic_limited_by_guarantee',
          jurisdiction: 'england',
          region: 'Somerset',
          incorporationDate: '2020-01-15',
          annualTurnoverGbp: 120_000,
        },
        {
          amountSoughtGbp: 18_000,
          durationMonths: 12,
          beneficiaryGroups: ['young people'],
          capitalOrRevenue: 'revenue',
          hasMatchFunding: false,
        },
        criterion === undefined ? [] : [criterion],
        { asOf: '2026-09-23' },
      );
      expect(verdict.results).toHaveLength(1);
    },
  );

  it('is in use the moment it is typed — the person entering it is the check', async () => {
    await t.asTenant(ORG_A, () => addHandRule(t.db, 'mine', rule('region', SAMPLES.region), 'user_a'));
    const rules = await t.asTenant(ORG_A, () => loadRulesInUse(t.db, 'mine'));
    expect(rules.map((r) => r.proposedBy).toSorted()).toEqual(['ai_extraction', 'user']);
  });

  it('cannot be attached to a fund that is not theirs', async () => {
    const onShared = await t.asTenant(ORG_A, () =>
      addHandRule(t.db, 'opp_seed', rule('match_funding', {}), 'user_a'),
    );
    const onTheirs = await t.asTenant(ORG_A, () =>
      addHandRule(t.db, 'theirs', rule('match_funding', {}), 'user_a'),
    );
    expect(onShared).toBeNull();
    expect(onTheirs).toBeNull();
  });
});

describe('removeRule', () => {
  it('deletes a rule somebody typed', async () => {
    const id = await t.asTenant(ORG_A, () => addHandRule(t.db, 'mine', rule('match_funding', {}), 'user_a'));
    expect(await t.asTenant(ORG_A, () => removeRule(t.db, id!, 'mine', 'user_a'))).toBe('deleted');
    const left = await t.asTenant(ORG_A, () => loadRulesInUse(t.db, 'mine'));
    expect(left.map((r) => r.id)).toEqual(['read_rule']);
  });

  it('sets aside a rule read from guidance, keeping the funder’s sentence', async () => {
    expect(await t.asTenant(ORG_A, () => removeRule(t.db, 'read_rule', 'mine', 'user_a'))).toBe(
      'set_aside',
    );
    expect((await t.asTenant(ORG_A, () => loadCriteria(t.db, 'mine'))).criteria).toEqual([]);
    await t.db.exec('RESET ROLE;');
    const { rows } = await t.db.query<{ rejected_by: string; source_span: string }>(
      `SELECT rejected_by, source_span FROM eligibility_criteria WHERE id = 'read_rule'`,
    );
    expect(rows[0]).toEqual({ rejected_by: 'user_a', source_span: 'You must show match funding.' });
  });

  it('touches nothing on another organisation’s fund', async () => {
    const id = await t.asTenant(ORG_B, () => addHandRule(t.db, 'theirs', rule('match_funding', {}), 'user_b'));
    expect(await t.asTenant(ORG_A, () => removeRule(t.db, id!, 'theirs', 'user_a'))).toBeNull();
    expect(await t.asTenant(ORG_B, () => loadRulesInUse(t.db, 'theirs'))).toHaveLength(1);
  });
});
