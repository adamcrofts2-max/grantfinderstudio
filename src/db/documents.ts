/**
 * Persistence for uploaded documents and the facts drawn from them.
 *
 * The invariant this layer exists to hold: extraction can only ever produce
 * UNCONFIRMED facts. There is no parameter here that would let a caller
 * insert a confirmed one, in the same way `toCandidateFacts` hard-codes
 * `confirmedBy: null`. A person confirms; a model suggests.
 */

import type { Chunk } from '../documents/chunk.js';
import type { Reconciliation } from '../domain/provenance/reconcile.js';
import type { Queryable } from './client.js';

export type ExtractionState = 'pending' | 'extracted' | 'failed';

export interface DocumentRecord {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  extractionState: ExtractionState;
  extractionNote: string | null;
  pageCount: number | null;
  characterCount: number | null;
  truncated: boolean;
  instructionLikeContent: string[];
  createdAt: string;
  extractedAt: string | null;
  /** Candidate facts still awaiting a decision. */
  pendingFacts: number;
  /** Facts from this document a person has confirmed. */
  confirmedFacts: number;
}

interface DocumentRow {
  id: string;
  filename: string;
  mime_type: string;
  byte_size: string;
  extraction_state: ExtractionState;
  extraction_note: string | null;
  page_count: number | null;
  character_count: number | null;
  truncated: boolean;
  instruction_like_content: string[];
  created_at: string;
  extracted_at: string | null;
  pending_facts: string;
  confirmed_facts: string;
}

function toRecord(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    extractionState: row.extraction_state,
    extractionNote: row.extraction_note,
    pageCount: row.page_count,
    characterCount: row.character_count,
    truncated: row.truncated,
    instructionLikeContent: row.instruction_like_content ?? [],
    createdAt: row.created_at,
    extractedAt: row.extracted_at,
    pendingFacts: Number(row.pending_facts),
    confirmedFacts: Number(row.confirmed_facts),
  };
}

/**
 * The source_ref every fact from this document carries.
 *
 * One shape, used on the way in and on the way out, so a fact can always be
 * traced back to the file it came from.
 */
export function documentRef(documentId: string): string {
  return `document:${documentId}`;
}

const DOCUMENT_SELECT = `
  SELECT d.id, d.filename, d.mime_type, d.byte_size::text AS byte_size,
         d.extraction_state, d.extraction_note, d.page_count, d.character_count,
         d.truncated, d.instruction_like_content,
         d.created_at::text AS created_at, d.extracted_at::text AS extracted_at,
         count(f.id) FILTER (
           WHERE f.confirmed_by IS NULL AND f.superseded_by IS NULL
         )::text AS pending_facts,
         count(f.id) FILTER (WHERE f.confirmed_by IS NOT NULL)::text AS confirmed_facts
  FROM documents d
  LEFT JOIN facts f ON f.source_ref = 'document:' || d.id
`;

export async function loadDocuments(tx: Queryable): Promise<DocumentRecord[]> {
  const r = await tx.query<DocumentRow>(
    `${DOCUMENT_SELECT} GROUP BY d.id ORDER BY d.created_at DESC`,
  );
  return r.rows.map(toRecord);
}

export async function loadDocument(
  tx: Queryable,
  documentId: string,
): Promise<DocumentRecord | null> {
  const r = await tx.query<DocumentRow>(
    `${DOCUMENT_SELECT} WHERE d.id = $1 GROUP BY d.id`,
    [documentId],
  );
  const row = r.rows[0];
  return row === undefined ? null : toRecord(row);
}

export interface NewDocument {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  pageCount: number | null;
  characterCount: number;
  truncated: boolean;
}

/** Record the upload before extraction runs, so nothing is lost mid-flight. */
export async function createDocument(
  tx: Queryable,
  organisationId: string,
  document: NewDocument,
  uploadedBy: string | null,
): Promise<void> {
  await tx.query(
    `INSERT INTO documents
       (id, organisation_id, filename, mime_type, byte_size, storage_key,
        page_count, character_count, truncated, uploaded_by, extraction_state)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, 'pending')`,
    [
      document.id,
      organisationId,
      document.filename,
      document.mimeType,
      document.byteSize,
      document.pageCount,
      document.characterCount,
      document.truncated,
      uploadedBy,
    ],
  );
}

export async function saveChunks(
  tx: Queryable,
  organisationId: string,
  documentId: string,
  chunks: readonly Chunk[],
): Promise<void> {
  for (const chunk of chunks) {
    await tx.query(
      `INSERT INTO document_chunks
         (id, organisation_id, document_id, chunk_index, content, page_number)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (document_id, chunk_index) DO NOTHING`,
      [
        `chunk_${documentId}_${chunk.index}`,
        organisationId,
        documentId,
        chunk.index,
        chunk.content,
        chunk.pageNumber,
      ],
    );
  }
}

/**
 * Store the candidates a person still has to decide on.
 *
 * Every row lands unconfirmed. `confirmed_by` and `confirmed_at` are not
 * parameters of this function and never will be.
 */
export async function saveCandidateFacts(
  tx: Queryable,
  organisationId: string,
  documentId: string,
  results: readonly Reconciliation[],
): Promise<number> {
  let stored = 0;
  for (const [index, result] of results.entries()) {
    if (result.kind === 'duplicate') continue;
    await tx.query(
      `INSERT INTO facts
         (id, organisation_id, claim, value, source, source_ref, source_span,
          retrieved_at, confidence_level)
       VALUES ($1, $2, $3, $4, 'document', $5, $6, now(), $7)`,
      [
        `fact_${documentId}_${index}`,
        organisationId,
        result.candidate.claim,
        result.candidate.value,
        documentRef(documentId),
        result.candidate.sourceSpan,
        result.candidate.confidence,
      ],
    );
    stored += 1;
  }
  return stored;
}

export async function markExtracted(
  tx: Queryable,
  documentId: string,
  instructionLikeContent: readonly string[],
): Promise<void> {
  await tx.query(
    `UPDATE documents
     SET extraction_state = 'extracted', extracted_at = now(),
         instruction_like_content = $2, extraction_note = NULL
     WHERE id = $1`,
    [documentId, instructionLikeContent],
  );
}

export async function markFailed(
  tx: Queryable,
  documentId: string,
  note: string,
): Promise<void> {
  await tx.query(
    `UPDATE documents SET extraction_state = 'failed', extraction_note = $2 WHERE id = $1`,
    [documentId, note],
  );
}

/**
 * Remove a document, its text, and any of its facts nobody has confirmed.
 *
 * Confirmed facts survive on purpose. Once a person has said "yes, that is
 * true of us", the claim is theirs and not the file's; deleting it because
 * the source document was tidied away would silently empty the fact base an
 * application is grounded in. The fact keeps its source_ref, so its
 * provenance still records where it was first seen.
 */
export async function deleteDocument(tx: Queryable, documentId: string): Promise<void> {
  await tx.query(
    `DELETE FROM facts
     WHERE source_ref = $1 AND confirmed_by IS NULL AND superseded_by IS NULL`,
    [documentRef(documentId)],
  );
  await tx.query('DELETE FROM documents WHERE id = $1', [documentId]);
}
