/**
 * An application as a document somebody can take away.
 *
 * ## Why
 *
 * After "copy the answer", the thing a bid writer asks for most is a file: to
 * send a trustee for a read-through, to attach for a funder that takes email
 * applications, to keep. The application page could only put plain text on
 * the clipboard.
 *
 * ## What goes in, and what does not
 *
 * The questions in order, each with its answer as written, the funder's word
 * limit and where the answer stands against it. What the Writer's labels say
 * about each sentence does NOT go in: a document leaves the product, and
 * "No confirmed fact behind this" printed into a file bound for a trustee or a
 * funder would be read as part of the answer. The application page keeps that
 * picture; the file is the answer itself.
 *
 * Pure: the shape of the document, decided here and tested without a
 * renderer. `src/export/application-docx.ts` turns it into Word.
 */

import { formatDate } from '../time/format.js';

export interface ExportQuestion {
  position: number;
  question: string;
  wordLimit: number | null;
  answer: string | null;
  wordCount: number;
}

export interface ExportInput {
  organisationName: string | null;
  fundTitle: string | null;
  funderName: string | null;
  deadline: string | null;
  amountRequestedGbp: number | null;
  /** ISO date the file was made. Injected, so the output is deterministic. */
  asOf: string;
  questions: readonly ExportQuestion[];
}

export interface ExportSection {
  heading: string;
  /** "Up to 150 words", or null when the funder set no limit. */
  limit: string | null;
  /** The answer, split into its paragraphs. Empty when unanswered. */
  paragraphs: string[];
  /** "142 of 150 words", "142 words — 12 over the limit", or "Not yet answered". */
  standing: string;
  overLimit: boolean;
}

export interface ExportDocument {
  title: string;
  /** Lines under the title: funder, organisation, deadline, amount, date. */
  details: string[];
  sections: ExportSection[];
  closing: string;
  filename: string;
}

const pounds = (n: number): string => `£${Math.round(n).toLocaleString('en-GB')}`;

/** Paragraphs as the person wrote them: blank lines separate, single newlines join. */
function paragraphsOf(answer: string): string[] {
  return answer
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/gu, ' ').trim())
    .filter((paragraph) => paragraph !== '');
}

function standingOf(question: ExportQuestion): { text: string; over: boolean } {
  if (question.answer === null || question.answer.trim() === '') {
    return { text: 'Not yet answered', over: false };
  }
  const words = `${question.wordCount} word${question.wordCount === 1 ? '' : 's'}`;
  if (question.wordLimit === null) return { text: words, over: false };
  if (question.wordCount > question.wordLimit) {
    return {
      text: `${words} — ${question.wordCount - question.wordLimit} over the limit of ${question.wordLimit}`,
      over: true,
    };
  }
  return { text: `${question.wordCount} of ${question.wordLimit} words`, over: false };
}

/**
 * A filename a person would recognise in their downloads folder: the fund,
 * then the date. Letters, digits and hyphens only, so it survives every
 * filesystem and every email client.
 */
export function exportFilename(title: string, asOf: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)
    .replace(/-+$/u, '');
  return `${slug === '' ? 'application' : slug}-${asOf}.docx`;
}

export function applicationDocument(input: ExportInput): ExportDocument {
  const title = input.fundTitle ?? 'Funding application';
  const details = [
    input.funderName === null ? null : input.funderName,
    input.organisationName === null ? null : `Prepared by ${input.organisationName}`,
    input.deadline === null ? null : `Deadline ${formatDate(input.deadline)}`,
    input.amountRequestedGbp === null ? null : `Asking for ${pounds(input.amountRequestedGbp)}`,
    `As it stood on ${formatDate(input.asOf)}`,
  ].filter((line): line is string => line !== null);

  const sections = [...input.questions]
    .toSorted((a, b) => a.position - b.position)
    .map((question) => {
      const standing = standingOf(question);
      return {
        heading: `${question.position}. ${question.question.trim()}`,
        limit: question.wordLimit === null ? null : `Up to ${question.wordLimit} words`,
        paragraphs: question.answer === null ? [] : paragraphsOf(question.answer),
        standing: standing.text,
        overLimit: standing.over,
      };
    });

  return {
    title,
    details,
    sections,
    closing:
      'Check every claim against your own records and the funder’s current guidance before you submit.',
    filename: exportFilename(title, input.asOf),
  };
}
