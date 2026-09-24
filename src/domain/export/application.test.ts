import { describe, expect, it } from 'vitest';

import { applicationDocument, exportFilename } from './application.js';

const input = {
  organisationName: 'Future Forests CIC',
  fundTitle: 'Tree Planting Fund',
  funderName: 'Greenwood Trust',
  deadline: '2027-01-31',
  amountRequestedGbp: 15000,
  asOf: '2026-09-24',
  questions: [
    { position: 2, question: 'Who will benefit?', wordLimit: 100, answer: null, wordCount: 0 },
    {
      position: 1,
      question: '  Tell us about your organisation. ',
      wordLimit: 5,
      answer: 'We grow trees.\nFrom local seed.\n\nFor young people.',
      wordCount: 9,
    },
  ],
};

describe('applicationDocument', () => {
  const doc = applicationDocument(input);

  it('puts the questions in the funder’s order, whatever order they arrive in', () => {
    expect(doc.sections.map((s) => s.heading)).toEqual([
      '1. Tell us about your organisation.',
      '2. Who will benefit?',
    ]);
  });

  it('keeps the answer’s paragraphs, joining lines within one', () => {
    expect(doc.sections[0]?.paragraphs).toEqual(['We grow trees. From local seed.', 'For young people.']);
  });

  it('says where each answer stands against the limit', () => {
    expect(doc.sections[0]?.standing).toBe('9 words — 4 over the limit of 5');
    expect(doc.sections[0]?.overLimit).toBe(true);
    expect(doc.sections[1]?.standing).toBe('Not yet answered');
    expect(doc.sections[1]?.paragraphs).toEqual([]);
  });

  it('carries the details a reader needs, dates as a person writes them', () => {
    expect(doc.details).toEqual([
      'Greenwood Trust',
      'Prepared by Future Forests CIC',
      'Deadline 31 January 2027',
      'Asking for £15,000',
      'As it stood on 24 September 2026',
    ]);
  });

  it('leaves out what the product knows about each sentence', () => {
    // A file bound for a trustee or a funder must be the answer itself.
    const text = JSON.stringify(doc);
    expect(text).not.toMatch(/confirmed|No fact behind/iu);
  });

  it('names an application with no fund plainly', () => {
    const bare = applicationDocument({ ...input, fundTitle: null, funderName: null });
    expect(bare.title).toBe('Funding application');
    expect(bare.filename).toBe('funding-application-2026-09-24.docx');
  });
});

describe('exportFilename', () => {
  it('is safe on every filesystem and recognisable in a downloads folder', () => {
    expect(exportFilename('Tree Planting Fund', '2026-09-24')).toBe('tree-planting-fund-2026-09-24.docx');
    expect(exportFilename('Café & Community: "Roots"/2027', '2026-09-24')).toBe(
      'cafe-community-roots-2027-2026-09-24.docx',
    );
    expect(exportFilename('***', '2026-09-24')).toBe('application-2026-09-24.docx');
    expect(exportFilename('x'.repeat(200), '2026-09-24').length).toBeLessThan(80);
  });
});
