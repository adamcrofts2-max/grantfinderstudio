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
    // 21%: unresolved eligibility scores 0.5, and word-limit compliance is
    // vacuously satisfied when no answers exist yet. The blockers carry the
    // real signal.
    expect(r.percent).toBe(21);
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
    expect(r.blockers.some((b) => b.includes('no confirmed source'))).toBe(true);
  });

  it('blocks on answers over the word limit', () => {
    const r = assessReadiness({ ...complete, answersOverWordLimit: 1 });
    expect(r.components.find((c) => c.id === 'compliance')?.score).toBe(0);
    expect(r.blockers.some((b) => b.includes('over the word limit'))).toBe(true);
  });

  it('counts partially answered questions proportionally', () => {
    const r = assessReadiness({ ...complete, questionsAnswered: 4 });
    expect(r.components.find((c) => c.id === 'questions')?.score).toBe(0.5);
    expect(r.blockers.some((b) => b.includes('4 questions still to answer'))).toBe(true);
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
    expect(r.blockers.some((b) => b.includes('1 required attachments missing'))).toBe(true);
  });

  it('handles an application with no questions imported yet', () => {
    const r = assessReadiness({ ...complete, questionsTotal: 0, questionsAnswered: 0 });
    expect(r.components.find((c) => c.id === 'questions')?.score).toBeNull();
    expect(r.components.find((c) => c.id === 'questions')?.detail).toContain('have been imported');
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
