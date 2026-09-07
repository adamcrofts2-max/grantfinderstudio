/**
 * Read model for the funding tracker.
 *
 * Two things belong on a tracker and only one of them is obvious. The
 * applications a person has started are the obvious half. The other half is
 * the opportunities they have looked at and NOT started — those are where
 * deadlines are actually missed, because nothing in the product is holding
 * them.
 *
 * No scheduling judgement happens here. This layer answers "what is there and
 * how much of it is done"; src/domain/tracker decides what that means.
 */

import type { Criterion } from '../domain/eligibility/types.js';
import type { DeadlineType } from '../domain/types.js';
import { mapCriteria, type CriterionRow } from './criteria-mapper.js';
import type { QuestionProgress } from '../domain/tracker/schedule.js';
import type { Queryable } from './client.js';

const DEADLINE_KINDS = new Set<string>([
  'confirmed',
  'rolling',
  'expected',
  'estimated',
  'unknown',
]);

/** Fail to 'unknown' rather than trusting an unrecognised value into the engine. */
function toDeadlineKind(value: string | null): DeadlineType {
  return value !== null && DEADLINE_KINDS.has(value) ? (value as DeadlineType) : 'unknown';
}

export interface TrackedApplication {
  id: string;
  status: string;
  opportunityId: string | null;
  title: string | null;
  funderName: string | null;
  deadline: string | null;
  deadlineKind: DeadlineType;
  amountRequestedGbp: number | null;
  submittedOn: string | null;
  sourceUrl: string | null;
  questions: QuestionProgress[];
  answered: number;
  unsupported: number;
}

export interface TrackedOpportunity {
  id: string;
  title: string;
  funderName: string;
  deadline: string | null;
  deadlineKind: DeadlineType;
  maxAmountGbp: number | null;
  sourceUrl: string | null;
}

export interface Tracker {
  applications: TrackedApplication[];
  /** Opportunities with no application against them yet. */
  notStarted: TrackedOpportunity[];
}

export async function loadTracker(tx: Queryable): Promise<Tracker> {
  const apps = await tx.query<{
    id: string;
    status: string;
    opportunity_id: string | null;
    title: string | null;
    funder_name: string | null;
    deadline: string | null;
    deadline_kind: string | null;
    amount_requested_gbp: string | null;
    submitted_on: string | null;
    source_url: string | null;
    unsupported: string;
  }>(`
    SELECT a.id, a.status, a.opportunity_id, o.title, f.name AS funder_name,
           o.deadline::text AS deadline, o.deadline_kind::text AS deadline_kind,
           a.amount_requested_gbp::text AS amount_requested_gbp,
           to_char(a.submitted_at, 'YYYY-MM-DD') AS submitted_on,
           o.source_url,
           count(DISTINCT r.id) FILTER (WHERE r.is_unsupported)::text AS unsupported
    FROM applications a
    LEFT JOIN opportunities o ON o.id = a.opportunity_id
    LEFT JOIN funders f ON f.id = o.funder_id
    LEFT JOIN application_questions q ON q.application_id = a.id
    LEFT JOIN answers ans ON ans.question_id = q.id
    LEFT JOIN answer_fact_refs r ON r.answer_id = ans.id
    GROUP BY a.id, a.status, a.opportunity_id, o.title, f.name, o.deadline,
             o.deadline_kind, a.amount_requested_gbp, a.submitted_at, o.source_url
    ORDER BY o.deadline NULLS LAST, a.created_at DESC
  `);

  // Question-level progress in one pass, rather than a query per application.
  const progress = await tx.query<{
    application_id: string;
    word_limit: number | null;
    answered: boolean;
  }>(`
    SELECT q.application_id, q.word_limit,
           (ans.content IS NOT NULL AND ans.content <> '') AS answered
    FROM application_questions q
    LEFT JOIN answers ans ON ans.question_id = q.id
    ORDER BY q.application_id, q.position
  `);

  const byApplication = new Map<string, QuestionProgress[]>();
  for (const row of progress.rows) {
    const list = byApplication.get(row.application_id) ?? [];
    list.push({ wordLimit: row.word_limit, answered: row.answered });
    byApplication.set(row.application_id, list);
  }

  const applications = apps.rows.map((row): TrackedApplication => {
    const questions = byApplication.get(row.id) ?? [];
    return {
      id: row.id,
      status: row.status,
      opportunityId: row.opportunity_id,
      title: row.title,
      funderName: row.funder_name,
      deadline: row.deadline,
      deadlineKind: toDeadlineKind(row.deadline_kind),
      amountRequestedGbp:
        row.amount_requested_gbp === null ? null : Number(row.amount_requested_gbp),
      submittedOn: row.submitted_on,
      sourceUrl: row.source_url,
      questions,
      answered: questions.filter((q) => q.answered).length,
      unsupported: Number(row.unsupported),
    };
  });

  // Opportunities are shared reference data; the NOT EXISTS is scoped to this
  // tenant's applications by row-level security, so "not started" means not
  // started by this organisation.
  const open = await tx.query<{
    id: string;
    title: string;
    funder_name: string;
    deadline: string | null;
    deadline_kind: string | null;
    max_amount_gbp: string | null;
    source_url: string | null;
  }>(`
    SELECT o.id, o.title, f.name AS funder_name,
           o.deadline::text AS deadline, o.deadline_kind::text AS deadline_kind,
           o.max_amount_gbp::text AS max_amount_gbp, o.source_url
    FROM opportunities o
    JOIN funders f ON f.id = o.funder_id
    WHERE NOT EXISTS (
      SELECT 1 FROM applications a WHERE a.opportunity_id = o.id
    )
    ORDER BY o.deadline NULLS LAST, o.title
  `);

  return {
    applications,
    notStarted: open.rows.map((row) => ({
      id: row.id,
      title: row.title,
      funderName: row.funder_name,
      deadline: row.deadline,
      deadlineKind: toDeadlineKind(row.deadline_kind),
      maxAmountGbp: row.max_amount_gbp === null ? null : Number(row.max_amount_gbp),
      sourceUrl: row.source_url,
    })),
  };
}

/** Record that an application went in, which stops its clock. */
export async function markSubmitted(tx: Queryable, applicationId: string): Promise<void> {
  await tx.query(
    `UPDATE applications
     SET submitted_at = now(), status = 'submitted'
     WHERE id = $1 AND submitted_at IS NULL`,
    [applicationId],
  );
}

/** Undo a submission recorded by mistake, restarting the clock. */
export async function unmarkSubmitted(tx: Queryable, applicationId: string): Promise<void> {
  await tx.query(
    `UPDATE applications SET submitted_at = NULL, status = 'drafting' WHERE id = $1`,
    [applicationId],
  );
}

/**
 * Verified eligibility criteria for several opportunities at once.
 *
 * Batched deliberately: the tracker asks about every fund on the page, and a
 * query per row would make the most-visited screen the slowest one.
 */
export async function loadCriteriaFor(
  tx: Queryable,
  opportunityIds: readonly string[],
): Promise<Map<string, Criterion[]>> {
  const byOpportunity = new Map<string, Criterion[]>();
  if (opportunityIds.length === 0) return byOpportunity;

  const r = await tx.query<CriterionRow & { opportunity_id: string }>(
    `SELECT opportunity_id, id, kind, label, params, cic_handling
     FROM eligibility_criteria
     WHERE opportunity_id = ANY($1)
     ORDER BY opportunity_id, id`,
    [opportunityIds],
  );

  const rowsByOpportunity = new Map<string, CriterionRow[]>();
  for (const row of r.rows) {
    const list = rowsByOpportunity.get(row.opportunity_id) ?? [];
    list.push(row);
    rowsByOpportunity.set(row.opportunity_id, list);
  }

  // Criteria that fail to map are dropped rather than guessed at, exactly as
  // the opportunity page does — an unmappable rule must not become a silent
  // pass. The engine treats a missing rule as an unknown, which is honest.
  for (const [opportunityId, rows] of rowsByOpportunity) {
    byOpportunity.set(opportunityId, mapCriteria(rows).criteria);
  }
  return byOpportunity;
}

/**
 * What the organisation can actually bring to the drafting.
 *
 * Read rather than assumed, because the whole point of pricing assisted
 * drafting differently is that it must be true. `usableFacts` counts only
 * confirmed, non-superseded facts — the Writer refuses to ground prose in
 * anything else, so anything else would not make the drafting faster.
 */
export async function countUsableFacts(tx: Queryable): Promise<number> {
  const r = await tx.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM facts
     WHERE confirmed_by IS NOT NULL AND superseded_by IS NULL`,
  );
  return Number(r.rows[0]?.count ?? '0');
}
