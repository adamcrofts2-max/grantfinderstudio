/**
 * Shared workspace state.
 *
 * Separate from `actions.ts` because a `'use server'` module may only export
 * async functions.
 */

export interface DraftState {
  questionId: string | null;
  ok: boolean;
  message: string;
  /** Sentences with the fact behind each, for the provenance display. */
  claims: Array<{ text: string; factId: string | null; factLabel: string | null }>;
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

export interface AddState {
  ok: boolean;
  message: string;
}

export const EMPTY_ADD: AddState = { ok: false, message: '' };

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
