/**
 * Draft an enquiry to a funder about unresolved eligibility.
 *
 * When eligibility is genuinely unknown, the useful output is not a confidence
 * score — it is a short email that turns the unknown into an answer. Funders
 * answer these routinely, and CICs rarely think to ask.
 *
 * This is a deterministic template, not a generated one. It composes only
 * values it was given, so it cannot invent a project detail, a track record,
 * or a claim about the organisation. Nothing here needs a language model, and
 * using one would add a failure mode for no benefit.
 */

import type { OpenQuestion } from './assess.js';

export interface EnquiryInput {
  organisationName: string;
  /** Sender's name. Null when unknown — the sign-off adapts. */
  senderName: string | null;
  funderName: string;
  opportunityTitle: string;
  /** One sentence in the CIC's own words. Null when we do not have one. */
  projectSummary: string | null;
  questions: readonly OpenQuestion[];
}

export interface Enquiry {
  subject: string;
  body: string;
}

export class NoQuestionsError extends Error {
  constructor() {
    super('There is nothing to ask this funder about.');
    this.name = 'NoQuestionsError';
  }
}

/** Strip anything that would break out of a plain-text email line. */
function oneLine(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim();
}

/**
 * Drop trailing sentence punctuation so the template can add its own without
 * producing "Somerset..".
 */
function withoutTrailingStop(text: string): string {
  return text.replace(/[.!?]+$/u, '');
}

export function draftFunderEnquiry(input: EnquiryInput): Enquiry {
  if (input.questions.length === 0) throw new NoQuestionsError();

  const subject = `Eligibility question — ${oneLine(input.opportunityTitle)}`;

  const opening =
    input.projectSummary === null
      ? `I am writing from ${oneLine(input.organisationName)}, a Community Interest Company, about ${oneLine(input.opportunityTitle)}.`
      : `I am writing from ${oneLine(input.organisationName)}, a Community Interest Company. We are considering applying to ${oneLine(input.opportunityTitle)} for the following: ${withoutTrailingStop(oneLine(input.projectSummary))}.`;

  const preamble =
    input.questions.length === 1
      ? 'Before we invest time in an application, could I check one point:'
      : `Before we invest time in an application, could I check ${input.questions.length} points:`;

  const bullets = input.questions
    .map((q, index) => `${index + 1}. ${oneLine(q.label)} — ${oneLine(q.reason)}`)
    .join('\n');

  const closing =
    'If it would be easier to answer by phone, I am happy to call at a convenient time.';

  const signOff =
    input.senderName === null
      ? `Many thanks,\n${oneLine(input.organisationName)}`
      : `Many thanks,\n${oneLine(input.senderName)}\n${oneLine(input.organisationName)}`;

  const body = [
    `Dear ${oneLine(input.funderName)},`,
    '',
    opening,
    '',
    preamble,
    '',
    bullets,
    '',
    closing,
    '',
    signOff,
  ].join('\n');

  return { subject, body };
}
