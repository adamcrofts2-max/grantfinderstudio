import { describe, expect, it } from 'vitest';

import {
  criteriaLikeMine,
  isNarrowed,
  NO_CRITERIA,
  whySimilar,
} from './search.js';

const applicant = {
  region: 'Somerset',
  beneficiaryGroups: ['young people'],
  amountSoughtGbp: 30_000,
};

describe('the search somebody lands on', () => {
  it('is built from what they have already told us', () => {
    expect(criteriaLikeMine(applicant)).toEqual({
      text: '',
      region: 'Somerset',
      tag: 'young people',
      minAmountGbp: 15_000,
      maxAmountGbp: 60_000,
    });
  });

  it('filters on nothing rather than guessing, when they have said nothing', () => {
    // An applicant with no project yet gets every grant. Honest, where a band
    // built around a number they never gave would be a fabrication.
    expect(
      criteriaLikeMine({ region: null, beneficiaryGroups: [], amountSoughtGbp: null }),
    ).toEqual(NO_CRITERIA);
  });

  it('bands an ask from half to double it', () => {
    // Narrower and a £30k ask hides the £18k and £55k grants that say most
    // about whether a funder could stretch.
    const c = criteriaLikeMine({ ...applicant, amountSoughtGbp: 10_000 });
    expect(c.minAmountGbp).toBe(5_000);
    expect(c.maxAmountGbp).toBe(20_000);
  });

  it('knows when nothing is being filtered', () => {
    expect(isNarrowed(NO_CRITERIA)).toBe(false);
    expect(isNarrowed({ ...NO_CRITERIA, text: '  ' })).toBe(false);
    expect(isNarrowed({ ...NO_CRITERIA, region: 'Devon' })).toBe(true);
    expect(isNarrowed({ ...NO_CRITERIA, minAmountGbp: 0 })).toBe(true);
  });
});

describe('why a grant resembles you', () => {
  const award = { amountGbp: 24_000, region: 'Somerset', tags: ['Young people at risk'] };

  it('names the area, the cause and the size when each holds', () => {
    expect(whySimilar(award, applicant)).toEqual([
      'Awarded in Somerset, where you are.',
      'Classified as Young people at risk — what you do.',
      'Around the size you are asking for.',
    ]);
  });

  it('says nothing it cannot point at', () => {
    // No overlap must produce no reasons at all, rather than a hedge. A line
    // an applicant cannot check is worse than no line.
    expect(whySimilar({ amountGbp: 500_000, region: 'Gwynedd', tags: ['Heritage'] }, applicant))
      .toEqual([]);
  });

  it('claims no size match when they have not said what they need', () => {
    const reasons = whySimilar(award, { ...applicant, amountSoughtGbp: null });
    expect(reasons).not.toContain('Around the size you are asking for.');
  });

  it('matches a region case-insensitively and within a longer label', () => {
    expect(whySimilar({ ...award, region: 'SOMERSET, MENDIP' }, applicant)[0]).toContain(
      'where you are',
    );
  });

  it('does not treat an empty beneficiary group as matching everything', () => {
    // '' is a substring of every tag, so an unguarded includes() would report
    // every grant as being what they do.
    expect(
      whySimilar(award, { ...applicant, beneficiaryGroups: [''] }).join(' '),
    ).not.toContain('what you do');
  });
});
