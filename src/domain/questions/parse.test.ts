import { describe, expect, it } from 'vitest';
import { findCharacterLimit, findWordLimit, parseQuestions } from './parse.js';

describe('findWordLimit', () => {
  it.each([
    ['(max 250 words)', 250],
    ['(maximum 250 words)', 250],
    ['maximum of 250 words', 250],
    ['up to 250 words', 250],
    ['no more than 250 words', 250],
    ['250 words maximum', 250],
    ['250 words max', 250],
    ['250 words or fewer', 250],
    ['Word limit: 250', 250],
    ['Word count - 250', 250],
    ['(250 words)', 250],
  ])('reads %s', (text, expected) => {
    expect(findWordLimit(text)).toBe(expected);
  });

  it('finds a limit inside a full sentence', () => {
    expect(
      findWordLimit('Tell us about your organisation and the work you do. (Maximum 200 words)'),
    ).toBe(200);
  });

  it('returns null when none is stated', () => {
    expect(findWordLimit('Tell us about your organisation.')).toBeNull();
  });

  it('ignores implausible numbers that are something else', () => {
    expect(findWordLimit('Reference 99999 words')).toBeNull();
    expect(findWordLimit('up to 5 words')).toBeNull();
  });

  it('does not mistake a character limit for a word limit', () => {
    expect(findWordLimit('Maximum 2000 characters')).toBeNull();
  });
});

describe('findCharacterLimit', () => {
  it('reads a character limit', () => {
    expect(findCharacterLimit('Maximum 2000 characters')).toBe(2000);
    expect(findCharacterLimit('2000 chars max')).toBe(2000);
  });

  it('returns null when there is none', () => {
    expect(findCharacterLimit('250 words')).toBeNull();
  });
});

describe('parseQuestions — numbered lists', () => {
  it('splits a numbered list and captures each limit', () => {
    const parsed = parseQuestions(`
1. Tell us about your organisation and the work you do. (Max 200 words)
2. What need does your project address? (250 words maximum)
3. What will you do with the funding? Word limit: 300
    `);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({
      position: 1,
      question: 'Tell us about your organisation and the work you do.',
      wordLimit: 200,
    });
    expect(parsed[1]?.wordLimit).toBe(250);
    expect(parsed[2]?.wordLimit).toBe(300);
  });

  it.each([
    ['1)', '1) What do you do? (100 words)'],
    ['Q1', 'Q1 What do you do? (100 words)'],
    ['Question 1', 'Question 1. What do you do? (100 words)'],
    ['1 -', '1 - What do you do? (100 words)'],
  ])('handles %s numbering', (_label, first) => {
    const parsed = parseQuestions(`${first}\n2. And what else? (100 words)`);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.question).toBe('What do you do?');
  });

  it('strips the limit annotation out of the question text', () => {
    const parsed = parseQuestions('1. Describe your project. (Max 200 words)\n2. And? (50 words)');
    expect(parsed[0]?.question).toBe('Describe your project.');
    expect(parsed[0]?.question).not.toContain('200');
  });

  it('keeps guidance lines beneath a question', () => {
    const parsed = parseQuestions(`
1. Tell us about your organisation. (200 words)
Please include your history, structure and current activities.
2. What need does the project address? (250 words)
    `);
    expect(parsed[0]?.guidance).toContain('history, structure and current activities');
  });
});

describe('parseQuestions — other shapes', () => {
  it('splits blocks separated by blank lines when nothing is numbered', () => {
    const parsed = parseQuestions(`
Tell us about your organisation. (200 words)

What need does your project address? (250 words)
    `);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]?.wordLimit).toBe(250);
  });

  it('treats a single unnumbered paste as one question', () => {
    const parsed = parseQuestions('Describe the difference your project will make. (Max 300 words)');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      question: 'Describe the difference your project will make.',
      wordLimit: 300,
    });
  });

  it('finds the question when a portal puts a header line first', () => {
    const parsed = parseQuestions(`
Question 2 of 8
What need does your project address, and how do you know?
Word limit: 250
    `);
    expect(parsed[0]?.question).toBe('What need does your project address, and how do you know?');
    expect(parsed[0]?.wordLimit).toBe(250);
  });

  it('records a character limit as guidance rather than inventing a word limit', () => {
    const parsed = parseQuestions('Describe your project. Maximum 2000 characters.');
    expect(parsed[0]?.wordLimit).toBeNull();
    expect(parsed[0]?.guidance).toContain('2000 characters');
  });

  it('numbers positions consecutively even when a block is discarded', () => {
    const parsed = parseQuestions('1. Tell us about your work?\n2. \n3. And what else?');
    expect(parsed.map((q) => q.position)).toEqual([1, 2]);
  });

  it('returns nothing for empty input', () => {
    expect(parseQuestions('')).toEqual([]);
    expect(parseQuestions('   \n  \n ')).toEqual([]);
  });

  it('handles Windows line endings', () => {
    const parsed = parseQuestions('1. What do you do? (100 words)\r\n2. And why? (100 words)');
    expect(parsed).toHaveLength(2);
  });

  it('never returns a question with no text', () => {
    for (const q of parseQuestions('1. Describe it.\n2. (250 words)\n3. Why?')) {
      expect(q.question.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('a realistic portal paste', () => {
  it('parses what someone would actually copy out of a funder form', () => {
    const parsed = parseQuestions(`
Section 2: About your organisation

1. Tell us about your organisation and the work you do.
Include when you were set up, who you work with and where you operate.
(Maximum 200 words)

2. What need does your project address, and how do you know it exists?
Please refer to evidence such as local statistics or your own delivery data.
Word limit: 250

3. How many people will you support?
250 words max
    `);

    expect(parsed).toHaveLength(3);
    expect(parsed.map((q) => q.wordLimit)).toEqual([200, 250, 250]);
    expect(parsed[0]?.question).toBe('Tell us about your organisation and the work you do.');
    expect(parsed[1]?.guidance).toContain('local statistics');
    // The section header must not become a question.
    for (const q of parsed) expect(q.question).not.toContain('Section 2');
  });
});
