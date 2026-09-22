/**
 * The shared vocabulary for a funder's answer.
 *
 * Tested because it is where the shortfall is named. "Funded" alone hides the
 * most useful thing about an award that came in under the ask, and a
 * regression here would be invisible on screen — the row would still look
 * right.
 */
import { describe, expect, it } from 'vitest';

import { DECISION_BADGE, decisionLine } from './components';
import { DECISIONS } from '@/domain/tracker/decision';

describe('decisionLine', () => {
  it('names the shortfall when an award came in under the ask', () => {
    const line = decisionLine({
      decision: 'awarded',
      decidedOn: '2026-09-01',
      amountAwardedGbp: 12_500,
      amountRequestedGbp: 20_000,
    });
    expect(line).toContain('£12,500');
    expect(line).toContain('of the £20,000 asked for');
  });

  it('does not invent a shortfall when the award met the ask', () => {
    const line = decisionLine({
      decision: 'awarded',
      decidedOn: '2026-09-01',
      amountAwardedGbp: 20_000,
      amountRequestedGbp: 20_000,
    });
    expect(line).toContain('£20,000');
    expect(line).not.toContain('asked for');
  });

  it('says so when the amount was never recorded', () => {
    const line = decisionLine({
      decision: 'awarded',
      decidedOn: '2026-09-01',
      amountAwardedGbp: null,
      amountRequestedGbp: 20_000,
    });
    expect(line).toContain('No amount recorded');
  });

  it('distinguishes silence from a refusal in so many words', () => {
    const refused = decisionLine({
      decision: 'rejected',
      decidedOn: '2026-09-01',
      amountAwardedGbp: null,
      amountRequestedGbp: null,
    });
    const silent = decisionLine({
      decision: 'no_reply',
      decidedOn: '2026-09-01',
      amountAwardedGbp: null,
      amountRequestedGbp: null,
    });
    expect(refused).toContain('Turned down');
    expect(silent).toContain('not the same as a refusal');
  });

  it('still reads as a sentence with no date', () => {
    const line = decisionLine({
      decision: 'rejected',
      decidedOn: null,
      amountAwardedGbp: null,
      amountRequestedGbp: null,
    });
    expect(line).toBe('Turned down.');
  });
});

describe('DECISION_BADGE', () => {
  it('has a badge for every answer a funder can give', () => {
    for (const decision of DECISIONS) {
      expect(DECISION_BADGE[decision]?.label).toBeTruthy();
    }
  });
});
