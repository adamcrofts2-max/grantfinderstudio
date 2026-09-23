/**
 * Shared workspace state.
 *
 * Separate from `actions.ts` because a `'use server'` module may only export
 * async functions.
 */

import type { ClaimStanding } from '@/domain/provenance/facts';
import type { SentenceLabel } from '@/domain/provenance/sentence-label';

export interface DraftState {
  questionId: string | null;
  ok: boolean;
  message: string;
  /** Sentences with the fact behind each, for the provenance display. */
  claims: Array<{
    text: string;
    factId: string | null;
    standing: ClaimStanding;
    /** What the sentence stands on, in words — see `sentenceLabel`. */
    label: SentenceLabel;
  }>;
  /** What the answer still needs from the applicant. */
  gaps: string[];
  wordCount: number;
}

export const EMPTY_DRAFT: DraftState = {
  questionId: null,
  ok: false,
  message: '',
  claims: [],
  gaps: [],
  wordCount: 0,
};

/**
 * The result of saving an answer the applicant wrote themselves.
 *
 * Separate from `DraftState` because the two are not the same event and must
 * not be able to borrow each other's words. A draft reports provenance — how
 * many sentences traced to a confirmed fact. A saved answer has none to
 * report, and saying nothing about it is the honest outcome, not a gap.
 */
export interface WriteState {
  questionId: string | null;
  ok: boolean;
  message: string;
  wordCount: number;
}

export const EMPTY_WRITE: WriteState = {
  questionId: null,
  ok: false,
  message: '',
  wordCount: 0,
};

export interface AddState {
  ok: boolean;
  message: string;
}

export const EMPTY_ADD: AddState = { ok: false, message: '' };

/**
 * The result of changing the budget or the outcomes.
 *
 * One shape for both, and for adding and removing, because the screen does
 * the same thing with all four: say what happened, in a line, above the list
 * that has just changed.
 */
export interface EditState {
  ok: boolean;
  message: string;
  /** Which field to blame, so a form can point at it rather than shrug. */
  field?: string;
}

export const EMPTY_EDIT: EditState = { ok: false, message: '' };

/** One thing the Critic found wrong, as the workspace renders it. */
export interface ReviewFinding {
  kind: string;
  questionNumber: number | null;
  quote: string | null;
  problem: string;
  suggestion: string;
  severity: 'blocking' | 'worth_fixing' | 'minor';
}

export interface ReviewState {
  ok: boolean | null;
  message: string;
  mode: 'standard' | 'red_team' | null;
  findings: ReviewFinding[];
  mostImportant: string | null;
  strengths: string[];
  /** Text in the application that tried to instruct the reviewer. */
  injected: string[];
  /** Findings dropped because they quoted words the application does not contain. */
  discarded: number;
}

export const EMPTY_REVIEW: ReviewState = {
  ok: null,
  message: '',
  mode: null,
  findings: [],
  mostImportant: null,
  strengths: [],
  injected: [],
  discarded: 0,
};

export const SEVERITY_LABEL = {
  blocking: { label: 'Could sink it', className: 'badge badge-negative', mark: '✕' },
  worth_fixing: { label: 'Worth fixing', className: 'badge badge-caution', mark: '⚠' },
  minor: { label: 'Minor', className: 'badge badge-neutral', mark: '·' },
} as const;

export const FINDING_LABEL: Record<string, string> = {
  does_not_answer_question: 'Does not answer the question',
  contradicts_another_answer: 'Contradicts another answer',
  unverifiable_outcome: 'Nobody could verify this',
  missing_specifics: 'No numbers or scale',
  describes_activity_not_change: 'Describes activity, not change',
  jargon: 'Jargon',
  misses_funder_priority: 'Misses what this funder asks for',
  unevidenced_need: 'Need asserted without evidence',
};

export function findingLabel(kind: string): string {
  return FINDING_LABEL[kind] ?? kind.replace(/_/gu, ' ');
}

/**
 * The result of creating or withdrawing a review share.
 *
 * `link` is the ONE and only time the full URL exists anywhere we can show
 * it: the table stores a SHA-256, so a link that is not copied off this
 * response cannot be recovered, only replaced. The panel says so.
 */
export interface ShareFormState {
  ok: boolean;
  message: string;
  /** The full review URL, on the one response that created it. */
  link: string | null;
  /** Which field to blame, so the form can point rather than shrug. */
  field?: string;
}

export const EMPTY_SHARE: ShareFormState = { ok: false, message: '', link: null };
