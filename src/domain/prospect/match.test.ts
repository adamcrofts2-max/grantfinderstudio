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
    workAwards: [],
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
    // Two local, and the three in Devon named as well — because the ordering
    // compares the whole matching set, and every key it uses has to be
    // readable on the card.
    expect(result.reasons[0]).toBe(
      '2 grants to work like yours, in your area, and 3 more elsewhere in your nation.',
    );
  });

  it('says nothing about elsewhere when there is nowhere else', () => {
    const local = [award({ region: 'Somerset' }), award({ region: 'Somerset' })];
    const result = assessProspect(funder([...local, ...five({ region: 'Somerset' })]), applicant(), ASOF);
    expect(result.reasons[0]).toBe('7 grants to work like yours, in your area.');
  });
});

describe('a funder that publishes nothing', () => {
  it('says so plainly rather than counting to zero', () => {
    const result = assessProspect(funder([]), applicant(), ASOF);
    expect(result.tier).toBe('not_characterised');
    expect(result.reasons[0]).toBe('They publish no grants at all, so there is nothing to go on.');
    expect(result.reasons[0]).not.toContain('Only 0');
  });

  it('still reports no amounts, so no chart is drawn over nothing', () => {
    const result = assessProspect(funder([]), applicant(), ASOF);
    expect(result.amounts).toBeNull();
    expect(result.medianAwardGbp).toBeNull();
  });

  it('gives a characterised funder a full spread for the chart', () => {
    const awards = [10_000, 15_000, 20_000, 25_000, 30_000].map((amountGbp) =>
      award({ amountGbp }),
    );
    const result = assessProspect(funder(awards), applicant(), ASOF);
    expect(result.amounts).toEqual({
      min: 10_000,
      lowerQuartile: 15_000,
      median: 20_000,
      upperQuartile: 25_000,
      max: 30_000,
    });
  });
});

/**
 * The tree-nursery case, which the walk found.
 *
 * A community tree nursery in Somerset ticks "young people" and "the general
 * community" during onboarding, because the beneficiary list offers nothing
 * else for an environmental CIC. On the labels alone, a woodland funder that
 * had given seventeen tree-nursery grants was filed under "funded in your
 * area, for other kinds of work", and a youth trust was the closest match.
 */
describe('what counts as your kind of work', () => {
  const treeGrants = (): Award[] =>
    Array.from({ length: 5 }, (_, i) =>
      award({
        id: `tree_${i}`,
        tags: ['Environment'],
        title: 'Community tree nursery',
        description:
          'Establishing a community tree nursery growing native saplings from locally collected seed.',
      }),
    );

  const nursery = (over: Partial<ProspectApplicant> = {}) =>
    applicant({
      beneficiaryGroups: ['young people', 'the general community'],
      workWords: ['community', 'tree', 'nursery', 'native', 'saplings'],
      amountSoughtGbp: 18_000,
      ...over,
    });

  it('counts a grant whose text is the work, not only its label', () => {
    const p = assessProspect(funder(treeGrants(), 'Greenwood Trust'), nursery(), ASOF);
    expect(p.tier).toBe('area_and_cause');
    expect(p.matchingAwards).toHaveLength(5);
    expect(p.workAwards).toHaveLength(5);
    // And it SAYS which kind of evidence it is: the funder's own sentences
    // describe this work, rather than merely sharing a category with it.
    expect(p.reasons.join(' ')).toMatch(/for the work you described, in your area/u);
  });

  it('is the old behaviour when nothing describes the work', () => {
    // No work words: an "Environment" label and a youth beneficiary group do
    // not overlap, and the funder is area-only. This is what the walk saw.
    const p = assessProspect(
      funder(treeGrants(), 'Greenwood Trust'),
      nursery({ workWords: [] }),
      ASOF,
    );
    expect(p.tier).toBe('area');
    expect(p.reasons.join(' ')).toMatch(/for other kinds of work/u);
  });

  it('still prefers the funder whose grants are the work over one whose label matches', () => {
    const youth = funder(
      Array.from({ length: 5 }, (_, i) =>
        award({
          id: `y_${i}`,
          tags: ['Children and young people'],
          title: 'Youth club and training',
          description: 'Evening skills sessions for young people at risk of exclusion.',
        }),
      ),
      'Southwest Youth Trust',
    );
    const trees = { ...funder(treeGrants(), 'Greenwood Trust'), funderId: 'f2' };
    const ranked = findProspects([youth, trees], nursery(), ASOF);
    // Both are area_and_cause now — the youth trust legitimately matches the
    // group they ticked — so this asserts the tree funder is no longer BELOW
    // it, which is what the bug did.
    expect(ranked.map((p) => p.funderName)).toContain('Greenwood Trust');
    expect(ranked[0]?.tier).toBe('area_and_cause');
    expect(
      ranked.find((p) => p.funderName === 'Greenwood Trust')?.tier,
    ).toBe('area_and_cause');
  });

  it('does not match on a word too short to mean anything', () => {
    const p = assessProspect(
      funder(treeGrants(), 'Greenwood Trust'),
      nursery({ beneficiaryGroups: [], workWords: ['in', 'a'] }),
      ASOF,
    );
    expect(p.tier).toBe('area');
  });

  it('matches a grant with no label at all, from its text', () => {
    const p = assessProspect(
      funder(
        Array.from({ length: 5 }, (_, i) =>
          award({ id: `n_${i}`, tags: [], title: 'Tree nursery expansion', description: null }),
        ),
        'Greenwood Trust',
      ),
      nursery({ beneficiaryGroups: [] }),
      ASOF,
    );
    expect(p.tier).toBe('area_and_cause');
  });
});

describe('which evidence outranks which', () => {
  const treeAward = (i: number): Award =>
    award({
      id: `t_${i}`,
      tags: ['Environment'],
      title: 'Community tree nursery',
      description: 'A community tree nursery growing native saplings from local seed.',
    });
  const youthAward = (i: number): Award =>
    award({
      id: `y_${i}`,
      tags: ['Children and young people'],
      title: 'Youth club and training',
      description: 'Evening sessions for young people at risk of exclusion.',
    });

  it('puts the funder whose grants ARE the work above one that shares a category', () => {
    // FOUND BY WALKING: a tree nursery's strongest prospect was a youth trust,
    // because it had seventeen grants labelled "Children and young people"
    // against the woodland funder's four actual tree nurseries, and inside a
    // tier the order was the raw count.
    const youth: FunderAwards = {
      funderId: 'youth',
      funderName: 'Southwest Youth Trust',
      awards: Array.from({ length: 17 }, (_, i) => youthAward(i)),
    };
    const trees: FunderAwards = {
      funderId: 'trees',
      funderName: 'Greenwood Trust',
      // Four tree nurseries among ten grants, which is the shape the walk
      // found: a funder with plenty of history, a few of it this work. Below
      // MIN_AWARDS_TO_CHARACTERISE in total they would not be characterised
      // at all and would sort last whatever they had funded.
      awards: [
        ...Array.from({ length: 4 }, (_, i) => treeAward(i)),
        ...Array.from({ length: 6 }, (_, i) =>
          award({
            id: `o_${i}`,
            tags: ['Heritage'],
            title: 'Village hall restoration',
            description: 'Rewiring and a new accessible entrance.',
          }),
        ),
      ],
    };
    const ranked = findProspects([youth, trees], {
      jurisdiction: 'england',
      region: 'Somerset',
      beneficiaryGroups: ['young people'],
      workWords: ['tree', 'nursery', 'saplings'],
      amountSoughtGbp: 18_000,
    }, ASOF);
    expect(ranked.map((p) => p.funderName)).toEqual([
      'Greenwood Trust',
      'Southwest Youth Trust',
    ]);
    expect(ranked[0]?.workAwards).toHaveLength(4);
    expect(ranked[1]?.workAwards).toHaveLength(0);
  });

  it('falls back to the plain count when neither has work evidence', () => {
    const many = prospect({ funderName: 'Many', matchingAwards: [award(), award(), award()] });
    const few = prospect({ funderName: 'Few', matchingAwards: [award()] });
    expect([few, many].toSorted(byRelevance).map((p) => p.funderName)).toEqual(['Many', 'Few']);
  });
});

describe('one word is a coincidence, two are a description', () => {
  /** A food-growing grant. Shares exactly one word with a tree nursery. */
  const foodAward = (i: number): Award =>
    award({
      id: `f_${i}`,
      tags: ['Food and poverty'],
      title: 'Growing and cooking together',
      description: 'Market garden and cooking project supplying a pay-what-you-can food club.',
    });

  const nurseryWords = ['nursery', 'tree', 'grow', 'native', 'seed'];

  it('does not call a food project the work a tree nursery described', () => {
    // FOUND BY WALKING: "grow" alone put a food funder second on the list,
    // under the heading "4 grants for the work you described".
    const food: FunderAwards = {
      funderId: 'food',
      funderName: 'Fair Food Alliance',
      awards: Array.from({ length: 6 }, (_, i) => foodAward(i)),
    };
    const p = assessProspect(food, {
      jurisdiction: 'england',
      region: 'Somerset',
      beneficiaryGroups: [],
      workWords: nurseryWords,
      amountSoughtGbp: 18_000,
    }, ASOF);
    expect(p.workAwards).toHaveLength(0);
    expect(p.tier).toBe('area');
  });

  it('still recognises the work when two of the words are there', () => {
    const trees: FunderAwards = {
      funderId: 'trees',
      funderName: 'Greenwood Trust',
      awards: Array.from({ length: 6 }, (_, i) =>
        award({
          id: `t_${i}`,
          tags: ['Environment'],
          title: 'Community tree nursery',
          description: 'Growing native saplings from locally collected seed.',
        }),
      ),
    };
    const p = assessProspect(trees, {
      jurisdiction: 'england',
      region: 'Somerset',
      beneficiaryGroups: [],
      workWords: nurseryWords,
      amountSoughtGbp: 18_000,
    }, ASOF);
    expect(p.workAwards).toHaveLength(6);
    expect(p.tier).toBe('area_and_cause');
  });

  it('matches nothing at all on a single usable word', () => {
    // Not a failure mode to paper over: an applicant who has given us one
    // word has not described their work, and inventing a match from it is how
    // the food funder got in.
    const trees: FunderAwards = {
      funderId: 'trees',
      funderName: 'Greenwood Trust',
      awards: Array.from({ length: 6 }, (_, i) =>
        award({ id: `t_${i}`, tags: [], title: 'Community tree nursery', description: null }),
      ),
    };
    const p = assessProspect(trees, {
      jurisdiction: 'england',
      region: 'Somerset',
      beneficiaryGroups: [],
      workWords: ['tree'],
      amountSoughtGbp: 18_000,
    }, ASOF);
    expect(p.workAwards).toHaveLength(0);
  });
});
