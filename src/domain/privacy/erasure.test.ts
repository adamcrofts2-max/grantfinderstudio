import { describe, expect, it } from 'vitest';

import {
  confirmationPrompt,
  confirmationWord,
  confirms,
  FALLBACK_WORD,
  willRemove,
} from './erasure.js';

describe('confirmationWord', () => {
  it('asks for the organisation’s own name', () => {
    expect(confirmationWord('Future Forests CIC')).toBe('Future Forests CIC');
  });

  it('falls back when there is no name to type', () => {
    expect(confirmationWord(null)).toBe(FALLBACK_WORD);
    expect(confirmationWord('   ')).toBe(FALLBACK_WORD);
  });
});

describe('confirms', () => {
  it('forgives case and surrounding space', () => {
    expect(confirms('  future forests cic ', 'Future Forests CIC')).toBe(true);
  });

  it('does not forgive a different organisation', () => {
    // The person with two accounts open in two tabs is who this is for.
    expect(confirms('Future Forest', 'Future Forests CIC')).toBe(false);
    expect(confirms('Future Forests CIC Ltd', 'Future Forests CIC')).toBe(false);
  });

  it('refuses an empty box', () => {
    expect(confirms('', 'Future Forests CIC')).toBe(false);
    expect(confirms('   ', null)).toBe(false);
  });

  it('takes the fallback word when there is no name', () => {
    expect(confirms('delete', null)).toBe(true);
    expect(confirms('Future Forests CIC', null)).toBe(false);
  });
});

describe('confirmationPrompt', () => {
  it('names what it wants rather than leaving them to guess', () => {
    expect(confirmationPrompt('Future Forests CIC')).toContain('Future Forests CIC');
    expect(confirmationPrompt(null)).toContain(FALLBACK_WORD);
  });
});

describe('willRemove', () => {
  it('counts what is actually there', () => {
    const line = willRemove([
      { label: 'applications', rows: 3 },
      { label: 'answers', rows: 41 },
      { label: 'documents', rows: 2 },
    ]);
    expect(line).toBe('This removes 3 applications, 41 answers and 2 documents. It cannot be undone.');
  });

  it('reads properly for a single one of something', () => {
    expect(willRemove([{ label: 'applications', rows: 1 }])).toContain('1 application.');
    // A phrase pluralises on its head word, not its last one.
    expect(willRemove([{ label: 'pieces of evidence', rows: 1 }])).toContain(
      '1 piece of evidence',
    );
    expect(willRemove([{ label: 'earlier drafts', rows: 1 }])).toContain('1 earlier draft.');
  });

  it('says so when there is nothing in it yet', () => {
    const line = willRemove([]);
    expect(line).toContain('nothing in this organisation yet');
    expect(line).not.toContain('undone');
  });
});
