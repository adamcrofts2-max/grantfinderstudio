/**
 * Reviewer comments. TENANT path on both sides.
 *
 * The reviewer writes through the tenant connection with the organisation
 * their token named — `resolveShare` has already run by then — so there is no
 * owner-connection query here and no equivalent of 0024's token policy. One
 * policy covers a reviewer leaving a comment and an applicant reading it,
 * which is the point: a reviewer's write is inside the same isolation every
 * other write to this organisation's data is inside.
 *
 * ## Scoped to the share on the reviewer's side
 *
 * `loadComments` takes a `shareId` for the reviewer's own list, because one
 * reviewer has no business reading another's notes. The applicant's list is
 * the whole application's, which is theirs to see.
 */

import type { Queryable } from './client.js';

export interface CommentRow {
  id: string;
  applicationId: string;
  shareId: string;
  /** Null for a comment about the application as a whole. */
  questionId: string | null;
  body: string;
  /** ISO with a Z, so `new Date()` accepts it. */
  createdAt: string;
  handledAt: string | null;
  /** Which of the applicant's own reviewers left it, as they labelled them. */
  reviewerName: string;
}

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const iso = (column: string): string =>
  `to_char(${column} AT TIME ZONE 'UTC', ${ISO})`;

const COLUMNS = `c.id, c.application_id, c.share_id, c.question_id, c.body,
       ${iso('c.created_at')} AS created_at,
       ${iso('c.handled_at')} AS handled_at,
       s.reviewer_name`;

interface Row {
  id: string;
  application_id: string;
  share_id: string;
  question_id: string | null;
  body: string;
  created_at: string;
  handled_at: string | null;
  reviewer_name: string;
}

const toComment = (row: Row): CommentRow => ({
  id: row.id,
  applicationId: row.application_id,
  shareId: row.share_id,
  questionId: row.question_id,
  body: row.body,
  createdAt: row.created_at,
  handledAt: row.handled_at,
  reviewerName: row.reviewer_name,
});

/**
 * Leave a comment.
 *
 * `shareId` comes from `resolveShare` and never from the form: a reviewer's
 * only credential is their token, so the row they write must be attributed by
 * the thing that authenticated them rather than by anything they posted.
 */
export async function addComment(
  tx: Queryable,
  organisationId: string,
  comment: {
    applicationId: string;
    shareId: string;
    questionId: string | null;
    body: string;
  },
): Promise<CommentRow | null> {
  const id = `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  // The question must belong to THIS application. A question id is posted by
  // the page, and although RLS keeps it inside the organisation, one
  // application's comment must not be filed against another's question.
  const { rows } = await tx.query<Row>(
    `WITH inserted AS (
       INSERT INTO share_comments
         (id, organisation_id, application_id, share_id, question_id, body)
       SELECT $1, $2, $3, $4, $5, $6
        WHERE $5::text IS NULL
           OR EXISTS (
                SELECT 1 FROM application_questions q
                 WHERE q.id = $5 AND q.application_id = $3
              )
       RETURNING *
     )
     SELECT ${COLUMNS}
       FROM inserted c
       JOIN application_shares s ON s.id = c.share_id`,
    [
      id,
      organisationId,
      comment.applicationId,
      comment.shareId,
      comment.questionId,
      comment.body,
    ],
  );
  const row = rows[0];
  return row === undefined ? null : toComment(row);
}

/** How many comments one link has left, for the per-share cap. */
export async function countCommentsForShare(
  tx: Queryable,
  shareId: string,
): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM share_comments WHERE share_id = $1',
    [shareId],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Which question number a question id is, within one application.
 *
 * For the audit line, which says "question 2" rather than
 * `q_app_x_1_1789…`. Scoped by application as well as by id so the answer is
 * about the application the caller named, and null when the question is not
 * that application's — the same refusal `addComment` makes, said in a form
 * the trail can use.
 */
export async function questionNumber(
  tx: Queryable,
  applicationId: string,
  questionId: string,
): Promise<number | null> {
  const { rows } = await tx.query<{ position: number }>(
    `SELECT position FROM application_questions
      WHERE id = $1 AND application_id = $2`,
    [questionId, applicationId],
  );
  return rows[0]?.position ?? null;
}

/**
 * The comments on one application, oldest first.
 *
 * Oldest first, unlike every other list here: a review reads as a sequence of
 * points about a document, and reversing it puts the reviewer's last thought
 * first. `shareId` narrows it to one reviewer's own notes, which is what the
 * reviewer's page shows.
 */
export async function loadComments(
  tx: Queryable,
  applicationId: string,
  options: { shareId?: string } = {},
): Promise<CommentRow[]> {
  const scoped = options.shareId !== undefined;
  const { rows } = await tx.query<Row>(
    `SELECT ${COLUMNS}
       FROM share_comments c
       JOIN application_shares s ON s.id = c.share_id
      WHERE c.application_id = $1${scoped ? ' AND c.share_id = $2' : ''}
      ORDER BY c.created_at, c.id`,
    scoped ? [applicationId, options.shareId] : [applicationId],
  );
  return rows.map(toComment);
}

/**
 * Mark a comment as dealt with, or put it back.
 *
 * Scoped by application as well as by id, for the reason `budget.ts` gives:
 * an id from one application must not act on another's row even inside the
 * same organisation. Returns whether anything changed, so the screen can tell
 * the difference between "done" and "that had already gone".
 */
export async function setCommentHandled(
  tx: Queryable,
  applicationId: string,
  id: string,
  handled: { by: string } | null,
): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE share_comments
        SET handled_at = ${handled === null ? 'NULL' : 'now()'},
            handled_by = $3
      WHERE id = $1 AND application_id = $2
        AND (handled_at IS NULL) = ${handled === null ? 'false' : 'true'}
      RETURNING id`,
    [id, applicationId, handled === null ? null : handled.by],
  );
  return rows.length > 0;
}
