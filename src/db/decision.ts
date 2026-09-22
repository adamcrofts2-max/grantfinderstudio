/**
 * Recording what the funder said. TENANT path.
 *
 * ## Why the write is one statement and not three
 *
 * A decision is four facts that only make sense together — the answer, the
 * date, the amount and the note. Written separately, a failure between them
 * would leave an application marked 'awarded' with no date, which 0028's
 * constraint refuses, or an amount against a rejection, which is nonsense.
 * One UPDATE means the row is never half-decided.
 *
 * ## Clearing is a real operation, not an undo of convenience
 *
 * People mistype a status. Clearing puts the application back to 'submitted'
 * and wipes the date, the amount and the note together, for the same reason:
 * a cleared decision that left its amount behind would show up in the next
 * total as money won on an application nobody has heard about.
 */

import type { Decision, DecisionRecord } from '../domain/tracker/decision.js';
import type { Queryable } from './client.js';

/** What an application's own row knows about its outcome. */
export interface DecisionRow {
  decision: Decision | null;
  /** ISO date. Null whenever `decision` is null, by 0028's constraint. */
  decidedOn: string | null;
  amountAwardedGbp: number | null;
  note: string | null;
}

/**
 * Record the funder's answer.
 *
 * Guarded on `submitted_at IS NOT NULL`: an application nobody has sent
 * cannot have been answered, and letting one be marked 'awarded' would put a
 * number into the totals that no funder ever agreed to. Returns false when
 * the guard refuses, so the caller can say why rather than claiming success.
 */
export async function recordDecision(
  tx: Queryable,
  applicationId: string,
  record: DecisionRecord,
): Promise<boolean> {
  const result = await tx.query<{ id: string }>(
    `UPDATE applications
     SET status = $2::application_status,
         decided_at = $3::date,
         amount_awarded_gbp = $4::numeric,
         outcome_note = $5
     WHERE id = $1 AND submitted_at IS NOT NULL
     RETURNING id`,
    [
      applicationId,
      record.decision,
      record.decidedOn,
      record.amountAwardedGbp,
      record.note,
    ],
  );
  return result.rows.length > 0;
}

/**
 * Put an application back to waiting on the funder.
 *
 * Only ever applied to a row that carries a decision, so an accidental call
 * cannot drag a draft forward into 'submitted'.
 */
export async function clearDecision(tx: Queryable, applicationId: string): Promise<boolean> {
  const result = await tx.query<{ id: string }>(
    `UPDATE applications
     SET status = 'submitted',
         decided_at = NULL,
         amount_awarded_gbp = NULL,
         outcome_note = NULL
     WHERE id = $1 AND status IN ('awarded', 'rejected', 'no_reply')
     RETURNING id`,
    [applicationId],
  );
  return result.rows.length > 0;
}

/**
 * What the form needs to know before it can judge a typed date: whether the
 * application exists at all, and when it went in.
 *
 * Returns null when there is no such application for this tenant — which,
 * under row-level security, covers both "deleted" and "not yours".
 */
export async function readDecisionContext(
  tx: Queryable,
  applicationId: string,
): Promise<{ submittedOn: string | null } | null> {
  const result = await tx.query<{ submitted_on: string | null }>(
    `SELECT to_char(submitted_at, 'YYYY-MM-DD') AS submitted_on
     FROM applications WHERE id = $1`,
    [applicationId],
  );
  const row = result.rows[0];
  return row === undefined ? null : { submittedOn: row.submitted_on };
}
