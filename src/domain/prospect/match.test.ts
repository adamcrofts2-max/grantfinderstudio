import { describe, expect, it } from 'vitest';

import type { Award } from '../funder/behaviour.js';
import {
  assessProspect,
  byRelevance,
  findProspects,
  labelsOverlap,
  PROSPECT_CONSTANTS,
  regionsMatch,
  type FunderAwards,
  type Prospect,
  type ProspectApplicant,
} from './match.js';

const ASOF = '2026-09-08';

function award(overrides: Partial<Award> = {}): Award {
  return {
    id: `aw_${Math.random().toString(36).slice(2)}`,
    amountGbp: 20_000,
    awardedOn: '2026-01-15',
    recipientName: 'Some CIC',
    jurisdiction: 'england',
    region: 'Somerset',
    tags: ['Children and young people'],
    ...overrides,
  };
}

function applicant(overrides: Partial<ProspectApplicant> = {}): ProspectApplicant {
  return {
    jurisdiction: 'england',
    region: 'Somerset',
    beneficiaryGroups: ['young people'],
    amountSoughtGbp: 25_000,
    ...overrides,
  };
}

function funder(awards: Award[], name = 'The Example Trust'): FunderAwards {
  return { funderId: 'f1', funderName: name, awards };
}

/** Five is the floor for characterising a funder at all. */
const five = (over: Partial<Award> = {}): Award[] =>
  Array.from({ length: 5 }, () => award(over));

describe('labelsOverlap', () => {
  it('matches how funders write labels against how applicants write them', () => {
    expect(labelsOverlap('Children and young people', 'young people')).toBe(true);
    expect(labelsOverlap('Older people', 'older people')).toBe(true);
    expect(labelsOverlap('Disabled children', 'disabled people')).toBe(true);
  });

  it('ignores plurals and punctuation', () => {
    expect(labelsOverlap('Refugee support', 'refugees and asylum seekers')).toBe(true);
  });

  it('does not match on filler words alone', () => {
    // "people" and "community" appear in half of all classification labels;
    // matching on them would make every funder look relevant.
    expect(labelsOverlap('Older people', 'young people')).toBe(false);
    expect(labelsOverlap('Community buildings', 'community transport')).toBe(false);
  });

  it('keeps genuinely different causes apart', () => {
    expect(labelsOverlap('Heritage and the arts', 'young people')).toBe(false);
    expect(labelsOverlap('Medical research', 'refugees')).toBe(false);
  });
});

describe('regionsMatch', () => {
  it('matches the same place written differently', () => {
    expect(regionsMatch('Somerset', 'somerset')).toBe(true);
    expect(regionsMatch('Somerset County', 'Somerset')).toBe(true);
  });

  it('does not match different places', () => {
    expect(regionsMatch('Somerset', 'Dorset')).toBe(false);
  });

  it('treats a missing region as no match rather than a match', () => {
    expect(regionsMatch(null, 'Somerset')).toBe(false);
    expect(regionsMatch('Somerset', null)).toBe(false);
    expect(regionsMatch('', 'Somerset')).toBe(false);
  });
});

describe('assessProspect', () => {
  it('declines to characterise a funder with too few published grants', () => {
    // Three grants do not describe anyone's habits, and the honest answer is
    // to say so rather than produce a weak guess.
    const result = assessProspect(funder([award(), award(), award()]), applicant(), ASOF);
    expect(result.tier).toBe('not_characterised');
    expect(result.medianAwardGbp).toBeNull();
    expect(result.amountFit).toBe('unknown');
    expect(result.reasons[0]).toContain('too few');
  });

  it('puts a funder that has funded your cause in your area at the top tier', () => {
    const result = assessProspect(funder(five()), applicant(), ASOF);
    expect(result.tier).toBe('area_and_cause');
    expect(result.matchingAwards).toHaveLength(5);
    expect(result.reasons[0]).toContain('in your area');
  });

  it('separates your cause elsewhere from your area for other causes', () => {
    const elsewhere = assessProspect(
      funder(five({ region: 'Cumbria', jurisdiction: 'england' })),
      applicant({ jurisdiction: null }),
      ASOF,
    );
    expect(elsewhere.tier).toBe('cause');

    const otherCause = assessProspect(
      funder(five({ tags: ['Heritage and the arts'] })),
      applicant(),
      ASOF,
    );
    expect(otherCause.tier).toBe('area');
  });

  it('reports no overlap rather than inventing one', () => {
    const result = assessProspect(
      funder(five({ tags: ['Medical research'], region: 'Cumbria', jurisdiction: 'scotland' })),
      applicant(),
      ASOF,
    );
    expect(result.tier).toBe('no_overlap');
    expect(result.matchingAwards).toEqual([]);
  });

  it('counts a UK-wide funder as covering your area', () => {
    const result = assessProspect(
      funder(five({ region: null, jurisdiction: 'uk_wide' })),
      applicant(),
      ASOF,
    );
    expect(result.tier).toBe('area_and_cause');
  });

  it('does not count a funder that only gives in another nation', () => {
    const result = assessProspect(
      funder(five({ region: 'Fife', jurisdiction: 'scotland' })),
      applicant(),
      ASOF,
    );
    expect(result.tier).toBe('cause');
  });

  it('says how your amount sits against what they actually give', () => {
    const awards = [10_000, 15_000, 20_000, 25_000, 30_000].map((amountGbp) =>
      award({ amountGbp }),
    );
    expect(assessProspect(funder(awards), applicant({ amountSoughtGbp: 20_000 }), ASOF).amountFit)
      .toBe('within_typical');
    expect(assessProspect(funder(awards), applicant({ amountSoughtGbp: 500 }), ASOF).amountFit)
      .toBe('below_typical');
    expect(assessProspect(funder(awards), applicant({ amountSoughtGbp: 90_000 }), ASOF).amountFit)
      .toBe('above_typical');
  });

  it('says the amount fit is unknown when no amount has been decided', () => {
    const result = assessProspect(funder(five()), applicant({ amountSoughtGbp: null }), ASOF);
    expect(result.amountFit).toBe('unknown');
    expect(result.reasons.join(' ')).not.toMatch(/usual range|above most|below most/u);
  });

  it('flags a funder that has published nothing for years', () => {
    const result = assessProspect(funder(five({ awardedOn: '2021-01-15' })), applicant(), ASOF);
    expect(result.mayBeDormant).toBe(true);
    expect(result.monthsSinceLastAward).toBeGreaterThan(
      PROSPECT_CONSTANTS.dormantAfterMonths,
    );
  });

  it('says a gap may be a publishing gap rather than a funding one', () => {
    // Publishers update 360Giving at very different rates. Treating silence as
    // closure would quietly remove real funders from someone's list.
    const result = assessProspect(funder(five({ awardedOn: '2021-01-15' })), applicant(), ASOF);
    expect(result.reasons.join(' ')).toContain('stopped publishing');
  });

  it('never predicts that a funder will fund you', () => {
    const all = [
      assessProspect(funder(five()), applicant(), ASOF),
      assessProspect(funder(five({ tags: ['Heritage'] })), applicant(), ASOF),
      assessProspect(funder([award()]), applicant(), ASOF),
    ];
    for (const prospect of all) {
      const text = prospect.reasons.join(' ');
      expect(text).not.toMatch(/likely|chance|probability|will fund|good fit|score/iu);
    }
  });

  it('carries the actual grants that put it in its tier, so the claim is checkable', () => {
    const result = assessProspect(funder(five()), applicant(), ASOF);
    expect(result.matchingAwards.every((a) => a.tags.includes('Children and young people'))).toBe(
      true,
    );
  });
});

const prospect = (over: Partial<Prospect>): Prospect =>
  ({
    funderId: 'f',
    funderName: 'A Trust',
    tier: 'cause',
    totalAwards: 10,
    matchingAwards: [],
    amountFit: 'unknown',
    medianAwardGbp: 10_000,
    lastAwardedOn: '2026-01-01',
    monthsSinceLastAward: 8,
    mayBeDormant: false,
    reasons: [],
    ...over,
  }) as Prospect;

describe('byRelevance', () => {

  it('orders by tier first', () => {
    const sorted = [
      prospect({ tier: 'no_overlap' }),
      prospect({ tier: 'area_and_cause' }),
      prospect({ tier: 'not_characterised' }),
      prospect({ tier: 'area' }),
      prospect({ tier: 'cause' }),
    ]
      .toSorted(byRelevance)
      .map((x) => x.tier);
    expect(sorted).toEqual(['area_and_cause', 'cause', 'area', 'no_overlap', 'not_characterised']);
  });

  it('puts a funder that may have stopped giving below one that has not', () => {
    const sorted = [prospect({ mayBeDormant: true }), prospect({ mayBeDormant: false })]
      .toSorted(byRelevance)
      .map((x) => x.mayBeDormant);
    expect(sorted).toEqual([false, true]);
  });

  it('then orders by how much evidence there is', () => {
    const sorted = [
      prospect({ matchingAwards: [award()] }),
      prospect({ matchingAwards: [award(), award(), award()] }),
    ]
      .toSorted(byRelevance)
      .map((x) => x.matchingAwards.length);
    expect(sorted).toEqual([3, 1]);
  });

  it('is stable on name when everything else is equal', () => {
    const sorted = [prospect({ funderName: 'Zed Trust' }), prospect({ funderName: 'Alpha Trust' })]
      .toSorted(byRelevance)
      .map((x) => x.funderName);
    expect(sorted).toEqual(['Alpha Trust', 'Zed Trust']);
  });
});

describe('findProspects', () => {
  it('assesses every funder and returns them in reading order', () => {
    const result = findProspects(
      [
        { funderId: 'a', funderName: 'Heritage Trust', awards: five({ tags: ['Heritage'] }) },
        { funderId: 'b', funderName: 'Youth Trust', awards: five() },
        { funderId: 'c', funderName: 'Tiny Trust', awards: [award()] },
      ],
      applicant(),
      ASOF,
    );
    expect(result.map((p) => p.funderName)).toEqual([
      'Youth Trust',
      'Heritage Trust',
      'Tiny Trust',
    ]);
  });

  it('returns nothing for no funders, rather than inventing a list', () => {
    expect(findProspects([], applicant(), ASOF)).toEqual([]);
  });
});

describe('area wording is as precise as the evidence', () => {
  it('says "in your area" only for grants actually made in it', () => {
    const result = assessProspect(funder(five({ region: 'Somerset' })), applicant(), ASOF);
    expect(result.reasons[0]).toContain('in your area');
  });

  it('says "elsewhere in your nation" when the match is only national', () => {
    // Saying "in your area" of a grant made 80 miles away is the kind of small
    // dishonesty that costs trust the moment someone opens the list.
    const result = assessProspect(
      funder(five({ region: 'Northumberland', jurisdiction: 'england' })),
      applicant(),
      ASOF,
    );
    expect(result.tier).toBe('area_and_cause');
    expect(result.reasons[0]).toContain('elsewhere in your nation');
    expect(result.reasons[0]).not.toContain('in your area');
  });

  it('says the same for an area-only match', () => {
    const result = assessProspect(
      funder(five({ region: 'Northumberland', tags: ['Heritage'] })),
      applicant(),
      ASOF,
    );
    expect(result.tier).toBe('area');
    expect(result.reasons[0]).toContain('in your nation');
  });

  it('counts a mixed set by how many were truly local', () => {
    const mixed = [
      award({ region: 'Somerset' }),
      award({ region: 'Somerset' }),
      award({ region: 'Devon' }),
      award({ region: 'Devon' }),
      award({ region: 'Devon' }),
    ];
    const result = assessProspect(funder(mixed), applicant(), ASOF);
    expect(result.reasons[0]).toBe('2 grants to work like yours, in your area.');
  });
});
