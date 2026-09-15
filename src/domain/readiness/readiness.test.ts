import { describe, expect, it } from 'vitest';
import { assessReadiness, type ReadinessInput } from './readiness.js';

const complete: ReadinessInput = {
  eligibilityVerdict: 'eligible',
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

describe('assessReadiness', () => {
  it('reports a complete application as fully ready', () => {
    const r = assessReadiness(complete);
    expect(r.percent).toBe(100);
    expect(r.blockers).toHaveLength(0);
  });

  it('reports an empty application as not ready', () => {
    const r = assessReadiness({
      ...complete,
      eligibilityVerdict: 'unknown',
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
    const r = assessReadiness({ ...complete, eligibilityVerdict: 'ineligible' });
    expect(r.blockers).toContain('You are not eligible for this fund.');
    expect(r.components.find((c) => c.id === 'eligibility')?.score).toBe(0);
  });

  it('scores unresolved eligibility as half', () => {
    const r = assessReadiness({ ...complete, eligibilityVerdict: 'unknown' });
    expect(r.components.find((c) => c.id === 'eligibility')?.score).toBe(0.5);
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

  it('gives every component a detail line', () => {
    for (const c of assessReadiness(complete).components) {
      expect(c.detail.length).toBeGreaterThan(0);
    }
  });

  it('scores zero when every applicable component is empty', () => {
    const r = assessReadiness({
      ...complete,
      eligibilityVerdict: 'ineligible',
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
