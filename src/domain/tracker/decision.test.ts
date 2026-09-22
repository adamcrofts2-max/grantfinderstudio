import { describe, expect, it } from 'vitest';

import {
  checkDecision,
  decisionSummary,
  ENOUGH_TO_RATE,
  isDecision,
  MAX_AWARD_GBP,
  MAX_NOTE_LENGTH,
  readAmount,
  type DecidedApplication,
} from './decision.js';

const CONTEXT = { today: '2026-09-22', submittedOn: '2026-06-01' };

describe('isDecision', () => {
  it('accepts only the three a funder can give', () => {
    expect(isDecision('awarded')).toBe(true);
    expect(isDecision('rejected')).toBe(true);
    expect(isDecision('no_reply')).toBe(true);
    expect(isDecision('submitted')).toBe(false);
    expect(isDecision('')).toBe(false);
  });
});

describe('readAmount', () => {
  it('reads what a person actually types', () => {
    expect(readAmount('12500')).toBe(12_500);
    expect(readAmount('12,500')).toBe(12_500);
    expect(readAmount('£12,500')).toBe(12_500);
    expect(readAmount('12500.50')).toBe(12_500.5);
    expect(readAmount(' 12 500 ')).toBe(12_500);
  });

  it('refuses rather than guessing', () => {
    expect(readAmount('')).toBeNull();
    expect(readAmount('about twelve thousand')).toBeNull();
    expect(readAmount('12.345')).toBeNull();
    expect(readAmount('-500')).toBeNull();
  });
});

describe('checkDecision', () => {
  it('takes a plain award', () => {
    const result = checkDecision(
      { decision: 'awarded', decidedOn: '2026-09-01', amountAwardedGbp: '£12,500' },
      CONTEXT,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        decision: 'awarded',
        decidedOn: '2026-09-01',
        amountAwardedGbp: 12_500,
        note: null,
      },
    });
  });

  it('takes a refusal with the funder’s reason', () => {
    const result = checkDecision(
      { decision: 'rejected', decidedOn: '2026-09-01', note: '  Oversubscribed this round.  ' },
      CONTEXT,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.note).toBe('Oversubscribed this round.');
  });

  it('takes silence, which is its own answer', () => {
    const result = checkDecision({ decision: 'no_reply', decidedOn: '2026-09-01' }, CONTEXT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.decision).toBe('no_reply');
  });

  it('names the field it is complaining about', () => {
    const result = checkDecision({ decision: 'maybe', decidedOn: '2026-09-01' }, CONTEXT);
    expect(result).toMatchObject({ ok: false, field: 'decision' });
  });

  it('refuses a date that is not a real day', () => {
    expect(checkDecision({ decision: 'awarded', decidedOn: '2026-02-30' }, CONTEXT)).toMatchObject({
      ok: false,
      field: 'decidedOn',
    });
    expect(checkDecision({ decision: 'awarded', decidedOn: '1 Sept' }, CONTEXT)).toMatchObject({
      ok: false,
      field: 'decidedOn',
    });
  });

  it('refuses an answer from the future', () => {
    expect(checkDecision({ decision: 'awarded', decidedOn: '2026-09-23' }, CONTEXT)).toMatchObject({
      ok: false,
      field: 'decidedOn',
    });
  });

  it('accepts an answer that came today', () => {
    expect(checkDecision({ decision: 'awarded', decidedOn: '2026-09-22' }, CONTEXT).ok).toBe(true);
  });

  it('refuses an answer that predates the application', () => {
    const result = checkDecision({ decision: 'rejected', decidedOn: '2026-05-31' }, CONTEXT);
    expect(result).toMatchObject({ ok: false, field: 'decidedOn' });
    if (!result.ok) expect(result.reason).toContain('2026-06-01');
  });

  it('allows an answer on the day it went in', () => {
    expect(checkDecision({ decision: 'rejected', decidedOn: '2026-06-01' }, CONTEXT).ok).toBe(true);
  });

  it('has nothing to compare against when the submission date is unknown', () => {
    const result = checkDecision(
      { decision: 'rejected', decidedOn: '2020-01-01' },
      { today: '2026-09-22', submittedOn: null },
    );
    expect(result.ok).toBe(true);
  });

  it('refuses an amount on anything but an award', () => {
    expect(
      checkDecision(
        { decision: 'rejected', decidedOn: '2026-09-01', amountAwardedGbp: '500' },
        CONTEXT,
      ),
    ).toMatchObject({ ok: false, field: 'amountAwardedGbp' });
  });

  it('allows an award whose amount is not known yet', () => {
    const result = checkDecision(
      { decision: 'awarded', decidedOn: '2026-09-01', amountAwardedGbp: '   ' },
      CONTEXT,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.amountAwardedGbp).toBeNull();
  });

  it('refuses an award of nothing rather than storing a zero', () => {
    expect(
      checkDecision(
        { decision: 'awarded', decidedOn: '2026-09-01', amountAwardedGbp: '0' },
        CONTEXT,
      ),
    ).toMatchObject({ ok: false, field: 'amountAwardedGbp' });
  });

  it('catches a figure large enough to be pence', () => {
    const result = checkDecision(
      {
        decision: 'awarded',
        decidedOn: '2026-09-01',
        amountAwardedGbp: String(MAX_AWARD_GBP + 1),
      },
      CONTEXT,
    );
    expect(result).toMatchObject({ ok: false, field: 'amountAwardedGbp' });
    if (!result.ok) expect(result.reason).toContain('pence');
  });

  it('refuses a note longer than the column allows', () => {
    const result = checkDecision(
      { decision: 'rejected', decidedOn: '2026-09-01', note: 'x'.repeat(MAX_NOTE_LENGTH + 1) },
      CONTEXT,
    );
    expect(result).toMatchObject({ ok: false, field: 'note' });
  });
});

const awarded = (amount: number | null, asked: number | null): DecidedApplication => ({
  decision: 'awarded',
  amountAwardedGbp: amount,
  amountRequestedGbp: asked,
});
const rejected = (asked: number | null): DecidedApplication => ({
  decision: 'rejected',
  amountAwardedGbp: null,
  amountRequestedGbp: asked,
});
const silent = (): DecidedApplication => ({
  decision: 'no_reply',
  amountAwardedGbp: null,
  amountRequestedGbp: 9_000,
});

describe('decisionSummary', () => {
  it('says nothing has come back when nothing has', () => {
    const s = decisionSummary([]);
    expect(s.decided).toBe(0);
    expect(s.sentence).toBe('No outcomes recorded yet.');
  });

  it('counts the three answers separately', () => {
    const s = decisionSummary([awarded(5_000, 8_000), rejected(4_000), silent()]);
    expect(s.awarded).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.noReply).toBe(1);
    expect(s.decided).toBe(3);
  });

  it('adds up only the awards whose size is known, and says how many are not', () => {
    const s = decisionSummary([awarded(5_000, 8_000), awarded(null, 3_000)]);
    expect(s.wonGbp).toBe(5_000);
    expect(s.awardsWithoutAmount).toBe(1);
    expect(s.sentence).toContain('£5,000 won');
    expect(s.sentence).toContain('1 award with no amount recorded');
  });

  it('withholds a success rate until there is enough to read one from', () => {
    const s = decisionSummary([awarded(1_000, 1_000), rejected(1_000)]);
    expect(s.successRate).toBeNull();
    expect(s.sentence).toContain('Too few decided either way');
    expect(s.sentence).not.toContain('%');
  });

  it('gives a rate once enough funders have decided', () => {
    const decided = [
      awarded(1_000, 1_000),
      awarded(1_000, 1_000),
      rejected(1_000),
      rejected(1_000),
      rejected(1_000),
    ];
    expect(decided).toHaveLength(ENOUGH_TO_RATE);
    const s = decisionSummary(decided);
    expect(s.successRate).toBeCloseTo(0.4);
    expect(s.sentence).toContain('40%');
  });

  it('keeps silence out of both halves of the rate', () => {
    // Five decided, two funded — 40%. Ten unanswered applications alongside
    // them must not drag that to 13%: nobody judged those.
    const decided: DecidedApplication[] = [
      awarded(1_000, 1_000),
      awarded(1_000, 1_000),
      rejected(1_000),
      rejected(1_000),
      rejected(1_000),
      ...Array.from({ length: 10 }, silent),
    ];
    const s = decisionSummary(decided);
    expect(s.successRate).toBeCloseTo(0.4);
    expect(s.decided).toBe(15);
  });

  it('counts the ask only across applications a funder actually decided', () => {
    const s = decisionSummary([awarded(5_000, 8_000), rejected(4_000), silent()]);
    expect(s.askedGbp).toBe(12_000);
  });

  it('is honest when awards exist but no amounts were recorded', () => {
    const s = decisionSummary([awarded(null, 8_000)]);
    expect(s.wonGbp).toBe(0);
    expect(s.sentence).toContain('No amounts recorded');
  });
});
