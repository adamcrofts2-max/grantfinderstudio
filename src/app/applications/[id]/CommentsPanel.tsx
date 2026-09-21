'use client';

import { useActionState } from 'react';

import { setCommentHandledAction } from './actions';
import { EMPTY_EDIT } from './state';
import { commentSummary } from '@/domain/review/comments';

/** One reviewer comment, as the applicant's screen shows it. */
export interface CommentView {
  id: string;
  body: string;
  reviewerName: string;
  /** Phrased by the page, off one clock reading. */
  when: string;
  handled: boolean;
  /** Which question it is about, or null for the application as a whole. */
  questionNumber: number | null;
  questionText: string | null;
}

/**
 * What the people who read it said.
 *
 * ## Why it is not folded away
 *
 * The trail and the share panel are references — things you consult. This is
 * a list of things somebody is waiting for you to do, written by a person who
 * gave up an evening to read your application. Hidden behind a summary it
 * would be read once and forgotten, which is the same as not asking them.
 *
 * It disappears entirely when there are no comments, rather than sitting there
 * empty: an empty panel on every application teaches people to skip it.
 *
 * ## Why "dealt with" rather than a delete
 *
 * The words stay. A comment is the reason an answer changed, and a record
 * that loses the reason keeps only the change. Handled comments fold away
 * under their own summary so the list is what is left to do.
 *
 * ## The text is the reviewer's, and it is UNTRUSTED
 *
 * It comes from outside the organisation and outside any account. React
 * escapes it on the way here; nothing splices it into a prompt.
 */
export function CommentsPanel({
  applicationId,
  comments,
}: {
  applicationId: string;
  comments: readonly CommentView[];
}) {
  const [state, mark] = useActionState(setCommentHandledAction, EMPTY_EDIT);
  if (comments.length === 0) return null;

  const open = comments.filter((comment) => !comment.handled);
  const done = comments.filter((comment) => comment.handled);

  const Comment = ({ comment }: { comment: CommentView }) => (
    <li className="comment" key={comment.id}>
      <p className="comment-where">
        {comment.questionNumber === null
          ? 'About the whole application'
          : `Question ${comment.questionNumber}${
              comment.questionText === null ? '' : ` — ${comment.questionText}`
            }`}
      </p>
      <p className="comment-body">{comment.body}</p>
      <p className="comment-foot">
        {comment.reviewerName} · {comment.when}
      </p>
      <form action={mark}>
        <input name="applicationId" type="hidden" value={applicationId} />
        <input name="commentId" type="hidden" value={comment.id} />
        <input name="handled" type="hidden" value={comment.handled ? '0' : '1'} />
        <button className="btn btn-quiet" type="submit">
          {comment.handled ? 'Put it back on the list' : 'I have dealt with this'}
        </button>
      </form>
    </li>
  );

  return (
    <section className="card" id="comments">
      <h2 className="card-title">What your reviewers said</h2>
      <p className="card-sub" style={{ marginTop: 'var(--s-1)' }}>
        {commentSummary(comments.length, open.length)} Each one is attached to the answer it
        is about.
      </p>

      {open.length > 0 ? (
        <ul className="comments" style={{ marginTop: 'var(--s-4)' }}>
          {open.map((comment) => (
            <Comment comment={comment} key={comment.id} />
          ))}
        </ul>
      ) : null}

      {done.length > 0 ? (
        <details className="paste" style={{ marginTop: 'var(--s-4)' }}>
          <summary className="paste-summary">
            {done.length === 1 ? '1 you have dealt with' : `${done.length} you have dealt with`}
            <span className="chev chev-toggle" />
          </summary>
          <div className="paste-body">
            <ul className="comments">
              {done.map((comment) => (
                <Comment comment={comment} key={comment.id} />
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      <div aria-live="polite">
        {state.message !== '' ? (
          <p
            className={`notice ${state.ok ? 'notice-neutral' : 'notice-caution'}`}
            style={{
              marginTop: 'var(--s-3)',
              color: state.ok ? 'var(--positive)' : undefined,
              fontWeight: 550,
            }}
          >
            <span aria-hidden="true">{state.ok ? '✓' : '⚠'}</span>
            <span>{state.message}</span>
          </p>
        ) : null}
      </div>
    </section>
  );
}
