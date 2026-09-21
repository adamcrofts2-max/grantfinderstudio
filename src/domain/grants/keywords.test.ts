import { describe, expect, it } from 'vitest';

import { defaultSearchText, distinctiveWords, workWords } from './keywords.js';

const NURSERY = {
  projectName: 'Community tree nursery',
  projectDescription:
    'We grow native trees from locally collected seed at a volunteer-run nursery near Wells, and give them free to parish planting schemes, schools and farms in Somerset. The grant would pay for two polytunnels, irrigation, tree guards and a part-time nursery coordinator so we can grow 12,000 saplings a year.',
  beneficiaryGroups: ['young people', 'older people'],
  region: 'Somerset',
};

describe('the words somebody used for their work', () => {
  it('puts what they said most first', () => {
    const words = workWords('trees, trees and more trees, plus one hedge', 4);
    expect(words[0]).toBe('trees');
    expect(words).toContain('hedge');
  });

  it('keeps each word once', () => {
    expect(workWords('nursery nursery nursery', 5)).toEqual(['nursery']);
  });

  it('drops grammar, bare numbers and very short words', () => {
    const words = workWords('We will plant 12000 of them in a year', 10);
    expect(words).toEqual(['plant']);
  });

  it('keeps the sector’s own plain words rather than deciding they are filler', () => {
    // "community", "support" and "people" look like padding and are exactly
    // what half this sector does.
    const words = workWords('Community support for people', 5);
    expect(words).toEqual(['community', 'support', 'people']);
  });

  it('keeps a hyphenated word whole', () => {
    expect(workWords('a part-time coordinator', 5)).toEqual(['part-time', 'coordinator']);
  });

  it('is empty for nothing at all', () => {
    expect(workWords(null, 5)).toEqual([]);
    expect(workWords('   ', 5)).toEqual([]);
  });
});

describe('the search somebody lands on', () => {
  it('asks about the work, not about the beneficiary list', () => {
    // THE FAULT: this used to be "young people older people Somerset" for a
    // tree nursery, because those were the only boxes the list offered.
    const text = defaultSearchText(NURSERY);
    expect(text).toMatch(/tree/u);
    expect(text).toMatch(/nursery/u);
    expect(text).not.toMatch(/young people|older people/u);
    expect(text.endsWith('Somerset')).toBe(true);
  });

  it('stays short enough to be a search rather than an essay', () => {
    // Every term carries its own relevance floor and its own cost.
    expect(defaultSearchText(NURSERY).split(' ').length).toBeLessThanOrEqual(6);
  });

  it('leads with the name they chose for it', () => {
    const text = defaultSearchText(NURSERY);
    expect(text.split(' ').slice(0, 3)).toEqual(['community', 'tree', 'nursery']);
  });

  it('falls back to the groups when the project says almost nothing', () => {
    const text = defaultSearchText({
      projectName: 'Our 2026 work',
      projectDescription: null,
      beneficiaryGroups: ['young people', 'carers'],
      region: 'Devon',
    });
    expect(text).toBe('work young people carers Devon');
  });

  it('still works with no project at all', () => {
    expect(
      defaultSearchText({
        projectName: null,
        projectDescription: null,
        beneficiaryGroups: [],
        region: 'Somerset',
      }),
    ).toBe('Somerset');
    expect(
      defaultSearchText({
        projectName: null,
        projectDescription: null,
        beneficiaryGroups: [],
        region: null,
      }),
    ).toBe('');
  });

  it('does not repeat a word the name and the description share', () => {
    const text = defaultSearchText({
      projectName: 'Tree nursery',
      projectDescription: 'A tree nursery growing trees for the tree nursery.',
      beneficiaryGroups: [],
      region: null,
    });
    expect(text.split(' ')).toEqual([...new Set(text.split(' '))]);
  });
});

describe('which of those words narrow anything', () => {
  /**
   * Twenty-four texts, because a share cannot be judged over five: at that
   * size a fifteen-per-cent ceiling is less than one document and every word
   * would be dropped. `ENOUGH_TO_JUDGE` is the floor, and this is just over
   * it — "community" is in 20 of 24, "tree" in 2, "nursery" in 1.
   */
  const corpus = [
    'Establishing a community tree nursery growing native saplings from local seed.',
    'Community orchard restoration with pruning and replacement trees.',
    ...Array.from({ length: 18 }, (_, i) => `Community food hub number ${i}, cooking sessions.`),
    'Village hall restoration including rewiring and insulation.',
    'Rewiring the scout hut and replacing the boiler.',
    'A youth club, three evenings a week, with a detached worker.',
    'Repairs to a grade II listed chapel roof.',
  ];

  it('drops a word that describes most of the corpus', () => {
    // FOUND BY WALKING: on "community tree nursery", a food-poverty funder was
    // promoted to "funded your kind of work" for a tree nursery, because its
    // grants say "community".
    const kept = distinctiveWords(['community', 'tree', 'nursery'], corpus);
    expect(kept).not.toContain('community');
    expect(kept).toEqual(['tree', 'nursery']);
  });

  it('keeps the order it was given', () => {
    expect(distinctiveWords(['nursery', 'saplings', 'tree'], corpus)).toEqual([
      'nursery',
      'saplings',
      'tree',
    ]);
  });

  it('returns nothing when every word is generic, rather than guessing', () => {
    // An applicant who describes themselves only in words the whole corpus
    // uses has told us nothing to match on. The beneficiary groups are still
    // there as the fallback.
    expect(distinctiveWords(['community'], corpus)).toEqual([]);
  });

  it('keeps everything when there is too little corpus to judge against', () => {
    // Nothing to judge with, so nothing is judged — a nearly-empty deployment
    // must not silently lose every match.
    expect(distinctiveWords(['community', 'tree'], [])).toEqual(['community', 'tree']);
    expect(distinctiveWords(['community'], corpus.slice(0, 5))).toEqual(['community']);
  });

  it('respects a different threshold', () => {
    expect(distinctiveWords(['community'], corpus, 0.95)).toEqual(['community']);
  });
});
