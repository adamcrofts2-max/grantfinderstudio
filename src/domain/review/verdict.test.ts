import { describe, expect, it } from 'vitest';

import { verdictForReviewer } from './verdict.js';

const base = { verdict: 'unknown' as const, checked: 0, undecided: 0, applicantKnown: true };

describe('the verdict a reviewer is shown', () => {
  it('never addresses the reviewer as the applicant', () => {
    // The readiness card says "You meet all 4 criteria". Read by the person
    // they asked to check it over, every one of those pronouns is false.
    const cases = [
      { ...base, verdict: 'eligible' as const, checked: 4 },
      { ...base, verdict: 'ineligible' as const, checked: 4 },
      { ...base, checked: 4, undecided: 2 },
      { ...base, applicantKnown: false },
      base,
    ];
    for (const eligibility of cases) {
      const said = verdictForReviewer(eligibility);
      // "If you know their rules" is fine — that "you" IS the reviewer. What
      // must never appear is the applicant's second person: a reviewer told
      // "you do not meet this funder's criteria" has been told something
      // false about themselves.
      expect(said.detail).not.toMatch(
        /\byou (meet|do not meet|qualify)\b|\byour (own )?(details|criteria|organisation|application)\b/iu,
      );
      expect(said.label.split(' ').length).toBeLessThanOrEqual(3);
    }
  });

  it('counts the criteria it says were met', () => {
    expect(verdictForReviewer({ ...base, verdict: 'eligible', checked: 1 }).detail).toMatch(
      /the one criterion/u,
    );
    expect(verdictForReviewer({ ...base, verdict: 'eligible', checked: 4 }).detail).toMatch(
      /all 4 criteria/u,
    );
  });

  it('distinguishes the funder’s silence from the applicant’s', () => {
    // Only one of the two is something a reviewer could raise with them.
    const noProfile = verdictForReviewer({ ...base, applicantKnown: false });
    const noRules = verdictForReviewer({ ...base, applicantKnown: true, checked: 0 });
    expect(noProfile.detail).toMatch(/own details/u);
    expect(noRules.detail).toMatch(/publishes nothing/u);
    expect(noProfile.detail).not.toBe(noRules.detail);
  });

  it('does not read an undecided rule as a fault of the application', () => {
    const partly = verdictForReviewer({ ...base, checked: 5, undecided: 2 });
    expect(partly.tone).toBe('neutral');
    expect(partly.detail).toMatch(/2 of the 5/u);
    expect(partly.detail).toMatch(/left vague/u);
  });

  it('is the only verdict with a negative tone when it fails', () => {
    expect(verdictForReviewer({ ...base, verdict: 'ineligible' }).tone).toBe('negative');
    expect(verdictForReviewer({ ...base, verdict: 'eligible', checked: 2 }).tone).toBe('positive');
    expect(verdictForReviewer(base).tone).toBe('neutral');
  });
});
