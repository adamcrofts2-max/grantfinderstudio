/**
 * Deciding what a newly extracted claim means against what is already known.
 *
 * Without this, the second document someone uploads makes the product worse:
 * every fact the first one established comes back as a peer candidate, the
 * confirmation list doubles, and the one thing that actually matters — that
 * this document disagrees with something you already confirmed — is buried in
 * the noise.
 *
 * Three outcomes, and the interesting one is the third:
 *
 *   duplicate    we already hold this claim at this value. Say nothing new.
 *   new          a claim we have never held. Offer it for confirmation.
 *   conflict     we hold this claim at a DIFFERENT value. A person must
 *                choose, and they cannot choose what they are not shown.
 *
 * Pure: no I/O, no model.
 */

import type { Fact } from './facts.js';

/**
 * Words that carry no meaning in a claim key.
 *
 * Kept deliberately short. Every word removed here is a chance to merge two
 * claims that are not the same, and a wrong merge loses a fact silently —
 * which is worse than showing a near-duplicate a person can dismiss.
 */
const CLAIM_STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'for', 'our', 'we', 'is', 'are',
  'number', 'total', 'count', 'amount', 'value',
]);

/**
 * Reduce a claim key to the tokens that carry its meaning.
 *
 * The model does not emit stable keys: reading the same sentence twice it
 * produced `incorporation_date` once and `date_of_incorporation` the next
 * time, and `workshops_delivered_in_2025` alongside
 * `number_of_workshops_delivered_in_2025`. Matching on the exact string let
 * both through, and the confirmation list — the hinge of the whole product —
 * filled with the same fact twice.
 *
 * Comparing the SET of meaningful tokens fixes both cases at once, and is
 * order-independent, which is the specific way the model varies.
 */
export function normaliseClaim(claim: string): string {
  const tokens = claim
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((token) => token !== '' && !CLAIM_STOPWORDS.has(token))
    // A crude singular form, so volunteer_count and number_of_volunteers meet.
    // It need not be linguistically right, only applied identically to both
    // sides of every comparison — "business" becoming "busines" costs nothing
    // as long as it always does.
    .map((token) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token));

  // Sorted and de-duplicated, so word order and repetition cannot matter.
  return [...new Set(tokens)].toSorted().join("_");
}

export interface CandidateClaim {
  claim: string;
  value: string;
  sourceSpan: string;
  confidence: 'high' | 'medium' | 'low';
}

export type ReconciliationKind = 'new' | 'duplicate' | 'conflict';

export interface Reconciliation {
  kind: ReconciliationKind;
  candidate: CandidateClaim;
  /** The fact already held, for a duplicate or a conflict. */
  existing: Fact | null;
}

/**
 * Compare two recorded values for sameness.
 *
 * Deliberately conservative. "£148,000" and "148,000 pounds" are the same
 * turnover and must not become a conflict a person has to adjudicate; but
 * "12 volunteers" and "12 staff" are different claims and must stay that way.
 * So this normalises presentation — case, currency, separators, padding — and
 * nothing else.
 */
export function sameValue(a: string, b: string): boolean {
  const left = normaliseValue(a);
  const right = normaliseValue(b);
  if (left === right) return true;

  // Where both sides are purely numeric, compare as numbers so 148000 and
  // 148,000.00 agree.
  const leftNumber = asNumber(left);
  const rightNumber = asNumber(right);
  return leftNumber !== null && rightNumber !== null && leftNumber === rightNumber;
}

function normaliseValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[£$€]/gu, '')
    // Words that only ever describe the currency of a number beside them.
    .replace(/\b(gbp|pounds?|sterling)\b/gu, '')
    .replace(/,(?=\d{3}\b)/gu, '')
    .replace(/[\s ]+/gu, ' ')
    .replace(/[.,;:]+$/u, '')
    .trim();
}

function asNumber(value: string): number | null {
  if (!/^-?\d+(?:\.\d+)?$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Classify candidates against the facts already held.
 *
 * `existing` should be the facts still in play — superseded ones are history
 * and must not generate a conflict, or correcting a fact would make every
 * later document argue with the version you already replaced.
 *
 * A confirmed fact outranks an unconfirmed one when both match the claim, so
 * a conflict is reported against what the organisation actually stands behind.
 */
export function reconcile(
  candidates: readonly CandidateClaim[],
  existing: readonly Fact[],
): Reconciliation[] {
  const live = existing.filter((fact) => fact.supersededBy === null);

  const byClaim = new Map<string, Fact[]>();
  for (const fact of live) {
    const key = normaliseClaim(fact.claim);
    const list = byClaim.get(key) ?? [];
    list.push(fact);
    byClaim.set(key, list);
  }
  // Confirmed first, so a conflict is reported against the confirmed value.
  for (const list of byClaim.values()) {
    list.sort((a, b) => Number(b.confirmedBy !== null) - Number(a.confirmedBy !== null));
  }

  const results: Reconciliation[] = [];
  // Candidates are also compared against each other: one document can state
  // the same figure twice, and offering it twice is the same noise.
  const acceptedThisRun = new Map<string, CandidateClaim[]>();

  for (const candidate of candidates) {
    const key = normaliseClaim(candidate.claim);
    const held = byClaim.get(key) ?? [];
    const alsoThisRun = acceptedThisRun.get(key) ?? [];

    const match = held.find((fact) => sameValue(fact.value, candidate.value));
    if (match !== undefined) {
      results.push({ kind: 'duplicate', candidate, existing: match });
      continue;
    }
    if (alsoThisRun.some((other) => sameValue(other.value, candidate.value))) {
      results.push({ kind: 'duplicate', candidate, existing: null });
      continue;
    }

    const conflicting = held[0];
    results.push(
      conflicting === undefined
        ? { kind: 'new', candidate, existing: null }
        : { kind: 'conflict', candidate, existing: conflicting },
    );
    acceptedThisRun.set(key, [...alsoThisRun, candidate]);
  }

  return results;
}

export interface ReconciliationSummary {
  added: number;
  conflicts: number;
  alreadyKnown: number;
}

export function summarise(results: readonly Reconciliation[]): ReconciliationSummary {
  return {
    added: results.filter((r) => r.kind === 'new').length,
    conflicts: results.filter((r) => r.kind === 'conflict').length,
    alreadyKnown: results.filter((r) => r.kind === 'duplicate').length,
  };
}

/** The candidates worth storing: everything a person still has to decide on. */
export function toStore(results: readonly Reconciliation[]): Reconciliation[] {
  return results.filter((r) => r.kind !== 'duplicate');
}
