import { describe, expect, it } from 'vitest';
import { assessReadiness, type ReadinessInput } from './readiness.js';

/** Eligibility decided, against rules the funder actually publishes. */
const decided = { verdict: 'eligible' as const, checked: 5, undecided: 0, applicantKnown: true };

const complete: ReadinessInput = {
  eligibility: decided,
  questionsTotal: 8,
  questionsAnswered: 8,
  answersWithUnsupportedClaims: 0,
  evidenceNeeded: 3,
  evidenceProvided: 3,
  budgetSubmittable: true,
  budgetHasLines: true,
  outcomesDefined: 4,
  attachmentsRequired: 2,
  attachmentsProvided: 2,
  answersOverWordLimit: 0,
};

const budget = (input: ReadinessInput) =>
  assessReadiness(input).components.find((c) => c.id === 'budget')?.detail ?? '';

describe('what the budget line claims was checked', () => {
  /**
   * Found by the September 2026 walk: a fund typed in by hand has no rules on
   * record, the only check made was the total, and the card still said "The
   * budget is consistent with the funder's rules".
   */
  it('claims consistency with the rules only when rules were checked', () => {
    expect(budget({ ...complete, budgetRulesChecked: true })).toMatch(/consistent with the funder/u);
  });

  it('says only what was checked when there were no rules', () => {
    const line = budget({ ...complete, budgetRulesChecked: false });
    expect(line).not.toMatch(/funder’s rules\./u);
    expect(line).toMatch(/adds up to what you are asking for/u);
    expect(line).toMatch(/no funder rules on record/u);
  });

  it('defaults to the weaker claim when a caller does not say', () => {
    expect(budget(complete)).toMatch(/no funder rules on record/u);
  });
});

describe('assessReadiness', () => {
  it('reports a complete application as fully ready', () => {
    const r = assessReadiness(complete);
    expect(r.percent).toBe(100);
    expect(r.blockers).toHaveLength(0);
  });

  it('reports an empty application as not ready', () => {
    const r = assessReadiness({
      ...complete,
      eligibility: { ...decided, verdict: 'unknown', undecided: 5 },
      questionsAnswered: 0,
      evidenceProvided: 0,
      budgetSubmittable: false,
      budgetHasLines: false,
      outcomesDefined: 0,
      attachmentsProvided: 0,
    });
    // 8%: unresolved eligibility scores 0.5 and nothing else scores at all.
    //
    // This asserted 21%, and its own comment said why — "word-limit
    // compliance is vacuously satisfied when no answers exist yet". That was
    // the bug, written down and blessed: a component scoring full marks for
    // emptiness. Compliance is now null until something is written, so it is
    // excluded rather than counted as perfect.
    expect(r.percent).toBe(8);
    expect(r.blockers.length).toBeGreaterThan(3);
  });

  it('blocks an ineligible application outright', () => {
    const r = assessReadiness({ ...complete, eligibility: { ...decided, verdict: 'ineligible' } });
    expect(r.blockers).toContain('You are not eligible for this fund.');
    expect(r.components.find((c) => c.id === 'eligibility')?.score).toBe(0);
  });

  it('scores unresolved eligibility as half — when there is something to resolve', () => {
    const r = assessReadiness({
      ...complete,
      eligibility: { ...decided, verdict: 'unknown', undecided: 2 },
    });
    const eligibility = r.components.find((c) => c.id === 'eligibility');
    expect(eligibility?.score).toBe(0.5);
    expect(eligibility?.detail).toBe(
      '2 of 5 criteria cannot be decided from what we know about you.',
    );
  });

  /**
   * THE TWO UNKNOWNS THAT ARE NOT ABOUT THIS APPLICATION.
   *
   * A bare verdict made these indistinguishable from an unknown with criteria
   * behind it, so the card said "Some eligibility questions are unresolved"
   * when there was no question to resolve — and scored it half marks, putting
   * a number on the screen that no amount of work could move.
   */
  it('does not score eligibility at all when the funder publishes no rules', () => {
    const r = assessReadiness({
      ...complete,
      eligibility: { verdict: 'unknown', checked: 0, undecided: 0, applicantKnown: true },
    });
    const eligibility = r.components.find((c) => c.id === 'eligibility');
    expect(eligibility?.score).toBeNull();
    expect(eligibility?.detail).toContain('Nothing is published here about who can apply');
    // Excluded from the average rather than dragging it to the middle.
    expect(r.counted).toBe(r.components.filter((c) => c.score !== null).length);
    expect(r.percent).toBe(100);
  });

  it('does not score eligibility at all before the applicant’s own details are in', () => {
    const r = assessReadiness({
      ...complete,
      eligibility: { verdict: 'unknown', checked: 0, undecided: 0, applicantKnown: false },
    });
    const eligibility = r.components.find((c) => c.id === 'eligibility');
    expect(eligibility?.score).toBeNull();
    expect(eligibility?.detail).toContain('Your own details are not in yet');
  });

  it('says how many criteria it met, rather than "every criterion we can check"', () => {
    expect(
      assessReadiness(complete).components.find((c) => c.id === 'eligibility')?.detail,
    ).toBe('You meet all 5 criteria this funder publishes.');
    expect(
      assessReadiness({ ...complete, eligibility: { ...decided, checked: 1 } }).components.find(
        (c) => c.id === 'eligibility',
      )?.detail,
    ).toBe('You meet the one criterion this funder publishes.');
  });

  /**
   * The breakdown is only readable if the caption can name the set the
   * average came from, and counting the components again at the call site is
   * how that caption drifts from the rule the engine follows.
   */
  it('reports how many components the percentage averages', () => {
    const r = assessReadiness(complete);
    expect(r.counted).toBe(r.components.filter((c) => c.score !== null).length);
    const mean =
      r.components
        .filter((c): c is typeof c & { score: number } => c.score !== null)
        .reduce((sum, c) => sum + c.score, 0) / r.counted;
    expect(r.percent).toBe(Math.round(mean * 100));
  });

  /**
   * Eligibility used to be the guarantee that the average had something to
   * average. It can be null now, so the guarantee has to come from elsewhere:
   * questions, budget and outcomes always carry a number, even when it is
   * zero.
   */
  it('still has something to average for an application with nothing in it', () => {
    const r = assessReadiness({
      eligibility: { verdict: 'unknown', checked: 0, undecided: 0, applicantKnown: false },
      questionsTotal: 0,
      questionsAnswered: 0,
      answersWithUnsupportedClaims: 0,
      evidenceNeeded: 0,
      evidenceProvided: 0,
      budgetSubmittable: false,
      budgetHasLines: false,
      outcomesDefined: 0,
      attachmentsRequired: 0,
      attachmentsProvided: 0,
      answersOverWordLimit: 0,
    });
    expect(r.counted).toBeGreaterThan(0);
    expect(r.percent).toBe(0);
    expect(Number.isNaN(r.percent)).toBe(false);
  });

  it('does not penalise an application with no required attachments', () => {
    const r = assessReadiness({
      ...complete,
      attachmentsRequired: 0,
      attachmentsProvided: 0,
    });
    expect(r.components.find((c) => c.id === 'attachments')?.score).toBeNull();
    expect(r.percent).toBe(100);
  });

  it('blocks on unsupported claims even when everything else is done', () => {
    const r = assessReadiness({ ...complete, answersWithUnsupportedClaims: 2 });
    expect(r.blockers).toContain('2 answers contain claims with no confirmed source.');
  });

  /** Seen on screen as "1 answers contain claims" — a person reads that as a bug. */
  it('uses the singular for a count of one', () => {
    const r = assessReadiness({
      ...complete,
      answersWithUnsupportedClaims: 1,
      questionsAnswered: complete.questionsTotal - 1,
      attachmentsProvided: complete.attachmentsRequired - 1,
      answersOverWordLimit: 1,
    });
    expect(r.blockers).toContain('1 answer contains a claim with no confirmed source.');
    expect(r.blockers).toContain('1 question still to answer.');
    expect(r.blockers).toContain('1 required attachment missing.');
    expect(r.blockers).toContain('1 answer is over the word limit.');
    for (const blocker of r.blockers) {
      expect(blocker, blocker).not.toMatch(/\b1 [a-z]+s\b/u);
    }
  });

  it('blocks on answers over the word limit', () => {
    const r = assessReadiness({ ...complete, answersOverWordLimit: 1 });
    expect(r.components.find((c) => c.id === 'compliance')?.score).toBe(0);
    expect(r.blockers).toContain('1 answer is over the word limit.');
  });

  it('counts partially answered questions proportionally', () => {
    const r = assessReadiness({ ...complete, questionsAnswered: 4 });
    expect(r.components.find((c) => c.id === 'questions')?.score).toBe(0.5);
    expect(r.blockers).toContain('4 questions still to answer.');
  });

  it('scores a budget with errors as half, not zero', () => {
    const r = assessReadiness({ ...complete, budgetSubmittable: false });
    expect(r.components.find((c) => c.id === 'budget')?.score).toBe(0.5);
    expect(r.blockers).toContain('The budget has unresolved errors.');
  });

  it('flags a missing budget', () => {
    const r = assessReadiness({ ...complete, budgetHasLines: false, budgetSubmittable: false });
    expect(r.components.find((c) => c.id === 'budget')?.score).toBe(0);
    expect(r.blockers).toContain('No budget has been built.');
  });

  it('flags missing outcomes', () => {
    const r = assessReadiness({ ...complete, outcomesDefined: 0 });
    expect(r.blockers).toContain('No outcomes have been defined.');
  });

  it('reports missing attachments with a count', () => {
    const r = assessReadiness({ ...complete, attachmentsProvided: 1 });
    expect(r.blockers).toContain('1 required attachment missing.');
  });

  it('scores no questions as zero, not as "does not apply"', () => {
    // It was null, which the average excludes — so an application with no
    // questions in it scored full marks on whatever was left. With a budget
    // and outcomes done it reported **100% ready** directly above the words
    // "0 of 0 questions answered". An application with nothing in it has not
    // been started, let alone nearly finished.
    const r = assessReadiness({ ...complete, questionsTotal: 0, questionsAnswered: 0 });
    expect(r.components.find((c) => c.id === 'questions')?.score).toBe(0);
    expect(r.components.find((c) => c.id === 'questions')?.detail).toContain('have been imported');
    expect(r.blockers.join(' ')).toContain('No questions from the funder');
  });

  it('cannot reach 100% with no questions, however much else is done', () => {
    const r = assessReadiness({
      ...complete,
      questionsTotal: 0,
      questionsAnswered: 0,
      budgetHasLines: true,
      budgetSubmittable: true,
      outcomesDefined: 3,
    });
    expect(r.percent).toBeLessThan(100);
  });

  it('does not credit word limits before anything is written', () => {
    const r = assessReadiness({ ...complete, questionsAnswered: 0, answersOverWordLimit: 0 });
    const compliance = r.components.find((c) => c.id === 'compliance');
    expect(compliance?.score).toBeNull();
    expect(compliance?.detail).toContain('nothing to measure');
  });

  it('never exceeds 100 percent even with over-provision', () => {
    const r = assessReadiness({ ...complete, evidenceProvided: 99, attachmentsProvided: 99 });
    expect(r.percent).toBe(100);
  });

  it('does not call a part-written application compliant outright', () => {
    const half = assessReadiness({ ...complete, questionsAnswered: 4 });
    expect(half.components.find((c) => c.id === 'compliance')?.detail).toBe(
      'Every answer so far is within its word limit.',
    );
    expect(assessReadiness(complete).components.find((c) => c.id === 'compliance')?.detail).toBe(
      'Every answer is within its word limit.',
    );
  });

  it('gives every component a detail line', () => {
    for (const c of assessReadiness(complete).components) {
      expect(c.detail.length).toBeGreaterThan(0);
    }
  });

  it('scores zero when every applicable component is empty', () => {
    const r = assessReadiness({
      ...complete,
      eligibility: { ...decided, verdict: 'ineligible' },
      questionsTotal: 0,
      questionsAnswered: 0,
      evidenceNeeded: 0,
      evidenceProvided: 0,
      budgetHasLines: false,
      budgetSubmittable: false,
      outcomesDefined: 0,
      attachmentsRequired: 0,
      attachmentsProvided: 0,
      answersOverWordLimit: 1,
    });
    expect(r.percent).toBe(0);
  });
});
