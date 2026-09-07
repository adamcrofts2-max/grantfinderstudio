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
