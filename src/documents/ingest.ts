/**
 * Ingesting an uploaded document.
 *
 * parse → chunk → extract → reconcile → store, in that order, with the whole
 * of it arranged so that the worst case is a bad suggestion a person declines.
 *
 * The security position, stated once: the file is untrusted, the text drawn
 * from it is untrusted, and the model is pointed at that text behind the
 * fence in src/ai/untrusted.ts. Anything in the document that addressed the
 * model is surfaced to the user rather than swallowed — an injection attempt
 * is a fact about the document, and the person who uploaded it should be told.
 *
 * The AI call is injected rather than constructed here, so the pipeline can be
 * tested end to end without a network.
 */

import { EXTRACTOR, type ExtractorOutput } from '../ai/agents/extractor.js';
import { buildExtractorPrompt } from '../ai/agents/extractor.js';
import { runAgent } from '../ai/run.js';
import type { AiProvider } from '../ai/types.js';
import type { Fact } from '../domain/provenance/facts.js';
import {
  reconcile,
  summarise,
  type CandidateClaim,
  type Reconciliation,
  type ReconciliationSummary,
} from '../domain/provenance/reconcile.js';
import { batchChunks, chunkPages, renderBatch, type Chunk } from './chunk.js';
import { parseDocument, type ParsedDocument } from './parse.js';

/** Runs the Extractor over one batch of text. Injected so tests need no network. */
export type ExtractFn = (text: string, label: string) => Promise<ExtractorOutput>;

export function extractorFor(provider: AiProvider): ExtractFn {
  return async (text, label) => {
    const result = await runAgent(provider, EXTRACTOR, buildExtractorPrompt(text, label));
    return result.output;
  };
}

export interface IngestInput {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  /** Facts the organisation already holds, for reconciliation. */
  existingFacts: readonly Fact[];
}

export interface IngestResult {
  parsed: ParsedDocument;
  chunks: Chunk[];
  results: Reconciliation[];
  summary: ReconciliationSummary;
  /** Text in the document that addressed the model rather than describing the CIC. */
  instructionLikeContent: string[];
  /** Batches sent to the model, for the record. */
  batches: number;
}

/**
 * Read a document and work out what it would add.
 *
 * Nothing is written here — the caller decides what to persist, inside its own
 * transaction. Keeping the reading and the writing apart is what lets a failed
 * extraction leave no half-ingested document behind.
 */
export async function ingestDocument(
  input: IngestInput,
  extract: ExtractFn,
): Promise<IngestResult> {
  const parsed = await parseDocument(input.bytes, input.filename, input.mimeType);
  const chunks = chunkPages(parsed.pages);
  const batches = batchChunks(chunks);

  const candidates: CandidateClaim[] = [];
  const instructionLikeContent: string[] = [];

  for (const [index, batch] of batches.entries()) {
    const label =
      batches.length === 1
        ? input.filename
        : `${input.filename} (part ${index + 1} of ${batches.length})`;
    // Sequential on purpose. Firing every batch at once would hit provider
    // rate limits on exactly the documents worth reading — the long ones —
    // and would make the order candidates arrive in, and so which duplicate
    // survives reconciliation, depend on network timing.
    // eslint-disable-next-line no-await-in-loop
    const output = await extract(renderBatch(batch), label);
    candidates.push(...output.facts);
    instructionLikeContent.push(...output.instructionLikeContent);
  }

  // Reconciled once, against everything already held, rather than per batch:
  // two batches of the same document must not each offer the same figure.
  const results = reconcile(candidates, input.existingFacts);

  return {
    parsed,
    chunks,
    results,
    summary: summarise(results),
    instructionLikeContent: [...new Set(instructionLikeContent)],
    batches: batches.length,
  };
}
