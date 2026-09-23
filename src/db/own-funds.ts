/**
 * A fund this organisation added itself — its details and its rules. TENANT path.
 *
 * Every statement here is scoped twice: by row-level security (0004's
 * `own_write`, which lets a tenant write only rows it added) and by an explicit
 * `added_by_organisation_id = current_setting(...)` in the statement. The
 * second is not redundant. RLS makes a write to somebody else's row silently
 * affect nothing; the explicit condition makes these functions REPORT that,
 * so an action can say "that is not one of your funds" instead of "saved"
 * over a change that never happened. And a shared catalogue fund is visible to
 * every tenant, so "can I see it" is never the same question as "is it mine".
 */

import type { Queryable } from './client.js';
import type { ManualFund, DeadlineKind } from '../domain/opportunity/manual.js';
import type { HandRule } from '../domain/eligibility/hand-rule.js';
import type { Jurisdiction } from '../domain/types.js';

const MINE = `added_by_organisation_id = current_setting('app.organisation_id', true)`;

/** `numeric` arrives as text, so that pence are never rounded through a float. */
const money = (value: string | null): number | null => (value === null ? null : Number(value));

export interface OwnFund {
  id: string;
  title: string;
  summary: string | null;
  sourceUrl: string | null;
  minAmountGbp: number | null;
  maxAmountGbp: number | null;
  jurisdiction: Jurisdiction | null;
  deadline: string | null;
  deadlineKind: DeadlineKind;
  funderId: string;
  funderName: string;
  /** Read from pasted guidance, rather than typed field by field. */
  pasted: boolean;
}

/** The fund, if this organisation added it; null for anything else, including shared funds. */
export async function loadOwnFund(tx: Queryable, id: string): Promise<OwnFund | null> {
  const { rows } = await tx.query<{
    id: string;
    title: string;
    summary: string | null;
    source_url: string | null;
    min_amount_gbp: string | null;
    max_amount_gbp: string | null;
    jurisdiction: Jurisdiction | null;
    deadline: string | null;
    deadline_kind: DeadlineKind;
    funder_id: string;
    funder_name: string;
    pasted: boolean;
  }>(
    `SELECT o.id, o.title, o.summary, o.source_url,
            o.min_amount_gbp::text AS min_amount_gbp, o.max_amount_gbp::text AS max_amount_gbp,
            o.jurisdiction, o.deadline::text AS deadline, o.deadline_kind,
            o.funder_id, f.name AS funder_name, o.source_text IS NOT NULL AS pasted
     FROM opportunities o
     JOIN funders f ON f.id = o.funder_id
     WHERE o.id = $1 AND o.${MINE}`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    sourceUrl: row.source_url,
    minAmountGbp: money(row.min_amount_gbp),
    maxAmountGbp: money(row.max_amount_gbp),
    jurisdiction: row.jurisdiction,
    deadline: row.deadline,
    deadlineKind: row.deadline_kind,
    funderId: row.funder_id,
    funderName: row.funder_name,
    pasted: row.pasted,
  };
}

/**
 * Change a fund's details. True when a row of this organisation's changed.
 *
 * Freshness is left as it is — `needs_verification` for everything a tenant
 * adds. Correcting a typo in the title is not checking the fund against the
 * funder's site, and resetting the flag here would claim that it was.
 */
export async function updateOwnFund(
  tx: Queryable,
  id: string,
  fund: ManualFund,
  funderId: string,
): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE opportunities
        SET funder_id = $2, title = $3, summary = $4, min_amount_gbp = $5,
            max_amount_gbp = $6, jurisdiction = $7, deadline = $8, deadline_kind = $9,
            source_url = $10
      WHERE id = $1 AND ${MINE}
      RETURNING id`,
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
    ],
  );
  return rows.length === 1;
}

export interface RuleInUse {
  id: string;
  kind: string;
  label: string;
  params: unknown;
  cicHandling: string | null;
  sourceSpan: string | null;
  /** 'user' for a rule typed in here; anything else was read from guidance. */
  proposedBy: string;
}

/** The rules the eligibility engine is applying to this fund. */
export async function loadRulesInUse(tx: Queryable, opportunityId: string): Promise<RuleInUse[]> {
  const { rows } = await tx.query<{
    id: string;
    kind: string;
    label: string;
    params: unknown;
    cic_handling: string | null;
    source_span: string | null;
    proposed_by: string;
  }>(
    `SELECT id, kind, label, params, cic_handling, source_span, proposed_by
       FROM eligibility_criteria
      WHERE opportunity_id = $1 AND verified_at IS NOT NULL
      ORDER BY created_at, id`,
    [opportunityId],
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    params: row.params,
    cicHandling: row.cic_handling,
    sourceSpan: row.source_span,
    proposedBy: row.proposed_by,
  }));
}

/**
 * Store a rule somebody typed in, already verified by them.
 *
 * Returns the new id, or null when the fund is not this organisation's — the
 * INSERT ... SELECT finds no row to attach to, rather than tripping the
 * policy's WITH CHECK and failing the whole transaction.
 */
export async function addHandRule(
  tx: Queryable,
  opportunityId: string,
  rule: HandRule,
  userId: string,
): Promise<string | null> {
  const id = `crit_hand_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO eligibility_criteria
       (id, opportunity_id, kind, label, params, cic_handling, source_span,
        proposed_by, verified_by, verified_at)
     SELECT $1, o.id, $3, $4, $5::jsonb, $6::cic_treatment, $7, 'user', $8, now()
       FROM opportunities o
      WHERE o.id = $2 AND o.${MINE}
     RETURNING id`,
    [
      id,
      opportunityId,
      rule.kind,
      rule.label,
      JSON.stringify(rule.params),
      rule.cicHandling,
      rule.sourceSpan,
      userId,
    ],
  );
  return rows[0]?.id ?? null;
}

/**
 * Stop applying a rule.
 *
 * A rule somebody typed is deleted: it came from nowhere but them, so there is
 * nothing to keep. A rule read from the funder's guidance is set aside —
 * marked rejected by this person, now — because it came with the funder's own
 * sentence, and "we read this and you said it was wrong" is worth keeping; it
 * is also what stops the review screen offering it again.
 */
export async function removeRule(
  tx: Queryable,
  criterionId: string,
  opportunityId: string,
  userId: string,
): Promise<'deleted' | 'set_aside' | null> {
  const owned = `opportunity_id = $2
    AND EXISTS (SELECT 1 FROM opportunities o WHERE o.id = $2 AND o.${MINE})`;

  const deleted = await tx.query<{ id: string }>(
    `DELETE FROM eligibility_criteria
      WHERE id = $1 AND proposed_by = 'user' AND ${owned}
      RETURNING id`,
    [criterionId, opportunityId],
  );
  if (deleted.rows.length === 1) return 'deleted';

  const setAside = await tx.query<{ id: string }>(
    `UPDATE eligibility_criteria
        SET verified_by = NULL, verified_at = NULL, rejected_by = $3, rejected_at = now()
      WHERE id = $1 AND verified_at IS NOT NULL AND ${owned}
      RETURNING id`,
    [criterionId, opportunityId, userId],
  );
  return setAside.rows.length === 1 ? 'set_aside' : null;
}
