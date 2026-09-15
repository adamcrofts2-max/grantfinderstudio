/**
 * One word counter, because a funder's limit is a hard edge.
 */
import { describe, expect, it } from 'vitest';

import { MAX_ANSWER_LENGTH, countWords } from './words.js';

describe('counting words', () => {
  it('counts nothing as nothing', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
  });

  it('counts whitespace-separated words, as a portal does', () => {
    expect(countWords('We work with young people in Somerset')).toBe(7);
  });

  it('is not fooled by a line break, which is why it is shared', () => {
    // The count under the text box and the count the Writer checks its draft
    // against have to be the same number. Two implementations would have
    // differed here first — on every real answer, because real answers have
    // paragraphs in them.
    expect(countWords('one two\nthree\n\nfour')).toBe(4);
    expect(countWords('one  two   three')).toBe(3);
  });

  it('counts a hyphenated word once, as a person would', () => {
    expect(countWords('a well-attended after-school club')).toBe(4);
  });

  it('bounds an answer without pretending to judge its length', () => {
    // A paste of a whole document into one box should fail with a sentence
    // rather than fill a column. 20,000 characters is several times the
    // longest limit anybody has put in front of this.
    expect(MAX_ANSWER_LENGTH).toBeGreaterThan(6000);
  });
});
