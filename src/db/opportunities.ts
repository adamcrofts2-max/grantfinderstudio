/**
 * Opportunities the applicant brought in themselves.
 *
 * Stored so they can never be mistaken for register data: `origin` records
 * where they came from, `source_text` keeps the guidance they were read from,
 * and every criterion arrives unverified with the wording it was drawn from.
 *
 * The engine sees a criterion only after a person has verified it — that
 * filter lives in `loadCriteria`, and it is what stops the model deciding
 * anybody's eligibility.
 */

import { paramsForKind, type AnalystOutput } from '../ai/agents/analyst.js';
import type { Queryable } from './client.js';

export interface StoredOpportunity {
  id: string;
  funderId: string;
}

/**
 * Find or create the funder by name.
 *
 * Matched case-insensitively, because the alternative — a new funder row per
 * pasted page — would fragment the award history that makes funder behaviour
 * worth anything.
 *
 * Runs on the ADMIN path, not the tenant one. `funders` is shared reference
 * data that award history hangs off, and granting every tenant write access to
 * it so they can paste a fund would be a poor trade. The cost is that a funder
 * row can outlive a failed opportunity insert; a funder with no opportunities
 * is harmless and will be reused by the next paste.
 */
export async function ensureFunder(
  tx: Queryable,
  name: string,
  organisationId: string,
): Promise<string> {
  const existing = await tx.query<{ id: string }>(
    'SELECT id FROM funders WHERE lower(name) = lower($1) LIMIT 1',
    [name],
  );
  const found = existing.rows[0];
  if (found !== undefined) return found.id;

  const id = `funder_user_${organisationId}_${Date.now().toString(36)}`;
  await tx.query('INSERT INTO funders (id, name) VALUES ($1, $2)', [id, name]);
  return id;
}

export interface PastedOpportunity {
  analysis: AnalystOutput;
  /** From `ensureFunder`, which runs on the admin path. */
  funderId: string;
  /** The guidance the analysis was read from, kept for provenance. */
  sourceText: string;
  sourceUrl: string | null;
}

/**
 * Store a pasted opportunity and its proposed criteria.
 *
 * `freshness_state` is `needs_verification` and not negotiable: the applicant
 * pasted a page at a moment in time, and we have no way to know it is still
 * current. `verified_at` on the opportunity stays null for the same reason.
 */
export async function createPastedOpportunity(
  tx: Queryable,
  organisationId: string,
  pasted: PastedOpportunity,
): Promise<StoredOpportunity> {
  const { analysis, funderId } = pasted;
  const id = `opp_user_${Date.now().toString(36)}`;

  await tx.query(
    `INSERT INTO opportunities
       (id, funder_id, title, summary, min_amount_gbp, max_amount_gbp, jurisdiction,
        deadline, deadline_kind, freshness_state, source_url, retrieved_at,
        origin, added_by_organisation_id, source_text, instruction_like_content)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'needs_verification', $10, now(),
             'user', $11, $12, $13)`,
    [
      id,
      funderId,
      analysis.title,
      analysis.summary,
      analysis.minAmountGbp,
      analysis.maxAmountGbp,
      analysis.jurisdiction,
      analysis.deadline,
      analysis.deadlineKind,
      pasted.sourceUrl,
      organisationId,
      pasted.sourceText,
      analysis.instructionLikeContent,
    ],
  );

  for (const [index, criterion] of analysis.criteria.entries()) {
    await tx.query(
      `INSERT INTO eligibility_criteria
         (id, opportunity_id, kind, label, params, cic_handling, source_span, proposed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ai_extraction')`,
      [
        `crit_${id}_${index}`,
        id,
        criterion.kind,
        criterion.label,
        // Narrowed to the keys this kind uses, so the criteria mapper sees
        // exactly the shape it validates and nothing else.
        JSON.stringify(paramsForKind(criterion.kind, criterion.params)),
        criterion.kind === 'legal_form' ? criterion.cicTreatment : null,
        criterion.sourceSpan,
      ],
    );
  }

  return { id, funderId };
}

/**
 * Accept a proposed criterion, which is what lets the engine use it.
 *
 * Only ever sets a verification, never moves one, for the same reason fact
 * confirmation does not: re-verifying must not rewrite who originally checked.
 */
export async function verifyCriterion(
  tx: Queryable,
  criterionId: string,
  userId: string,
): Promise<void> {
  await tx.query(
    `UPDATE eligibility_criteria
     SET verified_by = $2, verified_at = now()
     WHERE id = $1 AND verified_at IS NULL AND rejected_at IS NULL`,
    [criterionId, userId],
  );
}

/**
 * Reject a proposed criterion the funder's guidance does not actually say.
 *
 * Kept rather than deleted: what the model got wrong is worth being able to
 * look at later, and a rejected criterion must not be proposed again.
 */
export async function rejectCriterion(
  tx: Queryable,
  criterionId: string,
  userId: string,
): Promise<void> {
  await tx.query(
    `UPDATE eligibility_criteria
     SET rejected_by = $2, rejected_at = now()
     WHERE id = $1 AND verified_at IS NULL AND rejected_at IS NULL`,
    [criterionId, userId],
  );
}

export interface OpportunityReview {
  id: string;
  title: string;
  funderName: string;
  summary: string | null;
  deadline: string | null;
  deadlineKind: string;
  minAmountGbp: number | null;
  maxAmountGbp: number | null;
  jurisdiction: string | null;
  origin: string;
  sourceUrl: string | null;
  instructionLikeContent: string[];
  verifiedCount: number;
  proposedCount: number;
  rejectedCount: number;
}

export async function loadOpportunityReview(
  tx: Queryable,
  opportunityId: string,
): Promise<OpportunityReview | null> {
  const r = await tx.query<{
    id: string;
    title: string;
    funder_name: string;
    summary: string | null;
    deadline: string | null;
    deadline_kind: string;
    min_amount_gbp: string | null;
    max_amount_gbp: string | null;
    jurisdiction: string | null;
    origin: string;
    source_url: string | null;
    instruction_like_content: string[];
    verified_count: string;
    proposed_count: string;
    rejected_count: string;
  }>(
    `SELECT o.id, o.title, f.name AS funder_name, o.summary,
            o.deadline::text AS deadline, o.deadline_kind::text AS deadline_kind,
            o.min_amount_gbp::text AS min_amount_gbp,
            o.max_amount_gbp::text AS max_amount_gbp,
            o.jurisdiction::text AS jurisdiction, o.origin::text AS origin,
            o.source_url, o.instruction_like_content,
            count(c.id) FILTER (WHERE c.verified_at IS NOT NULL)::text AS verified_count,
            count(c.id) FILTER (
              WHERE c.verified_at IS NULL AND c.rejected_at IS NULL
            )::text AS proposed_count,
            count(c.id) FILTER (WHERE c.rejected_at IS NOT NULL)::text AS rejected_count
     FROM opportunities o
     JOIN funders f ON f.id = o.funder_id
     LEFT JOIN eligibility_criteria c ON c.opportunity_id = o.id
     WHERE o.id = $1
     GROUP BY o.id, f.name`,
    [opportunityId],
  );
  const row = r.rows[0];
  if (row === undefined) return null;

  return {
    id: row.id,
    title: row.title,
    funderName: row.funder_name,
    summary: row.summary,
    deadline: row.deadline,
    deadlineKind: row.deadline_kind,
    minAmountGbp: row.min_amount_gbp === null ? null : Number(row.min_amount_gbp),
    maxAmountGbp: row.max_amount_gbp === null ? null : Number(row.max_amount_gbp),
    jurisdiction: row.jurisdiction,
    origin: row.origin,
    sourceUrl: row.source_url,
    instructionLikeContent: row.instruction_like_content ?? [],
    verifiedCount: Number(row.verified_count),
    proposedCount: Number(row.proposed_count),
    rejectedCount: Number(row.rejected_count),
  };
}

/** Remove a pasted opportunity, its criteria, and nothing anyone else added. */
export async function deletePastedOpportunity(
  tx: Queryable,
  opportunityId: string,
  organisationId: string,
): Promise<void> {
  await tx.query(
    `DELETE FROM opportunities
     WHERE id = $1 AND origin = 'user' AND added_by_organisation_id = $2`,
    [opportunityId, organisationId],
  );
}
