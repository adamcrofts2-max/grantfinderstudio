/**
 * Reviews of an application, kept. TENANT path.
 *
 * ## Why they were not kept
 *
 * `reviews` has been in 0001 since the beginning and nothing wrote to it. A
 * review lived in `useActionState` and was gone the moment somebody navigated
 * away — so the product spent a model call, showed the findings once, and
 * discarded them. An applicant who wanted to work through a finding the next
 * evening had to pay for the whole review again.
 *
 * ## Why a review is stamped with the state it reviewed
 *
 * A finding quotes the words it is about — that is what makes it checkable,
 * and `keepCheckableFindings` discards any that do not. But an answer can be
 * rewritten afterwards, and then the quote is about text that no longer
 * exists. So a stored review records the readiness at the time, and
 * `answersEditedSince` counts the answer versions written after it, which lets
 * the panel say "2 answers have changed since this review" instead of
 * presenting stale findings as current.
 *
 * `answer_versions` already records every save with a timestamp, so this needs
 * no fingerprint column and cannot drift from what actually happened.
 */

import type { Queryable } from './client.js';

export type ReviewMode = 'standard' | 'red_team';

export interface StoredFinding {
  kind: string;
  questionNumber: number | null;
  quote: string | null;
  problem: string;
  suggestion: string;
  severity: 'blocking' | 'worth_fixing' | 'minor';
}

export interface StoredReview {
  id: string;
  mode: ReviewMode;
  summary: string | null;
  findings: StoredFinding[];
  mostImportant: string | null;
  strengths: string[];
  injected: string[];
  readinessPercent: number | null;
  createdAt: string;
}

export interface NewReview {
  mode: ReviewMode;
  summary: string;
  findings: readonly StoredFinding[];
  mostImportant: string | null;
  strengths: readonly string[];
  injected: readonly string[];
  readinessPercent: number | null;
}

export async function saveReview(
  tx: Queryable,
  organisationId: string,
  applicationId: string,
  review: NewReview,
): Promise<string> {
  const id = `rev_${applicationId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await tx.query(
    `INSERT INTO reviews
       (id, organisation_id, application_id, mode, findings, summary,
        most_important, strengths, injected, readiness_percent)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9::jsonb, $10)`,
    [
      id,
      organisationId,
      applicationId,
      review.mode,
      JSON.stringify(review.findings),
      review.summary,
      review.mostImportant,
      JSON.stringify(review.strengths),
      JSON.stringify(review.injected),
      review.readinessPercent,
    ],
  );
  return id;
}

/**
 * Parse a jsonb column back into an array.
 *
 * Defensive about its own data on purpose: these rows outlive the shape that
 * wrote them. A review stored before a field existed, or by a version that
 * spelled a severity differently, must render as a review missing that part
 * rather than take the page down — the alternative is an application somebody
 * cannot open because of a review they have already read.
 */
function asArray<T>(value: unknown, keep: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(keep) : [];
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

const SEVERITIES = new Set(['blocking', 'worth_fixing', 'minor']);

function isFinding(value: unknown): value is StoredFinding {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row['kind'] === 'string' &&
    typeof row['problem'] === 'string' &&
    typeof row['suggestion'] === 'string' &&
    typeof row['severity'] === 'string' &&
    SEVERITIES.has(row['severity'])
  );
}

/** The most recent review of this application, or null. */
export async function loadLatestReview(
  tx: Queryable,
  applicationId: string,
): Promise<StoredReview | null> {
  const { rows } = await tx.query<{
    id: string;
    mode: ReviewMode;
    summary: string | null;
    findings: unknown;
    most_important: string | null;
    strengths: unknown;
    injected: unknown;
    readiness_percent: number | null;
    created_at: string;
  }>(
    // ISO 8601 with a Z, not `created_at::text`. Postgres renders a
    // timestamptz with a `+00` offset, which `new Date()` refuses — so the
    // panel's "read 3 minutes ago" fell back to the word "earlier" on every
    // stored review. Still a timestamptz when handed back to
    // `answersEditedSince`, so one field serves both.
    `SELECT id, mode, summary, findings, most_important, strengths, injected,
            readiness_percent,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
              AS created_at
       FROM reviews
      WHERE application_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [applicationId],
  );

  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    mode: row.mode,
    summary: row.summary,
    findings: asArray(row.findings, isFinding),
    mostImportant: row.most_important,
    strengths: asArray(row.strengths, isString),
    injected: asArray(row.injected, isString),
    readinessPercent: row.readiness_percent,
    createdAt: row.created_at,
  };
}

/**
 * How many answers have been written since a moment.
 *
 * Counts distinct ANSWERS rather than versions: somebody who saved the same
 * answer four times has changed one answer, and "4 answers have changed since
 * this review" would be wrong in the direction that matters — it would make
 * the review look staler than it is.
 */
export async function answersEditedSince(
  tx: Queryable,
  applicationId: string,
  since: string,
): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `SELECT count(DISTINCT v.answer_id)::int AS n
       FROM answer_versions v
       JOIN answers a ON a.id = v.answer_id
       JOIN application_questions q ON q.id = a.question_id
      WHERE q.application_id = $1
        AND v.created_at > $2::timestamptz`,
    [applicationId, since],
  );
  return rows[0]?.n ?? 0;
}
