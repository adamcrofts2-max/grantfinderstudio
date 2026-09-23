/**
 * What each sentence of a draft stands on, in words.
 *
 * ## The promise this keeps
 *
 * The landing page shows a draft with every sentence followed by the fact it
 * rests on — "Beneficiary groups · confirmed" — and any sentence without one
 * flagged. The product drafted exactly that way and then showed one count line
 * ("all 2 claims traced") with the provenance hidden in hover tooltips, which
 * a phone never shows and nobody finds on a laptop. The thing the product is
 * for was there and invisible.
 *
 * Pure, and resolved against the fact base by whoever has it — the page or
 * the draft action — so a draft just written and the same draft read back
 * tomorrow are labelled by the same rules. That was the lesson of
 * `claimStanding`: two files deciding the same thing will eventually disagree.
 */

import { readableClaim } from './self-declared.js';
import { usableFacts, type ClaimStanding, type Fact } from './facts.js';

export type SentenceTone = 'supported' | 'unsupported' | 'join';

export interface SentenceLabel {
  tone: SentenceTone;
  text: string;
}

/**
 * The name of the confirmed fact a sentence cites, or null.
 *
 * Matches the id or the claim, because `claimStanding` accepts either — a
 * resolver that matched only ids would label as unnamed a sentence the
 * standing check had just called supported.
 */
export function citedFactClaim(factId: string | null, facts: readonly Fact[]): string | null {
  if (factId === null) return null;
  const fact = usableFacts(facts).find((f) => f.id === factId || f.claim === factId);
  return fact?.claim ?? null;
}

export function sentenceLabel(standing: ClaimStanding, factClaim: string | null): SentenceLabel {
  switch (standing) {
    case 'supported':
      return {
        tone: 'supported',
        text: `${factClaim === null ? 'A confirmed fact' : readableClaim(factClaim)} · confirmed`,
      };
    case 'unsupported':
      // It cites something, and that something is not a confirmed fact —
      // never confirmed, or corrected since the draft was written.
      return {
        tone: 'unsupported',
        text: 'No confirmed fact behind this',
      };
    case 'no_claim':
      // The Writer is told to leave these uncited. Saying so, quietly, is
      // what stops a reader wondering whether the label fell off.
      return { tone: 'join', text: 'States no fact, so nothing to evidence' };
  }
}
