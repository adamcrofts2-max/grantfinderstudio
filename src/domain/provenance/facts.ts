/**
 * Fact lifecycle and provenance.
 *
 * Provenance is not metadata bolted onto this product — it is the schema. A
 * funding application is a set of claims a funder will hold the organisation
 * to, so every claim must trace to something a human confirmed.
 *
 * Facts are append-only. A correction supersedes the old fact rather than
 * overwriting it, so the history of what the organisation believed, and when,
 * survives intact.
 */

import type { SourceType } from '../types.js';

export type Confidence = 'high' | 'medium' | 'low';

export interface Fact {
  id: string;
  organisationId: string;
  /** What this fact is about, e.g. "annual_turnover". Stable key for lookup. */
  claim: string;
  value: string;
  sourceType: SourceType;
  /** Document id, URL or API endpoint the value came from. */
  sourceRef: string | null;
  /** The exact span quoted from the source, for audit and display. */
  sourceSpan: string | null;
  /** ISO timestamp the value was obtained. */
  retrievedAt: string;
  confidence: Confidence;
  /** User id who confirmed this fact. Null means unconfirmed. */
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** Id of the fact that replaced this one. Null means still current. */
  supersededBy: string | null;
}

export function isConfirmed(fact: Fact): boolean {
  return fact.confirmedBy !== null;
}

export function isCurrent(fact: Fact): boolean {
  return fact.supersededBy === null;
}

/**
 * Whether a fact may be used to ground generated prose.
 *
 * This is the gate that stops the writer asserting things nobody checked.
 * Unconfirmed extractions and superseded values are both excluded.
 */
export function isUsableForGeneration(fact: Fact): boolean {
  return isConfirmed(fact) && isCurrent(fact);
}

/** Facts that are still current, indexed by claim. */
export function currentFactsByClaim(facts: readonly Fact[]): Map<string, Fact> {
  const map = new Map<string, Fact>();
  for (const fact of facts) {
    if (!isCurrent(fact)) continue;
    const existing = map.get(fact.claim);
    // Later retrieval wins when two current facts share a claim.
    if (!existing || fact.retrievedAt > existing.retrievedAt) {
      map.set(fact.claim, fact);
    }
  }
  return map;
}

/** Confirmed, current facts only — the set available to the writer. */
export function usableFacts(facts: readonly Fact[]): Fact[] {
  return facts.filter(isUsableForGeneration);
}

/**
 * Record a human confirmation.
 *
 * Returns a new object; the input is never mutated. Confirming an already
 * confirmed fact is a no-op so that repeated clicks cannot rewrite history.
 */
export function confirm(fact: Fact, userId: string, at: string): Fact {
  if (isConfirmed(fact)) return fact;
  return { ...fact, confirmedBy: userId, confirmedAt: at };
}

/**
 * Replace a fact with a corrected one.
 *
 * Returns both records: the original marked superseded, and the replacement.
 * Callers persist both — the old row is never deleted or edited in place.
 */
export function supersede(
  original: Fact,
  replacement: Omit<Fact, 'supersededBy'>,
): { superseded: Fact; replacement: Fact } {
  return {
    superseded: { ...original, supersededBy: replacement.id },
    replacement: { ...replacement, supersededBy: null },
  };
}

/** A claim made in generated prose, resolved against the fact base. */
export interface ClaimReference {
  /** The sentence or clause asserting something. */
  text: string;
  /** Claim key this text depends on, or null if it asserts nothing factual. */
  claim: string | null;
}

export interface GroundingResult {
  supported: Array<{ text: string; fact: Fact }>;
  /** Claims with no confirmed, current fact behind them. */
  unsupported: Array<{ text: string; claim: string }>;
}

/**
 * Check generated prose against the fact base.
 *
 * Anything unsupported is returned rather than silently accepted, so the UI
 * can mark it visibly. A plausible sentence with nothing behind it is the
 * failure mode this product exists to avoid.
 */
export function groundClaims(
  references: readonly ClaimReference[],
  facts: readonly Fact[],
): GroundingResult {
  const available = currentFactsByClaim(usableFacts(facts));
  const supported: GroundingResult['supported'] = [];
  const unsupported: GroundingResult['unsupported'] = [];

  for (const ref of references) {
    if (ref.claim === null) continue;
    const fact = available.get(ref.claim);
    if (fact) supported.push({ text: ref.text, fact });
    else unsupported.push({ text: ref.text, claim: ref.claim });
  }

  return { supported, unsupported };
}

/**
 * Where one drafted sentence stands against the fact base.
 *
 * Three states, not two, and conflating the middle one with the last is a bug
 * this product had in front of a user:
 *
 *  - `supported` — cites a fact that is confirmed, current and still there.
 *  - `unsupported` — cites a fact that does NOT resolve. A draft is refused
 *    outright if the model cites something never supplied, so this is the
 *    narrower case of a fact that has since been corrected or withdrawn,
 *    leaving a saved answer standing on it.
 *  - `no_claim` — cites nothing, because it asserts nothing factual. The
 *    Writer's own instructions say so: "A sentence that asserts nothing
 *    factual sets factId to null." Linking sentences are not a defect; prose
 *    without them is a list.
 *
 * ## The bug this closes
 *
 * The workspace counted every `factId === null` as unsupported — highlighted
 * it, warned that "an assessor will ask", and put the number on the copy
 * button — while `groundClaims` skipped those sentences and the action
 * therefore reported "every claim traced to a confirmed fact". One card said
 * both things at once, which is the worst possible fault in a product whose
 * entire claim is honest provenance. And it would have happened on nearly
 * every real draft, because good prose has connecting sentences.
 */
export type ClaimStanding = 'supported' | 'unsupported' | 'no_claim';

export function claimStanding(
  factId: string | null,
  facts: readonly Fact[],
): ClaimStanding {
  if (factId === null) return 'no_claim';
  const available = usableFacts(facts);
  return available.some((fact) => fact.id === factId || fact.claim === factId)
    ? 'supported'
    : 'unsupported';
}

/** How many sentences are standing on nothing. Never counts `no_claim`. */
export function countUnsupported(
  standings: readonly ClaimStanding[],
): number {
  return standings.filter((standing) => standing === 'unsupported').length;
}
