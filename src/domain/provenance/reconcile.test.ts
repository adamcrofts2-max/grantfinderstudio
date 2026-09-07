import { describe, expect, it } from 'vitest';

import type { Fact } from './facts.js';
import {
  normaliseClaim,
  reconcile,
  sameValue,
  summarise,
  toStore,
  type CandidateClaim,
} from './reconcile.js';

function fact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: 'fact_1',
    organisationId: 'org_a',
    claim: 'annual_turnover',
    value: '£148,000',
    sourceType: 'user',
    sourceRef: null,
    sourceSpan: null,
    retrievedAt: '2026-09-01T00:00:00Z',
    confidence: 'high',
    confirmedBy: 'user_a',
    confirmedAt: '2026-09-01T00:00:00Z',
    supersededBy: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateClaim> = {}): CandidateClaim {
  return {
    claim: 'annual_turnover',
    value: '£148,000',
    sourceSpan: 'Our annual turnover in 2025 was £148,000.',
    confidence: 'high',
    ...overrides,
  };
}

describe('sameValue', () => {
  it('ignores how a figure is presented', () => {
    expect(sameValue('£148,000', '148000')).toBe(true);
    expect(sameValue('148,000 pounds', '£148,000')).toBe(true);
    expect(sameValue('GBP 148000', '£148,000')).toBe(true);
    expect(sameValue('148000.00', '148000')).toBe(true);
  });

  it('ignores case and padding', () => {
    expect(sameValue('  Somerset ', 'somerset')).toBe(true);
  });

  it('ignores a trailing full stop', () => {
    expect(sameValue('Wells, Somerset.', 'Wells, Somerset')).toBe(true);
  });

  it('keeps genuinely different claims apart', () => {
    // The conservative half. Over-normalising here would silently merge two
    // different facts and lose one of them.
    expect(sameValue('12 volunteers', '12 staff')).toBe(false);
    expect(sameValue('£148,000', '£184,000')).toBe(false);
    expect(sameValue('Somerset', 'Dorset')).toBe(false);
    expect(sameValue('42', '42 workshops')).toBe(false);
  });

  it('does not strip a comma that is not a thousands separator', () => {
    expect(sameValue('Wells, Somerset', 'Wells Somerset')).toBe(false);
  });
});

describe('reconcile', () => {
  it('offers a claim never held before', () => {
    const [result] = reconcile([candidate({ claim: 'volunteer_count', value: '12' })], []);
    expect(result?.kind).toBe('new');
    expect(result?.existing).toBeNull();
  });

  it('drops a claim already held at the same value', () => {
    const [result] = reconcile([candidate()], [fact()]);
    expect(result?.kind).toBe('duplicate');
    expect(result?.existing?.id).toBe('fact_1');
  });

  it('drops it even when written differently', () => {
    const [result] = reconcile([candidate({ value: '148000' })], [fact()]);
    expect(result?.kind).toBe('duplicate');
  });

  it('raises a conflict when the document disagrees with a confirmed fact', () => {
    // The case this module exists for. Silently appending would leave two
    // turnovers on file and no signal that they disagree.
    const [result] = reconcile([candidate({ value: '£184,000' })], [fact()]);
    expect(result?.kind).toBe('conflict');
    expect(result?.existing?.value).toBe('£148,000');
  });

  it('reports a conflict against the confirmed value, not an unconfirmed one', () => {
    const results = reconcile(
      [candidate({ value: '£184,000' })],
      [
        fact({ id: 'unconfirmed', value: '£99,000', confirmedBy: null, confirmedAt: null }),
        fact({ id: 'confirmed', value: '£148,000' }),
      ],
    );
    expect(results[0]?.kind).toBe('conflict');
    expect(results[0]?.existing?.id).toBe('confirmed');
  });

  it('ignores superseded facts, so a correction is not re-argued', () => {
    // Once someone has corrected a fact, the old value is history. Conflicting
    // against it would make every later document reopen a settled question.
    const results = reconcile(
      [candidate({ value: '£184,000' })],
      [fact({ value: '£148,000', supersededBy: 'fact_2' })],
    );
    expect(results[0]?.kind).toBe('new');
  });

  it('matches a claim regardless of case or padding', () => {
    const results = reconcile([candidate({ claim: ' Annual_Turnover ' })], [fact()]);
    expect(results[0]?.kind).toBe('duplicate');
  });

  it('does not offer the same figure twice from one document', () => {
    const results = reconcile([candidate(), candidate({ value: '148000' })], []);
    expect(results[0]?.kind).toBe('new');
    expect(results[1]?.kind).toBe('duplicate');
  });

  it('offers both when one document states a claim two different ways', () => {
    // Neither is held yet, so neither conflicts with anything: reporting the
    // second as a conflict would tell the user they already hold a value they
    // do not. Both are offered, and the review screen groups them by claim so
    // the disagreement is visible where it belongs.
    const results = reconcile([candidate(), candidate({ value: '£184,000' })], []);
    expect(results.map((r) => r.kind)).toEqual(['new', 'new']);
  });

  it('handles an empty extraction without inventing anything', () => {
    expect(reconcile([], [fact()])).toEqual([]);
  });
});

describe('summarise and toStore', () => {
  const results = reconcile(
    [
      candidate(),
      candidate({ claim: 'volunteer_count', value: '12' }),
      candidate({ claim: 'area', value: 'Dorset' }),
    ],
    [fact(), fact({ id: 'f2', claim: 'area', value: 'Somerset' })],
  );

  it('counts what happened in terms a person can act on', () => {
    expect(summarise(results)).toEqual({ added: 1, conflicts: 1, alreadyKnown: 1 });
  });

  it('stores everything still needing a decision, and nothing else', () => {
    expect(toStore(results).map((r) => r.kind)).toEqual(['new', 'conflict']);
  });
});

describe('normaliseClaim', () => {
  it('ignores the order the model happened to put words in', () => {
    // Observed on a live run over one document: the same sentence produced
    // both of these, and the confirmation list showed the fact twice.
    expect(normaliseClaim('incorporation_date')).toBe(normaliseClaim('date_of_incorporation'));
  });

  it('ignores a counting prefix', () => {
    expect(normaliseClaim('number_of_workshops_delivered_in_2025')).toBe(
      normaliseClaim('workshops_delivered_in_2025'),
    );
    expect(normaliseClaim('total_volunteers')).toBe(normaliseClaim('volunteers'));
  });

  it('ignores punctuation, case and separators', () => {
    expect(normaliseClaim('Annual Turnover')).toBe(normaliseClaim('annual_turnover'));
    expect(normaliseClaim('annual-turnover')).toBe(normaliseClaim('annual_turnover'));
  });

  it('keeps different claims apart', () => {
    // The dangerous direction. A wrong merge loses a fact silently, which is
    // worse than a near-duplicate a person can dismiss in one click.
    expect(normaliseClaim('staff_count')).not.toBe(normaliseClaim('volunteer_count'));
    expect(normaliseClaim('turnover_2024')).not.toBe(normaliseClaim('turnover_2025'));
    expect(normaliseClaim('beneficiary_age_range')).not.toBe(
      normaliseClaim('beneficiary_groups'),
    );
  });
});

describe('reconcile with unstable claim keys', () => {
  it('recognises the same fact under a differently worded key', () => {
    const results = reconcile(
      [candidate({ claim: 'date_of_incorporation', value: '15 January 2020' })],
      [fact({ claim: 'incorporation_date', value: '15 January 2020' })],
    );
    expect(results[0]?.kind).toBe('duplicate');
  });

  it('raises a conflict rather than a duplicate when the values differ too', () => {
    const results = reconcile(
      [candidate({ claim: 'number_of_volunteers', value: '15' })],
      [fact({ claim: 'volunteer_count', value: '12' })],
    );
    expect(results[0]?.kind).toBe('conflict');
  });

  it('offers a renamed key only once within a single document', () => {
    const results = reconcile(
      [
        candidate({ claim: 'volunteer_count', value: '12' }),
        candidate({ claim: 'number_of_volunteers', value: '12' }),
      ],
      [],
    );
    expect(results.map((r) => r.kind)).toEqual(['new', 'duplicate']);
  });
});
