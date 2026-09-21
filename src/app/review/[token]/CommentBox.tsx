'use client';

import { useActionState } from 'react';

import { leaveCommentAction } from './actions';
import { EMPTY_COMMENT } from './state';
import { MAX_COMMENT_LENGTH } from '@/domain/review/comments';

/** One comment already left, as the reviewer's own page shows it. */
export interface LeftComment {
  id: string;
  body: string;
  /** Phrased by the page, off one clock reading. */
  when: string;
  handled: boolean;
}

/**
 * Where a reviewer says what they noticed.
 *
 * ## Why the box is under the answer rather than at the end of the page
 *
 * Because the note is about THIS answer, and a reviewer who has to scroll to
 * a single box at the bottom writes "the second one needs numbers" — which is
 * a puzzle by the time the applicant reads it. The structure is the feature:
 * a comment carries the question it belongs to, so the applicant sees it
 * beside the words it is about.
 *
 * ## Their own comments, shown back to them
 *
 * A reviewer who cannot see what they have already said either repeats
 * themselves or stops. Their own only — one reviewer has no business reading
 * another's notes, which `loadComments` enforces by share rather than leaving
 * to this component.
 *
 * The "dealt with" mark is shown because it is the honest state of the thing
 * they said, and it is the closest this gets to a reply: somebody read it and
 * acted.
 */
export function CommentBox({
  token,
  questionId,
  comments,
  heading,
  hint,
}: {
  token: string;
  /** Null for the box about the application as a whole. */
  questionId: string | null;
  comments: readonly LeftComment[];
  heading: string;
  hint: string;
}) {
  const [state, send, sending] = useActionState(leaveCommentAction, EMPTY_COMMENT);
  // The message belongs to THIS box: a reviewer may have six of them open,
  // and one action's state is shared by every instance on the page.
  const mine =
    questionId === null
      ? state.general
      : state.questionId === questionId;
  const result = mine && state.message !== '' ? state : null;

  return (
    <div className="commenting">
      {comments.length > 0 ? (
        <>
          <h3 className="part-head">{comments.length === 1 ? 'You said' : 'You have said'}</h3>
          <ul className="comments">
            {comments.map((comment) => (
              <li className="comment" key={comment.id}>
                <p className="comment-body">{comment.body}</p>
                <p className="comment-foot">
                  {comment.when}
                  {comment.handled ? ' · they have dealt with this' : null}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <form action={send}>
        <input name="token" type="hidden" value={token} />
        <input name="questionId" type="hidden" value={questionId ?? ''} />
        <div className="field">
          <label className="label" htmlFor={`comment-${questionId ?? 'general'}`}>
            {heading}
          </label>
          <textarea
            className="input"
            id={`comment-${questionId ?? 'general'}`}
            maxLength={MAX_COMMENT_LENGTH}
            name="body"
            placeholder={hint}
            rows={3}
          />
        </div>
        <div className="row" style={{ marginTop: 'var(--s-3)' }}>
          <button className="btn btn-secondary" disabled={sending} type="submit">
            {sending ? 'Sending…' : 'Send this comment'}
          </button>
        </div>
      </form>

      <div aria-live="polite">
        {result !== null ? (
          <p
            className={`notice ${result.ok ? 'notice-neutral' : 'notice-caution'}`}
            style={{
              marginTop: 'var(--s-3)',
              color: result.ok ? 'var(--positive)' : undefined,
              fontWeight: 550,
            }}
          >
            <span aria-hidden="true">{result.ok ? '✓' : '⚠'}</span>
            <span>{result.message}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
