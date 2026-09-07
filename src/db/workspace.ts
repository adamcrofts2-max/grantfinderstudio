/**
 * Read and write models for the organisation's knowledge and its applications.
 *
 * The load-bearing rule throughout: a fact is not usable until a person has
 * confirmed it. Extraction and register lookups both produce candidates; this
 * layer is where a human turns one into something the Writer may rely on.
 */

import type { Fact } from '../domain/provenance/facts.js';
import type { Confidence } from '../domain/provenance/facts.js';
import type { SourceType } from '../domain/types.js';
import type { Queryable } from './client.js';

interface FactRow {
  id: string;
  organisation_id: string;
  claim: string;
  value: string;
  source: SourceType;
  source_ref: string | null;
  source_span: string | null;
  retrieved_at: string;
  confidence_level: Confidence;
  confirmed_by: string | null;
  confirmed_at: string | null;
  superseded_by: string | null;
}

function toFact(row: FactRow): Fact {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    claim: row.claim,
    value: row.value,
    sourceType: row.source,
    sourceRef: row.source_ref,
    sourceSpan: row.source_span,
    retrievedAt: row.retrieved_at,
    confidence: row.confidence_level,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    supersededBy: row.superseded_by,
  };
}

const FACT_SELECT = `
  SELECT id, organisation_id, claim, value, source, source_ref, source_span,
         retrieved_at::text AS retrieved_at, confidence_level,
         confirmed_by, confirmed_at::text AS confirmed_at, superseded_by
  FROM facts
`;

/** Every fact still in play, newest first. Superseded ones are left out. */
export async function loadFacts(tx: Queryable): Promise<Fact[]> {
  const r = await tx.query<FactRow>(
    `${FACT_SELECT} WHERE superseded_by IS NULL ORDER BY confirmed_at NULLS FIRST, claim`,
  );
  return r.rows.map(toFact);
}

export async function confirmFact(
  tx: Queryable,
  factId: string,
  userId: string,
): Promise<void> {
  // Only ever set a confirmation, never move one: re-confirming must not
  // rewrite who originally checked it.
  await tx.query(
    `UPDATE facts SET confirmed_by = $2, confirmed_at = now()
     WHERE id = $1 AND confirmed_by IS NULL`,
    [factId, userId],
  );
}

/**
 * Correct a fact.
 *
 * The original is superseded rather than edited, so the record of what the
 * organisation believed, and when, survives. The replacement is confirmed by
 * the person making the correction — they are asserting it.
 */
export async function correctFact(
  tx: Queryable,
  factId: string,
  newValue: string,
  userId: string,
): Promise<void> {
  const existing = await tx.query<FactRow>(`${FACT_SELECT} WHERE id = $1`, [factId]);
  const original = existing.rows[0];
  if (!original) return;

  const replacementId = `${factId}_r${Date.now()}`;
  await tx.query(
    `INSERT INTO facts
       (id, organisation_id, claim, value, source, source_ref, source_span,
        retrieved_at, confidence_level, confirmed_by, confirmed_at)
     VALUES ($1, $2, $3, $4, 'user', $5, $6, now(), 'high', $7, now())`,
    [
      replacementId,
      original.organisation_id,
      original.claim,
      newValue,
      original.source_ref,
      original.source_span,
      userId,
    ],
  );
  await tx.query('UPDATE facts SET superseded_by = $2 WHERE id = $1', [
    factId,
    replacementId,
  ]);
}

export interface QuestionRow {
  id: string;
  position: number;
  question: string;
  word_limit: number | null;
  assesses: string | null;
}

export interface AnswerRow {
  question_id: string;
  content: string;
  word_count: number;
  updated_at: string;
}

export interface ApplicationView {
  id: string;
  status: string;
  amountRequestedGbp: number | null;
  opportunityTitle: string | null;
  funderName: string | null;
  deadline: string | null;
  questions: QuestionRow[];
  answers: Map<string, AnswerRow>;
}

export async function loadApplication(
  tx: Queryable,
  applicationId: string,
): Promise<ApplicationView | null> {
  const app = await tx.query<{
    id: string;
    status: string;
    amount_requested_gbp: string | null;
    title: string | null;
    funder_name: string | null;
    deadline: string | null;
  }>(
    `SELECT a.id, a.status, a.amount_requested_gbp::text AS amount_requested_gbp,
            o.title, f.name AS funder_name, o.deadline::text AS deadline
     FROM applications a
     LEFT JOIN opportunities o ON o.id = a.opportunity_id
     LEFT JOIN funders f ON f.id = o.funder_id
     WHERE a.id = $1`,
    [applicationId],
  );
  const row = app.rows[0];
  if (!row) return null;

  const questions = await tx.query<QuestionRow>(
    `SELECT id, position, question, word_limit, assesses
     FROM application_questions WHERE application_id = $1 ORDER BY position`,
    [applicationId],
  );

  const answers = await tx.query<AnswerRow>(
    `SELECT a.question_id, a.content, a.word_count, a.updated_at::text AS updated_at
     FROM answers a
     JOIN application_questions q ON q.id = a.question_id
     WHERE q.application_id = $1`,
    [applicationId],
  );

  return {
    id: row.id,
    status: row.status,
    amountRequestedGbp: row.amount_requested_gbp === null ? null : Number(row.amount_requested_gbp),
    opportunityTitle: row.title,
    funderName: row.funder_name,
    deadline: row.deadline,
    questions: questions.rows,
    answers: new Map(answers.rows.map((a) => [a.question_id, a])),
  };
}

export interface SavedAnswer {
  questionId: string;
  content: string;
  wordCount: number;
  /** One entry per claim: the fact behind it, or null when unsupported. */
  claims: Array<{ text: string; factId: string | null }>;
}

/**
 * Store a drafted answer with its provenance.
 *
 * Every version is kept, and the fact behind each claim is recorded, so the
 * interface can show where a sentence came from and an assessor's question can
 * be answered months later.
 */
export async function saveAnswer(
  tx: Queryable,
  organisationId: string,
  answer: SavedAnswer,
  createdBy: string | null,
): Promise<void> {
  const answerId = `ans_${answer.questionId}`;

  await tx.query(
    `INSERT INTO answers (id, organisation_id, question_id, content, word_count, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (question_id) DO UPDATE SET
       content = EXCLUDED.content,
       word_count = EXCLUDED.word_count,
       updated_at = now()`,
    [answerId, organisationId, answer.questionId, answer.content, answer.wordCount],
  );

  await tx.query(
    `INSERT INTO answer_versions (id, organisation_id, answer_id, content, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [`ver_${answer.questionId}_${Date.now()}`, organisationId, answerId, answer.content, createdBy],
  );

  // Replace the provenance for this answer with the current draft's.
  await tx.query('DELETE FROM answer_fact_refs WHERE answer_id = $1', [answerId]);
  for (const [index, claim] of answer.claims.entries()) {
    await tx.query(
      `INSERT INTO answer_fact_refs
         (id, organisation_id, answer_id, fact_id, claim_text, is_unsupported)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        `ref_${answer.questionId}_${index}`,
        organisationId,
        answerId,
        claim.factId,
        claim.text,
        claim.factId === null,
      ],
    );
  }
}

export interface ClaimRef {
  claimText: string;
  factId: string | null;
  isUnsupported: boolean;
}

export async function loadClaimRefs(
  tx: Queryable,
  questionId: string,
): Promise<ClaimRef[]> {
  const r = await tx.query<{ claim_text: string; fact_id: string | null; is_unsupported: boolean }>(
    `SELECT claim_text, fact_id, is_unsupported FROM answer_fact_refs
     WHERE answer_id = $1 ORDER BY id`,
    [`ans_${questionId}`],
  );
  return r.rows.map((row) => ({
    claimText: row.claim_text,
    factId: row.fact_id,
    isUnsupported: row.is_unsupported,
  }));
}

/** The application this organisation has already started for an opportunity. */
export async function findApplicationForOpportunity(
  tx: Queryable,
  opportunityId: string,
): Promise<{ id: string; status: string; answered: number; total: number } | null> {
  const r = await tx.query<{ id: string; status: string; answered: string; total: string }>(
    `SELECT a.id, a.status,
            count(ans.id)::text AS answered,
            count(q.id)::text AS total
     FROM applications a
     LEFT JOIN application_questions q ON q.application_id = a.id
     LEFT JOIN answers ans ON ans.question_id = q.id AND ans.content <> ''
     WHERE a.opportunity_id = $1
     GROUP BY a.id, a.status
     LIMIT 1`,
    [opportunityId],
  );
  const row = r.rows[0];
  return row
    ? { id: row.id, status: row.status, answered: Number(row.answered), total: Number(row.total) }
    : null;
}
