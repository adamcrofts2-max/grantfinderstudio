/**
 * Whether the Writer can actually draft for this organisation.
 *
 * Shared by every surface that prices effort, because the tracker, the
 * calendar export and the opportunity assessment disagreeing about how fast
 * the work goes would be worse than any single one of them being wrong.
 *
 * "Available" is deliberately strict. The estimate is a promise about how long
 * something will take; a key that is missing, or whose last check failed, or a
 * fact base too thin to ground prose in, all mean the person writes it
 * themselves at the unassisted rate. Erring towards the slower number costs an
 * afternoon; erring towards the faster one costs a deadline.
 */

import { withAdmin } from '@/db';
import { countUsableFacts } from '@/db/tracker';
import type { Queryable } from '@/db/client';
import { draftingMode, unassistedReason, type DraftingCapability } from '@/domain/effort/model';
import { readCredentialStatuses } from '@/secrets/store';

/**
 * Is there a usable Anthropic key at all?
 *
 * Two ways in, and both must count: a key stored through Settings, or one
 * supplied to the process as ANTHROPIC_API_KEY — which is how a deployment
 * configures itself, and which the provider already falls back to.
 */
export async function isWriterAvailable(): Promise<boolean> {
  if ((process.env['ANTHROPIC_API_KEY'] ?? '') !== '') return true;

  try {
    return await withAdmin(async (tx) => {
      const { anthropic } = await readCredentialStatuses(tx);
      // Stored is not the same as working: a key whose last check failed
      // cannot draft anything.
      return anthropic.masked !== null && anthropic.lastCheckOk !== false;
    });
  } catch {
    // No encryption configured, no credentials table, no database — all of
    // them mean the same thing to the person doing the writing.
    return false;
  }
}

export interface Drafting extends DraftingCapability {
  mode: ReturnType<typeof draftingMode>;
  reason: ReturnType<typeof unassistedReason>;
}

/** The full picture, for a page that must both use it and explain it. */
export async function readDrafting(tx: Queryable): Promise<Drafting> {
  const capability: DraftingCapability = {
    writerAvailable: await isWriterAvailable(),
    usableFacts: await countUsableFacts(tx),
  };
  return {
    ...capability,
    mode: draftingMode(capability),
    reason: unassistedReason(capability),
  };
}
