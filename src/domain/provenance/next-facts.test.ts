import { describe, expect, it } from 'vitest';

import { FACT_PROMPTS, factShortfall, nextFacts } from './next-facts.js';
import { SUGGESTED_CLAIMS } from './self-declared.js';

describe('what to ask for next', () => {
  it('asks for what an application form asks for first', () => {
    expect(nextFacts([]).map((p) => p.claim)).toEqual([
      'mission',
      'beneficiary_groups',
      'programme_description',
    ]);
  });

  it('never asks for something already held', () => {
    // Being asked again for what is already on the page reads as the product
    // not listening.
    const next = nextFacts(['mission', 'beneficiary_groups']);
    expect(next.map((p) => p.claim)).not.toContain('mission');
    expect(next.map((p) => p.claim)).not.toContain('beneficiary_groups');
  });

  it('says why each one matters, not what the field is', () => {
    for (const prompt of FACT_PROMPTS) {
      expect(prompt.because, prompt.claim).not.toBe('');
      // A reason is about the funder's interest, not the form's structure.
      expect(prompt.because.toLowerCase()).not.toContain('field');
    }
  });

  it('only suggests claims the extractor also uses', () => {
    // A fact typed here and the same fact read out of a document later have to
    // be ONE fact rather than two, which means one vocabulary.
    for (const prompt of FACT_PROMPTS) {
      expect(SUGGESTED_CLAIMS as readonly string[]).toContain(prompt.claim);
    }
  });

  it('keeps suggesting past the curated list rather than running dry', () => {
    const everything = FACT_PROMPTS.map((p) => p.claim);
    const next = nextFacts(everything, 3);
    expect(next).toHaveLength(3);
    expect(next.every((p) => !everything.includes(p.claim))).toBe(true);
  });

  it('runs out only when the whole vocabulary is held', () => {
    expect(nextFacts([...SUGGESTED_CLAIMS])).toEqual([]);
  });
});

describe('how far off the Writer is', () => {
  it('says how many more, and what they unlock', () => {
    const shortfall = factShortfall(4, 5);
    expect(shortfall?.short).toBe(1);
    expect(shortfall?.sentence).toContain('1 more confirmed fact');
    expect(shortfall?.sentence).toContain('Writer');
  });

  it('pluralises', () => {
    expect(factShortfall(2, 5)?.sentence).toContain('3 more confirmed facts');
  });

  it('says nothing once there are enough', () => {
    // A checklist that outstays its usefulness is nagging.
    expect(factShortfall(5, 5)).toBeNull();
    expect(factShortfall(9, 5)).toBeNull();
  });

  it('reads differently from a standing start', () => {
    expect(factShortfall(0, 5)?.sentence).not.toContain('you have 0');
  });
});
