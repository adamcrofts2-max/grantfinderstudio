'use server';

import { revalidatePath } from 'next/cache';

import { getDatabase } from '@/db';
import { requireOrganisationId } from '@/app/session';
import {
  createDocument,
  deleteDocument,
  markExtracted,
  markFailed,
  saveCandidateFacts,
  saveChunks,
} from '@/db/documents';
import { loadFacts } from '@/db/workspace';

import { createProvider } from '@/ai/providers/anthropic';
import { extractorFor, ingestDocument } from '@/documents/ingest';
import { UPLOAD_LIMITS } from '@/documents/accepted';
import { DocumentError } from '@/documents/parse';
import { isWriterAvailable } from '@/app/drafting';
import type { UploadState } from './state';

/**
 * Read an uploaded document and offer what it found.
 *
 * Ordering matters here and is deliberate:
 *
 *   1. Parse and extract BEFORE touching the database. A file we cannot read,
 *      or a model call that fails, then leaves nothing behind — no orphan row
 *      for the user to wonder about.
 *   2. Write the document, its text and its candidate facts in ONE
 *      transaction, so a document can never exist with half its facts.
 *
 * Nothing this function can do produces a confirmed fact.
 */
export async function uploadDocumentAction(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const organisationId = await requireOrganisationId();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose a file to upload.' };
  }
  if (file.size > UPLOAD_LIMITS.maxBytes) {
    return {
      ok: false,
      message: `That file is larger than ${UPLOAD_LIMITS.maxBytes / (1024 * 1024)} MB.`,
    };
  }

  if (!(await isWriterAvailable())) {
    return {
      ok: false,
      message:
        'Reading a document needs an Anthropic key. Add one in Settings and try again — nothing has been uploaded.',
    };
  }

  const created = createProvider();
  if (!created.available) return { ok: false, message: created.reason };

  const database = await getDatabase();
  const existingFacts = await database.withTenant(organisationId, (tx) => loadFacts(tx));

  const bytes = new Uint8Array(await file.arrayBuffer());
  const documentId = `doc_${Date.now().toString(36)}`;

  let ingested;
  try {
    ingested = await ingestDocument(
      { bytes, filename: file.name, mimeType: file.type, existingFacts },
      extractorFor(created.provider),
    );
  } catch (error) {
    if (error instanceof DocumentError) return { ok: false, message: error.message };
    // Anything else is ours, not the user's. Say so without a stack trace.
    return {
      ok: false,
      message: 'We could not read that document. Nothing has been saved — please try again.',
    };
  }

  try {
    await database.withTenant(organisationId, async (tx) => {
      await createDocument(
        tx,
        organisationId,
        {
          id: documentId,
          filename: file.name,
          mimeType: file.type,
          byteSize: file.size,
          pageCount: ingested.parsed.pageCount,
          characterCount: ingested.parsed.characters,
          truncated: ingested.parsed.truncated,
        },
        null,
      );
      await saveChunks(tx, organisationId, documentId, ingested.chunks);
      await saveCandidateFacts(tx, organisationId, documentId, ingested.results);
      await markExtracted(tx, documentId, ingested.instructionLikeContent);
    });
  } catch {
    // The document row may or may not exist; mark it failed if it does, so a
    // half-written upload is visible rather than silently absent.
    await database
      .withTenant(organisationId, (tx) =>
        markFailed(tx, documentId, 'Saving what we read from this document failed.'),
      )
      .catch(() => undefined);
    return { ok: false, message: 'We read the document but could not save it. Please try again.' };
  }

  revalidatePath('/documents');
  revalidatePath('/organisation');
  revalidatePath('/tracker');

  const { added, conflicts, alreadyKnown } = ingested.summary;
  return {
    ok: true,
    message: `Read ${file.name}.`,
    added,
    conflicts,
    alreadyKnown,
    injected: ingested.instructionLikeContent.length,
  };
}

export async function deleteDocumentAction(formData: FormData): Promise<void> {
  const organisationId = await requireOrganisationId();
  const id = String(formData.get('documentId') ?? '');
  if (id === '') return;

  const database = await getDatabase();
  await database.withTenant(organisationId, (tx) => deleteDocument(tx, id));
  revalidatePath('/documents');
  revalidatePath('/organisation');
}
