/**
 * Normalise 360Giving grant records.
 *
 * Three principles:
 *
 *   1. Reject rather than repair. A record we cannot read correctly is dropped
 *      with a stated reason, never coerced into something plausible. A silently
 *      mis-parsed award would corrupt the funder-behaviour figures the product
 *      asks CICs to make decisions on.
 *
 *   2. Never convert currency. A non-GBP award is rejected, not converted at
 *      some assumed rate.
 *
 *   3. Treat all text as untrusted data. Publisher-supplied text reaches AI
 *      prompts later, so control characters are stripped and lengths capped
 *      here, at the boundary where the data enters the system.
 */

import type { Award } from '../../domain/funder/behaviour.js';
import type { Jurisdiction } from '../../domain/types.js';
import type { RawGrant, RawLocation, RawOrganisation } from './types.js';

export type NormaliseResult =
  | { ok: true; award: Award }
  | { ok: false; id: string | null; reason: string };

/** Publisher text is untrusted; keep it inert and bounded. */
export const MAX_TEXT_LENGTH = 2000;

/**
 * C0 and C1 control characters, keeping ordinary whitespace (tab, newline,
 * carriage return). These can be used to hide injected instructions inside
 * text that later reaches a model.
 */
// oxlint-disable-next-line no-control-regex -- matching these is the point
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;

export function sanitiseText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replaceAll(CONTROL_CHARACTERS, '').trim();
  if (cleaned === '') return null;
  return cleaned.slice(0, MAX_TEXT_LENGTH);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/** Accepts a full ISO timestamp but keeps only the date part. */
export function parseAwardDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const date = match[0];
  // Reject dates that parse but are not real, such as 2024-02-31.
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== date) return null;
  return date;
}

const JURISDICTION_BY_NAME: ReadonlyMap<string, Jurisdiction> = new Map([
  ['england', 'england'],
  ['wales', 'wales'],
  ['cymru', 'wales'],
  ['scotland', 'scotland'],
  ['alba', 'scotland'],
  ['northern ireland', 'northern_ireland'],
  ['united kingdom', 'uk_wide'],
  ['uk', 'uk_wide'],
]);

/**
 * Map a location to a UK jurisdiction, only where it is stated unambiguously.
 *
 * Inferring a jurisdiction from a place name would be guesswork, and a wrong
 * jurisdiction produces a wrong eligibility verdict. Unknown stays null.
 */
export function jurisdictionFromLocations(
  locations: readonly RawLocation[],
): Jurisdiction | null {
  for (const location of locations) {
    const name = sanitiseText(location.name);
    if (name === null) continue;
    const match = JURISDICTION_BY_NAME.get(name.toLowerCase());
    if (match) return match;
  }
  return null;
}

/** The first location name that is not itself a jurisdiction label. */
export function regionFromLocations(locations: readonly RawLocation[]): string | null {
  for (const location of locations) {
    const name = sanitiseText(location.name);
    if (name === null) continue;
    if (!JURISDICTION_BY_NAME.has(name.toLowerCase())) return name;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstOrganisationName(value: unknown): string | null {
  const first = asArray(value)[0] as RawOrganisation | undefined;
  return first ? sanitiseText(first.name) : null;
}

export function normaliseGrant(raw: RawGrant): NormaliseResult {
  const id = sanitiseText(raw.id);
  if (id === null) {
    return { ok: false, id: null, reason: 'The grant has no usable id.' };
  }

  if (typeof raw.currency === 'string' && raw.currency.toUpperCase() !== 'GBP') {
    return {
      ok: false,
      id,
      reason: `Currency is ${raw.currency}, not GBP. We do not convert currencies.`,
    };
  }

  const amount = raw.amountAwarded;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      id,
      reason: 'The awarded amount is missing or not a positive number.',
    };
  }

  const awardedOn = parseAwardDate(raw.awardDate);
  if (awardedOn === null) {
    return { ok: false, id, reason: 'The award date is missing or not a valid date.' };
  }

  const locations = asArray(raw.beneficiaryLocation) as RawLocation[];
  const tags = asArray(raw.classifications)
    .map((c) => sanitiseText((c as { title?: unknown }).title))
    .filter((t): t is string => t !== null);

  return {
    ok: true,
    award: {
      id,
      amountGbp: amount,
      awardedOn,
      recipientName: firstOrganisationName(raw.recipientOrganization),
      jurisdiction: jurisdictionFromLocations(locations),
      region: regionFromLocations(locations),
      tags,
    },
  };
}

export interface NormaliseBatch {
  awards: Award[];
  rejected: Array<{ id: string | null; reason: string }>;
}

/**
 * Normalise a batch, dropping duplicates by id.
 *
 * Duplicates are real: the same grant can appear across overlapping pages, and
 * counting it twice would skew both the award count and the median.
 */
export function normaliseGrants(raws: readonly RawGrant[]): NormaliseBatch {
  const awards: Award[] = [];
  const rejected: NormaliseBatch['rejected'] = [];
  const seen = new Set<string>();

  for (const raw of raws) {
    const result = normaliseGrant(raw);
    if (!result.ok) {
      rejected.push({ id: result.id, reason: result.reason });
      continue;
    }
    if (seen.has(result.award.id)) continue;
    seen.add(result.award.id);
    awards.push(result.award);
  }

  return { awards, rejected };
}
