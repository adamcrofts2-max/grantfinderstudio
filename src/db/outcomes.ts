/**
 * What the money would achieve, for one application. TENANT path.
 *
 * ## The shape is a logic model, and that is deliberate
 *
 * `activity → output → outcome`, with an optional indicator and target. Those
 * are the columns 0001 gave this table, and they are the four boxes almost
 * every UK funder's form asks for, in that order: what you will do, what that
 * produces, what changes as a result, and how anybody would know.
 *
 * The distinction between an output and an outcome is the one applicants most
 * often get wrong — "we ran 12 workshops" is an output; "34 young people
 * moved into work or training" is an outcome — and separate columns make the
 * form ask the question rather than leaving it to be noticed by an assessor.
 *
 * Like `budget.ts`, this table has been in the schema since 0001 with nothing
 * writing to it, while the readiness card said "No outcomes have been
 * defined." on every application.
 */

import type { Queryable } from './client.js';

export interface Outcome {
  id: string;
  activity: string;
  output: string;
  outcome: string;
  indicator: string | null;
  target: string | null;
}

export type NewOutcome = Omit<Outcome, 'id'>;

export async function loadOutcomes(
  tx: Queryable,
  applicationId: string,
): Promise<Outcome[]> {
  const { rows } = await tx.query<{
    id: string;
    activity: string;
    output: string;
    outcome: string;
    indicator: string | null;
    target: string | null;
  }>(
    `SELECT id, activity, output, outcome, indicator, target
       FROM outcomes WHERE application_id = $1 ORDER BY created_at, id`,
    [applicationId],
  );
  return rows;
}

export async function addOutcome(
  tx: Queryable,
  organisationId: string,
  applicationId: string,
  outcome: NewOutcome,
): Promise<string> {
  const id = `out_${applicationId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await tx.query(
    `INSERT INTO outcomes
       (id, organisation_id, application_id, activity, output, outcome, indicator, target)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      organisationId,
      applicationId,
      outcome.activity,
      outcome.output,
      outcome.outcome,
      outcome.indicator,
      outcome.target,
    ],
  );
  return id;
}

/** Scoped by application as well as by id, for the reason given in `budget.ts`. */
export async function deleteOutcome(
  tx: Queryable,
  applicationId: string,
  id: string,
): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `DELETE FROM outcomes WHERE id = $1 AND application_id = $2 RETURNING id`,
    [id, applicationId],
  );
  return rows.length > 0;
}
