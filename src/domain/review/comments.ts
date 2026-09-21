/**
 * What a reviewer may say, and where they may say it.
 *
 * ## Why a comment is attached to a question rather than to the application
 *
 * "The second answer does not say who benefits" is a note somebody can act
 * on. The same sentence at the bottom of a page of six answers is a puzzle
 * about which answer it meant. Phase 9 Step 2 asks for structured comments
 * for exactly that reason: the structure is what makes the feedback usable
 * three days later, when the reviewer is not there to ask.
 *
 * A comment about no particular question is still allowed — "the budget does
 * not match what answer 3 promises" belongs to the application, not to one
 * box — and it is stored with a null question rather than forced onto an
 * arbitrary one.
 *
 * ## The reviewer's text is UNTRUSTED, and stays data
 *
 * It arrives from outside the organisation and outside any account, so it
 * gets the treatment every other outside text gets here: escaped by React on
 * the way to a screen, and never spliced into a model prompt. The Critic
 * reads the application; if it is ever given the reviewer's notes as well,
 * that is a deliberate change with `keepCheckableFindings`-style handling and
 * not something a comment can arrange for itself by asking nicely.
 */

/**
 * The longest comment we will store.
 *
 * A bound rather than a view about length — long enough for a careful
 * paragraph on a single answer, short enough that a pasted document fails
 * with a sentence rather than filling a column. An order of magnitude under
 * `MAX_ANSWER_LENGTH`, because a note about an answer is not another answer.
 */
export const MAX_COMMENT_LENGTH = 2_000;

/**
 * How many comments one link may leave.
 *
 * Not a view about thoroughness: a link is a bearer token, and a bearer token
 * that can write unboundedly into somebody's application is a way to fill
 * their screen with noise they then have to clear. Fifty is more than any
 * real review of one application produces, and the refusal says what it is.
 */
export const MAX_COMMENTS_PER_SHARE = 50;

export interface CommentDraft {
  /** The question it is about, or null for the application as a whole. */
  questionId: string | null;
  body: string;
}

export type CommentCheck =
  | { ok: true; comment: CommentDraft }
  | { ok: false; problem: string };

/**
 * Check one comment before it is stored.
 *
 * Trims, and keeps the line breaks: a reviewer who wrote three short points
 * on separate lines meant three points, and collapsing that into a paragraph
 * loses the only structure they gave it. Runs of blank lines collapse to one,
 * which is the difference between formatting and padding.
 */
export function checkComment(
  raw: string,
  questionId: string | null,
  existing: number,
): CommentCheck {
  if (existing >= MAX_COMMENTS_PER_SHARE) {
    return {
      ok: false,
      problem: `This link has left ${MAX_COMMENTS_PER_SHARE} comments, which is all it may leave. Send anything further to whoever shared it with you.`,
    };
  }

  const body = raw
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  if (body === '') {
    return { ok: false, problem: 'There is nothing in the box to send.' };
  }
  if (body.length > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      problem: `That is ${body.length.toLocaleString('en-GB')} characters, and ${MAX_COMMENT_LENGTH.toLocaleString('en-GB')} is the limit. Send the most important part, or several comments.`,
    };
  }

  return {
    ok: true,
    comment: { questionId: questionId === '' ? null : questionId, body },
  };
}

/**
 * How a comment count reads on the applicant's screen.
 *
 * Here rather than in the panel because "3 comments, 1 still to look at" is
 * the sentence that decides whether somebody opens the panel, and a sentence
 * that important should be testable without a browser.
 */
export function commentSummary(total: number, open: number): string {
  if (total === 0) return 'No comments yet.';
  const all = `${total} comment${total === 1 ? '' : 's'}`;
  if (open === 0) return `${all}, all dealt with.`;
  if (open === total) return open === 1 ? '1 comment to look at.' : `${all} to look at.`;
  return `${all}, ${open} still to look at.`;
}
