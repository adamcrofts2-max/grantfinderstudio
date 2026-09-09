/**
 * Facts a person types about their own organisation.
 *
 * The normal route to a fact is extraction: a document is read, candidates are
 * proposed with the sentence they came from, and a person confirms them. That
 * needs a model, and a deployment without one had no route to a fact at all —
 * which made the Writer permanently unreachable and the setup guide's third
 * step impossible to finish.
 *
 * A typed fact is weaker evidence than an extracted one, and the difference is
 * kept rather than smoothed over: its source is `user`, it has no source span,
 * and the interface says "you told us". What it is NOT is second class in the
 * one way that would matter — the Writer may ground an answer in it, because
 * the person who typed it is the person who would have confirmed it anyway.
 *
 * Pure and zero I/O, like the rest of the domain.
 */

import { CLAIM_VOCABULARY } from '../../ai/agents/extractor.js';

/**
 * The claims worth offering as a list, in the order a person would think of
 * them. Drawn from the extraction vocabulary so a typed fact and a read one
 * land on the same key rather than becoming two facts about the same thing.
 */
export const SUGGESTED_CLAIMS = [
  'mission',
  'area_of_operation',
  'beneficiary_groups',
  'programme_description',
  'annual_turnover',
  'financial_year_end',
  'staff_count',
  'volunteer_count',
  'trustee_or_director_count',
  'people_supported_last_year',
  'outcomes_achieved',
  'safeguarding_policy',
  'equal_opportunities_policy',
  'previous_funders',
  'largest_grant_received',
] as const satisfies readonly (typeof CLAIM_VOCABULARY)[number][];

/** Turn a stored key into something a person would say. */
export function readableClaim(claim: string): string {
  return claim.replaceAll('_', ' ').replace(/^./u, (c) => c.toUpperCase());
}

/**
 * Fold a typed claim name into a stable key.
 *
 * Somebody typing "Annual Turnover" and somebody picking `annual_turnover`
 * from the list mean the same thing, and two facts about the same thing is
 * how a set of confirmed facts stops being trustworthy.
 */
export function normaliseClaim(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 120);
}

export interface SelfDeclaredFactInput {
  claim: string;
  value: string;
}

export interface SelfDeclaredFactResult {
  fact: { claim: string; value: string } | null;
  errors: Record<string, string>;
}

export const SELF_DECLARED_LIMITS = {
  maxValueLength: 2000,
} as const;

export function readSelfDeclaredFact(
  input: SelfDeclaredFactInput,
): SelfDeclaredFactResult {
  const errors: Record<string, string> = {};

  const claim = normaliseClaim(input.claim);
  if (claim === '') {
    errors['claim'] = 'Choose what this is about, or name it yourself.';
  }

  const value = input.value.trim();
  if (value === '') {
    errors['value'] = 'Write what you would put on an application form.';
  } else if (value.length > SELF_DECLARED_LIMITS.maxValueLength) {
    errors['value'] = `Keep it under ${SELF_DECLARED_LIMITS.maxValueLength} characters. This is a fact, not the application.`;
  }

  if (Object.keys(errors).length > 0) return { fact: null, errors };
  return { fact: { claim, value }, errors: {} };
}
