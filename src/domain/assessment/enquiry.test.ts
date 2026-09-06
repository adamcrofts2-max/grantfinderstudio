import { describe, expect, it } from 'vitest';
import { draftFunderEnquiry, NoQuestionsError, type EnquiryInput } from './enquiry.js';

function input(overrides: Partial<EnquiryInput> = {}): EnquiryInput {
  return {
    organisationName: 'Alpha CIC',
    senderName: 'Ann Example',
    funderName: 'The Fictional Trust',
    opportunityTitle: 'Fictional Youth Fund',
    projectSummary: 'a 12-month environmental skills programme for young people in Somerset',
    questions: [
      {
        label: 'Legal form',
        reason: 'The funder does not say whether it accepts CICs.',
        action: 'Ask the funder.',
      },
    ],
    ...overrides,
  };
}

describe('draftFunderEnquiry', () => {
  it('produces a subject naming the opportunity', () => {
    expect(draftFunderEnquiry(input()).subject).toBe(
      'Eligibility question — Fictional Youth Fund',
    );
  });

  it('addresses the funder and identifies the CIC', () => {
    const body = draftFunderEnquiry(input()).body;
    expect(body).toContain('Dear The Fictional Trust,');
    expect(body).toContain('Alpha CIC');
    expect(body).toContain('Community Interest Company');
  });

  it('includes the project summary when there is one', () => {
    expect(draftFunderEnquiry(input()).body).toContain('environmental skills programme');
  });

  it('does not double the full stop when the summary already ends in one', () => {
    const body = draftFunderEnquiry(
      input({ projectSummary: 'a programme for young people in Somerset.' }),
    ).body;
    expect(body).toContain('young people in Somerset.');
    expect(body).not.toContain('Somerset..');
  });

  it('handles a summary ending in other punctuation', () => {
    const body = draftFunderEnquiry(input({ projectSummary: 'what next?' })).body;
    expect(body).toContain('what next.');
    expect(body).not.toContain('what next?.');
  });

  it('omits the project clause when there is no summary, rather than inventing one', () => {
    const body = draftFunderEnquiry(input({ projectSummary: null })).body;
    expect(body).toContain('about Fictional Youth Fund');
    expect(body).not.toContain('for the following');
  });

  it('numbers each question with its reason', () => {
    const body = draftFunderEnquiry(
      input({
        questions: [
          { label: 'Legal form', reason: 'Not stated.', action: 'Ask.' },
          { label: 'Match funding', reason: 'Requirement unclear.', action: 'Ask.' },
        ],
      }),
    ).body;
    expect(body).toContain('1. Legal form — Not stated.');
    expect(body).toContain('2. Match funding — Requirement unclear.');
    expect(body).toContain('could I check 2 points');
  });

  it('uses the singular for one question', () => {
    expect(draftFunderEnquiry(input()).body).toContain('could I check one point');
  });

  it('signs off with the sender when known', () => {
    const body = draftFunderEnquiry(input()).body;
    expect(body).toContain('Ann Example');
    expect(body.trimEnd().endsWith('Alpha CIC')).toBe(true);
  });

  it('signs off with the organisation alone when the sender is unknown', () => {
    const body = draftFunderEnquiry(input({ senderName: null })).body;
    expect(body).toContain('Many thanks,\nAlpha CIC');
  });

  it('collapses whitespace so nothing breaks the plain-text layout', () => {
    const body = draftFunderEnquiry(
      input({
        organisationName: 'Alpha\n\nCIC',
        questions: [{ label: 'Legal\tform', reason: 'Not   stated.', action: 'Ask.' }],
      }),
    ).body;
    expect(body).toContain('Alpha CIC');
    expect(body).toContain('1. Legal form — Not stated.');
  });

  it('refuses to draft an email when there is nothing to ask', () => {
    expect(() => draftFunderEnquiry(input({ questions: [] }))).toThrow(NoQuestionsError);
  });

  it('states only what it was given', () => {
    const body = draftFunderEnquiry(
      input({ projectSummary: null, senderName: null, questions: [
        { label: 'Legal form', reason: 'Not stated.', action: 'Ask.' },
      ] }),
    ).body;
    // No track record, no beneficiary numbers, no claims of any kind.
    expect(body).not.toMatch(/\d+\s*(people|beneficiaries|years)/);
  });
});
