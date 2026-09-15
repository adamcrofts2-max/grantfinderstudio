import { describe, expect, it } from 'vitest';
import {
  confirm,
  currentFactsByClaim,
  groundClaims,
  isConfirmed,
  isCurrent,
  isUsableForGeneration,
  supersede,
  usableFacts,
  type Fact,
  claimStanding,
  countUnsupported,
} from './facts.js';

function fact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: 'f1',
    organisationId: 'org1',
    claim: 'annual_turnover',
    value: '120000',
    sourceType: 'user',
    sourceRef: null,
    sourceSpan: null,
    retrievedAt: '2026-01-01T00:00:00Z',
    confidence: 'high',
    confirmedBy: null,
    confirmedAt: null,
    supersededBy: null,
    ...overrides,
  };
}

describe('fact state', () => {
  it('treats an unconfirmed fact as unconfirmed', () => {
    expect(isConfirmed(fact())).toBe(false);
  });

  it('treats a confirmed fact as confirmed', () => {
    expect(isConfirmed(fact({ confirmedBy: 'u1' }))).toBe(true);
  });

  it('treats a superseded fact as no longer current', () => {
    expect(isCurrent(fact({ supersededBy: 'f2' }))).toBe(false);
  });

  it('allows generation only from confirmed, current facts', () => {
    expect(isUsableForGeneration(fact())).toBe(false);
    expect(isUsableForGeneration(fact({ confirmedBy: 'u1' }))).toBe(true);
    expect(isUsableForGeneration(fact({ confirmedBy: 'u1', supersededBy: 'f2' }))).toBe(false);
  });
});

describe('confirm', () => {
  it('records who confirmed and when, without mutating the input', () => {
    const original = fact();
    const confirmed = confirm(original, 'u1', '2026-02-01T00:00:00Z');
    expect(confirmed.confirmedBy).toBe('u1');
    expect(confirmed.confirmedAt).toBe('2026-02-01T00:00:00Z');
    expect(original.confirmedBy).toBeNull();
  });

  it('does not rewrite an existing confirmation', () => {
    const already = fact({ confirmedBy: 'u1', confirmedAt: '2026-01-05T00:00:00Z' });
    const again = confirm(already, 'u2', '2026-03-01T00:00:00Z');
    expect(again.confirmedBy).toBe('u1');
    expect(again).toBe(already);
  });
});

describe('supersede', () => {
  it('marks the original superseded and returns both records', () => {
    const original = fact({ id: 'f1', value: '120000' });
    const next = fact({ id: 'f2', value: '150000', retrievedAt: '2026-06-01T00:00:00Z' });
    const { superseded, replacement } = supersede(original, next);

    expect(superseded.supersededBy).toBe('f2');
    expect(superseded.value).toBe('120000');
    expect(replacement.id).toBe('f2');
    expect(replacement.supersededBy).toBeNull();
  });

  it('leaves the original object untouched so history survives', () => {
    const original = fact({ id: 'f1' });
    supersede(original, fact({ id: 'f2' }));
    expect(original.supersededBy).toBeNull();
  });
});

describe('currentFactsByClaim', () => {
  it('excludes superseded facts', () => {
    const facts = [
      fact({ id: 'f1', value: '120000', supersededBy: 'f2' }),
      fact({ id: 'f2', value: '150000', retrievedAt: '2026-06-01T00:00:00Z' }),
    ];
    const map = currentFactsByClaim(facts);
    expect(map.get('annual_turnover')?.value).toBe('150000');
    expect(map.size).toBe(1);
  });

  it('prefers the most recently retrieved when two are current', () => {
    const facts = [
      fact({ id: 'f1', value: 'old', retrievedAt: '2026-01-01T00:00:00Z' }),
      fact({ id: 'f2', value: 'new', retrievedAt: '2026-08-01T00:00:00Z' }),
    ];
    expect(currentFactsByClaim(facts).get('annual_turnover')?.value).toBe('new');
  });

  it('keeps distinct claims separate', () => {
    const facts = [fact({ id: 'f1' }), fact({ id: 'f2', claim: 'staff_count', value: '4' })];
    expect(currentFactsByClaim(facts).size).toBe(2);
  });
});

describe('usableFacts', () => {
  it('returns only confirmed, current facts', () => {
    const facts = [
      fact({ id: 'f1', confirmedBy: 'u1' }),
      fact({ id: 'f2', claim: 'staff_count' }),
      fact({ id: 'f3', claim: 'beneficiaries', confirmedBy: 'u1', supersededBy: 'f4' }),
    ];
    expect(usableFacts(facts).map((f) => f.id)).toEqual(['f1']);
  });
});

describe('groundClaims', () => {
  const confirmedTurnover = fact({ id: 'f1', confirmedBy: 'u1' });

  it('supports a claim backed by a confirmed fact', () => {
    const result = groundClaims(
      [{ text: 'Our turnover is £120,000.', claim: 'annual_turnover' }],
      [confirmedTurnover],
    );
    expect(result.supported).toHaveLength(1);
    expect(result.unsupported).toHaveLength(0);
  });

  it('flags a claim with no fact behind it', () => {
    const result = groundClaims(
      [{ text: 'We supported 400 young people.', claim: 'beneficiaries_reached' }],
      [confirmedTurnover],
    );
    expect(result.unsupported).toEqual([
      { text: 'We supported 400 young people.', claim: 'beneficiaries_reached' },
    ]);
  });

  it('refuses to ground a claim on an unconfirmed fact', () => {
    const result = groundClaims(
      [{ text: 'Our turnover is £120,000.', claim: 'annual_turnover' }],
      [fact({ id: 'f1' })],
    );
    expect(result.supported).toHaveLength(0);
    expect(result.unsupported).toHaveLength(1);
  });

  it('refuses to ground a claim on a superseded fact', () => {
    const result = groundClaims(
      [{ text: 'Our turnover is £120,000.', claim: 'annual_turnover' }],
      [fact({ id: 'f1', confirmedBy: 'u1', supersededBy: 'f2' })],
    );
    expect(result.unsupported).toHaveLength(1);
  });

  it('ignores prose that asserts nothing factual', () => {
    const result = groundClaims(
      [{ text: 'We are delighted to apply.', claim: null }],
      [confirmedTurnover],
    );
    expect(result.supported).toHaveLength(0);
    expect(result.unsupported).toHaveLength(0);
  });

  it('separates supported from unsupported across a mixed draft', () => {
    const result = groundClaims(
      [
        { text: 'Our turnover is £120,000.', claim: 'annual_turnover' },
        { text: 'We have four staff.', claim: 'staff_count' },
        { text: 'We would welcome your support.', claim: null },
      ],
      [confirmedTurnover],
    );
    expect(result.supported).toHaveLength(1);
    expect(result.unsupported).toHaveLength(1);
  });
});

const standingFact = (over: Partial<Fact> = {}): Fact => ({
  id: 'fact_mission',
  organisationId: 'org_a',
  claim: 'mission',
  value: 'We train young people in Somerset.',
  sourceType: 'user',
  sourceRef: null,
  sourceSpan: null,
  retrievedAt: '2026-09-01T00:00:00.000Z',
  confidence: 'high',
  confirmedBy: 'user_a',
  confirmedAt: '2026-09-01T00:00:00.000Z',
  supersededBy: null,
  ...over,
});

describe('where a drafted sentence stands', () => {
  /**
   * The bug this closes was visible in one card: "✓ every claim traced to a
   * confirmed fact" printed directly above "Copy answer (2 unsupported)", with
   * both sentences highlighted as having "nothing behind them". The workspace
   * counted `factId === null` as unsupported; `groundClaims` skipped those
   * sentences entirely. One definition now, in the domain.
   */

  it('calls a sentence that cites nothing "no claim", not unsupported', () => {
    // The Writer's own instructions say a sentence asserting nothing factual
    // sets factId to null. Linking sentences are not a defect; prose without
    // them is a list.
    expect(claimStanding(null, [standingFact()])).toBe('no_claim');
  });

  it('calls a resolved citation supported', () => {
    expect(claimStanding('fact_mission', [standingFact()])).toBe('supported');
    expect(claimStanding('mission', [standingFact()])).toBe('supported');
  });

  it('calls a citation that no longer resolves unsupported', () => {
    // The real case: a fact confirmed yesterday, corrected today, leaving a
    // saved answer standing on it.
    expect(claimStanding('fact_mission', [])).toBe('unsupported');
    expect(claimStanding('fact_gone', [standingFact()])).toBe('unsupported');
  });

  it('does not count an unconfirmed fact as support', () => {
    // The whole architecture: only a fact somebody checked may hold a claim up.
    const pending = standingFact({ confirmedBy: null, confirmedAt: null });
    expect(claimStanding('fact_mission', [pending])).toBe('unsupported');
  });

  it('does not count a superseded fact as support', () => {
    const old = standingFact({ supersededBy: 'fact_newer' });
    expect(claimStanding('fact_mission', [old])).toBe('unsupported');
  });

  it('counts only the unsupported, never the no-claims', () => {
    // THE property. A draft of two supported sentences and one linking
    // sentence must report zero unsupported, or the summary and the
    // highlighting contradict each other on screen.
    expect(countUnsupported(['supported', 'no_claim', 'supported'])).toBe(0);
    expect(countUnsupported(['supported', 'unsupported', 'no_claim'])).toBe(1);
  });
});
