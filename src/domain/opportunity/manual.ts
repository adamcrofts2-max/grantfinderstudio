/**
 * A fund entered by hand.
 *
 * The product's normal path reads a funder's guidance with a model, which
 * needs an API key. Plenty of deployments will not have one, and plenty of
 * people would rather type six fields than paste four pages — so this is the
 * path that always works, and it is the same shape for a CIC adding a fund to
 * their own list and for an operator adding one to the shared catalogue.
 *
 * What it deliberately does NOT produce is eligibility criteria. The engine
 * evaluates rules; typing "we fund charities in the South West" into a box
 * does not make a rule, and inventing one from it would be the product
 * guessing on a person's behalf about the thing it exists to be certain
 * about. A hand-entered fund is therefore honest about being unassessed: it
 * carries a deadline, a size and a link, and its eligibility reads `unknown`,
 * which is a first-class answer here rather than a gap.
 *
 * Pure and zero I/O, like the rest of the domain.
 */

import { JURISDICTIONS, type Jurisdiction } from '../types.js';

export const DEADLINE_KINDS = [
  'confirmed',
  'rolling',
  'expected',
  'estimated',
  'unknown',
] as const;

export type DeadlineKind = (typeof DEADLINE_KINDS)[number];

export interface ManualFundInput {
  funderName: string;
  title: string;
  summary: string;
  sourceUrl: string;
  jurisdiction: string;
  minAmountGbp: string;
  maxAmountGbp: string;
  deadline: string;
  deadlineKind: string;
}

export interface ManualFund {
  funderName: string;
  title: string;
  summary: string | null;
  sourceUrl: string | null;
  jurisdiction: Jurisdiction | null;
  minAmountGbp: number | null;
  maxAmountGbp: number | null;
  deadline: string | null;
  deadlineKind: DeadlineKind;
}

/** Strip the pound sign, thousands separators and stray spaces people type. */
function readAmount(raw: string): number | null | 'bad' {
  const cleaned = raw.replace(/[£,\s]/gu, '');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return 'bad';
  return Math.round(value);
}

export interface ManualFundResult {
  fund: ManualFund | null;
  errors: Record<string, string>;
}

/**
 * Read and check what was typed.
 *
 * Every problem at once, keyed by field, so the form can put each message
 * beside the box that caused it rather than making somebody resubmit to find
 * the next one.
 */
export function readManualFund(input: ManualFundInput): ManualFundResult {
  const errors: Record<string, string> = {};

  const funderName = input.funderName.trim();
  if (funderName === '') {
    errors['funderName'] = 'Who is offering the money? The trust, foundation or council.';
  }

  const title = input.title.trim();
  if (title === '') {
    errors['title'] = 'What is the fund called? Use the funder’s own name for it.';
  }

  const url = input.sourceUrl.trim();
  if (url !== '' && !/^https?:\/\/\S+\.\S+/u.test(url)) {
    errors['sourceUrl'] = 'That is not a web address. It should start with https://';
  }

  const min = readAmount(input.minAmountGbp);
  if (min === 'bad') errors['minAmountGbp'] = 'Use a number, like 5000.';
  const max = readAmount(input.maxAmountGbp);
  if (max === 'bad') errors['maxAmountGbp'] = 'Use a number, like 25000.';
  if (
    min !== 'bad' &&
    max !== 'bad' &&
    min !== null &&
    max !== null &&
    min > max
  ) {
    errors['maxAmountGbp'] = 'The largest grant cannot be smaller than the smallest.';
  }

  const kindRaw = input.deadlineKind.trim();
  const deadlineKind: DeadlineKind = (DEADLINE_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as DeadlineKind)
    : 'unknown';

  const deadline = input.deadline.trim();
  if (deadline !== '' && !/^\d{4}-\d{2}-\d{2}$/u.test(deadline)) {
    errors['deadline'] = 'Use the date picker.';
  }
  // The schema refuses a confirmed deadline with no date, and it is right to:
  // "confirmed" is the strongest thing this product says about a date, and it
  // must mean somebody saw one.
  if (deadlineKind === 'confirmed' && deadline === '') {
    errors['deadline'] = 'A confirmed deadline needs the date. Choose “not sure” if you do not have it.';
  }

  const jurisdictionRaw = input.jurisdiction.trim();
  const jurisdiction: Jurisdiction | null =
    jurisdictionRaw === '' ? null
    : (JURISDICTIONS as readonly string[]).includes(jurisdictionRaw)
      ? (jurisdictionRaw as Jurisdiction)
      : null;
  if (jurisdictionRaw !== '' && jurisdiction === null) {
    errors['jurisdiction'] = 'Choose one of the listed areas, or leave it blank.';
  }

  if (Object.keys(errors).length > 0) return { fund: null, errors };

  const summary = input.summary.trim();
  return {
    fund: {
      funderName,
      title,
      summary: summary === '' ? null : summary,
      sourceUrl: url === '' ? null : url,
      jurisdiction,
      minAmountGbp: min === 'bad' ? null : min,
      maxAmountGbp: max === 'bad' ? null : max,
      deadline: deadline === '' ? null : deadline,
      deadlineKind,
    },
    errors: {},
  };
}
