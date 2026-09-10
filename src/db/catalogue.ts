/**
 * Writing a fund somebody typed in.
 *
 * Two callers with the same shape and one difference that matters: a fund a
 * CIC adds carries their organisation id, so the policy in 0004 keeps it to
 * them; a fund the operator adds to the shared catalogue carries NULL, which
 * is what makes it visible to everybody.
 *
 * The shared write runs on the OWNER connection. `app_operator` has SELECT on
 * `opportunities` and nothing more (0009), deliberately: a console session
 * that could rewrite the catalogue every tenant reads is a larger blast radius
 * than one that can only look at it.
 */

import type { Queryable } from './client.js';
import type { ManualFund } from '../domain/opportunity/manual.js';

/**
 * Find a funder by name, or make one.
 *
 * Matched case-insensitively on the name, because "The Wells Trust" and "the
 * wells trust" are one funder and a duplicate splits their award history in
 * two.
 */
/**
 * One funder by id, for carrying a matched funder into the fund you found.
 *
 * Funders are SHARED reference data — every tenant reads all of them and none
 * writes them — so an id arriving from a form leaks nothing and can only ever
 * name a real funder. It is still looked up rather than trusted: an id for a
 * funder that does not exist would otherwise become a foreign key violation
 * at the end of a form somebody had just filled in.
 */
export async function findFunderById(
  tx: Queryable,
  id: string,
): Promise<{ id: string; name: string; website: string | null } | null> {
  const { rows } = await tx.query<{ id: string; name: string; website: string | null }>(
    'SELECT id, name, website FROM funders WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export async function ensureFunderNamed(
  tx: Queryable,
  name: string,
  idPrefix: string,
): Promise<string> {
  const existing = await tx.query<{ id: string }>(
    'SELECT id FROM funders WHERE lower(name) = lower($1) LIMIT 1',
    [name],
  );
  const found = existing.rows[0];
  if (found !== undefined) return found.id;

  const id = `${idPrefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await tx.query('INSERT INTO funders (id, name) VALUES ($1, $2)', [id, name]);
  return id;
}

/**
 * Store a hand-entered fund.
 *
 * `freshness_state` is `needs_verification`, matching the pasted-guidance path
 * and for the same reason: somebody read a page at a moment in time, and
 * nothing here knows whether it is still true. `verified_at` stays null.
 *
 * `origin` is `user` — a person typed this. It must never be able to render as
 * a register entry.
 *
 * The funder id comes in already resolved, because `funders` is shared
 * reference data that the tenant role may read and not write — so creating one
 * is an operator step that has to happen on a separate connection, exactly as
 * the pasted-guidance path does it. Doing it inside here failed with
 * "permission denied for table funders" the first time somebody typed in a
 * funder we had never heard of, which is most of them.
 */
export async function insertManualFund(
  tx: Queryable,
  fund: ManualFund,
  funderId: string,
  addedByOrganisationId: string | null,
): Promise<string> {
  const id = `opp_typed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  await tx.query(
    `INSERT INTO opportunities
       (id, funder_id, title, summary, min_amount_gbp, max_amount_gbp, jurisdiction,
        deadline, deadline_kind, freshness_state, source_url, retrieved_at,
        origin, added_by_organisation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'needs_verification', $10, now(),
             'user', $11)`,
    [
      id,
      funderId,
      fund.title,
      fund.summary,
      fund.minAmountGbp,
      fund.maxAmountGbp,
      fund.jurisdiction,
      fund.deadline,
      fund.deadlineKind,
      fund.sourceUrl,
      addedByOrganisationId,
    ],
  );
  return id;
}

/**
 * Remove a fund from the shared catalogue.
 *
 * Guarded on `added_by_organisation_id IS NULL` in the statement itself, so
 * this can never reach a fund a CIC added for themselves however it is called.
 */
export async function deleteSharedFund(tx: Queryable, id: string): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `DELETE FROM opportunities
      WHERE id = $1 AND added_by_organisation_id IS NULL
      RETURNING id`,
    [id],
  );
  return rows.length === 1;
}
