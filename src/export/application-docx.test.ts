/**
 * The Word file is a real Word file.
 *
 * Read back with `mammoth` — the same reader the product uses for uploaded
 * documents — rather than by poking at the XML: if the reader that accepts a
 * charity's own .docx can read this one, so can their word processor.
 */

import mammoth from 'mammoth';
import { describe, expect, it } from 'vitest';

import { applicationDocument } from '../domain/export/application.js';
import { checkZip } from '../documents/zip-guard.js';
import { renderApplicationDocx } from './application-docx.js';

const doc = applicationDocument({
  organisationName: 'Future Forests CIC',
  fundTitle: 'Tree Planting Fund',
  funderName: 'Greenwood Trust',
  deadline: '2027-01-31',
  amountRequestedGbp: 15000,
  asOf: '2026-09-24',
  questions: [
    {
      position: 1,
      question: 'Tell us about your organisation.',
      wordLimit: 150,
      answer: 'We grow native trees from local seed.\n\nWe work with young people in Somerset.',
      wordCount: 15,
    },
    { position: 2, question: 'Who will benefit?', wordLimit: null, answer: null, wordCount: 0 },
  ],
});

describe('renderApplicationDocx', () => {
  it('writes a document Word readers open, with everything in order', async () => {
    const bytes = await renderApplicationDocx(doc);
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    const at = (text: string) => value.indexOf(text);

    for (const text of [
      'Tree Planting Fund',
      'Greenwood Trust',
      'Prepared by Future Forests CIC',
      'Deadline 31 January 2027',
      '1. Tell us about your organisation.',
      'Up to 150 words',
      'We grow native trees from local seed.',
      'We work with young people in Somerset.',
      '15 of 150 words',
      '2. Who will benefit?',
      'Not yet answered.',
    ]) {
      expect(at(text), text).toBeGreaterThanOrEqual(0);
    }
    expect(at('1. Tell us')).toBeLessThan(at('2. Who will benefit?'));
    expect(at('We grow native trees')).toBeLessThan(at('We work with young people'));
  });

  it('passes the product’s own upload guard, so it could be uploaded back', async () => {
    const bytes = await renderApplicationDocx(doc);
    expect(() => checkZip(new Uint8Array(bytes))).not.toThrow();
  });
});
