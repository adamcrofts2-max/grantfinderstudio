/**
 * The reviewer's side of a comment, as the form sees it.
 *
 * Separate from `actions.ts` because a `'use server'` module may only export
 * async functions.
 */

export interface CommentState {
  ok: boolean;
  message: string;
  /**
   * Which box the message belongs under.
   *
   * A reviewer may have six boxes open on one page, and a message with no
   * question on it appears under all of them or none — the fault
   * `DraftState.questionId` exists to prevent, in the same shape.
   */
  questionId: string | null;
  /** True for the box about the application as a whole. */
  general: boolean;
}

export const EMPTY_COMMENT: CommentState = {
  ok: false,
  message: '',
  questionId: null,
  general: false,
};
