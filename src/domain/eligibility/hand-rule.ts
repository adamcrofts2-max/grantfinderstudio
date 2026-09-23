/**
 * An eligibility rule a person typed in from the funder's guidance.
 *
 * ## Why this exists
 *
 * Reading guidance with a model is the only route that ever produced a rule.
 * Without an API key — or for any fund typed in by hand — a fund had none, so
 * its eligibility could only ever read "we cannot yet tell", and "weigh what
 * you found", the product's middle step, was mostly unavailable. The rules
 * were almost always sitting in plain sight on the funder's page: "CICs may
 * apply", "at least two years' accounts", "Somerset only".
 *
 * ## Why it is not guessing
 *
 * `manual.ts` refuses to invent rules from a fund's free-text notes, and that
 * still stands: turning "we fund charities in the South West" into a rule
 * would be the product deciding, on somebody's behalf, the one thing it
 * exists to be certain about. Here the PERSON builds the rule — they choose
 * the kind and fill in its terms — and the product only checks that the
 * terms are complete and consistent. The result is stored in exactly the
 * shape an extracted rule is, so the engine evaluates both the same way.
 *
 * Confirmed on the way in, like a fact somebody types about themselves: the
 * person entering it is the person who would have confirmed it.
 *
 * Pure and zero I/O, like the rest of the domain.
 */

import {
  CIC_TREATMENTS,
  JURISDICTIONS,
  formatJurisdictions,
  type CicTreatment,
  type Jurisdiction,
} from '../types.js';

/** The kinds a person can enter, in the order guidance usually states them. */
export const HAND_RULE_KINDS = [
  'legal_form',
  'organisation_age',
  'jurisdiction',
  'region',
  'beneficiary',
  'amount',
  'duration',
  'capital_revenue',
  'turnover',
  'match_funding',
] as const;

export type HandRuleKind = (typeof HAND_RULE_KINDS)[number];

export function isHandRuleKind(value: string): value is HandRuleKind {
  return (HAND_RULE_KINDS as readonly string[]).includes(value);
}

/** What each kind is called on the form: the question the guidance answers. */
export const HAND_RULE_QUESTION: Record<HandRuleKind, string> = {
  legal_form: 'Who may apply — what kind of organisation',
  organisation_age: 'How long you must have existed',
  jurisdiction: 'Which nations of the UK',
  region: 'Which areas',
  beneficiary: 'Who the work must be for',
  amount: 'How much you can ask for',
  duration: 'How long the project can run',
  capital_revenue: 'Capital or running costs',
  turnover: 'How big your organisation can be',
  match_funding: 'Whether you need match funding',
};

/** How a CIC's form is treated, in the words a funder's page would use. */
export const CIC_TREATMENT_CHOICE: Record<CicTreatment, string> = {
  explicitly_permitted: 'Community interest companies may apply',
  charity_only: 'Registered charities only',
  asset_locked_only: 'Only organisations with an asset lock',
  limited_by_guarantee_only: 'Only organisations limited by guarantee',
  no_share_capital_only: 'Only organisations without share capital',
  permitted_with_conditions: 'CICs may apply, with conditions',
  not_stated: 'The guidance does not say whether CICs may apply',
};

export const SPEND_KINDS = ['capital', 'revenue'] as const;

export const HAND_RULE_LIMITS = {
  maxList: 20,
  maxItem: 120,
  maxSpan: 1000,
  maxConditions: 500,
  maxYears: 50,
  maxMonths: 120,
} as const;

export interface HandRule {
  kind: HandRuleKind;
  /** What the rule says, as the eligibility card will name it. */
  label: string;
  /** Exactly the shape `mapCriterion` accepts for this kind. */
  params: Record<string, unknown>;
  /** Set for `legal_form` only, where the schema keeps it in its own column. */
  cicHandling: CicTreatment | null;
  /** The funder's own words, if the person pasted them. */
  sourceSpan: string | null;
}

export interface HandRuleResult {
  rule: HandRule | null;
  errors: Record<string, string>;
}

/** How the form's fields are read — one value, or every value of a checkbox group. */
export interface HandRuleInput {
  one: (name: string) => string;
  all: (name: string) => string[];
}

const pounds = (n: number): string => `£${n.toLocaleString('en-GB')}`;

function isOneOf<T extends string>(value: string, options: readonly T[]): value is T {
  return (options as readonly string[]).includes(value);
}

/**
 * A number typed into a box, or null when the box is blank.
 *
 * 'bad' rather than a thrown error, so every field's problem can be reported
 * at once.
 */
function readNumber(raw: string, { whole }: { whole: boolean }): number | null | 'bad' {
  const cleaned = raw.replace(/[£,\s]/gu, '');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return 'bad';
  if (whole && !Number.isInteger(value)) return 'bad';
  return value;
}

/** "a, b and c" */
function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function months(n: number): string {
  if (n % 12 === 0) {
    const years = n / 12;
    return `${years} year${years === 1 ? '' : 's'}`;
  }
  return `${n} month${n === 1 ? '' : 's'}`;
}

/**
 * Tidy a list a person typed or ticked: trimmed, de-duplicated, bounded.
 * Case is kept — the engine compares case-insensitively, and a person reading
 * the rule back should see what they typed.
 */
function cleanList(values: readonly string[]): string[] | 'too_long' {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (value === '') continue;
    if (value.length > HAND_RULE_LIMITS.maxItem) return 'too_long';
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out.length > HAND_RULE_LIMITS.maxList ? 'too_long' : out;
}

/**
 * A min/max pair, either end optional but not both, and in order.
 *
 * Shared by amount, turnover and duration because the mistakes are the same:
 * a range with no ends is not a rule, and a minimum above the maximum turns
 * every applicant into a fail.
 */
function readRange(
  input: HandRuleInput,
  errors: Record<string, string>,
  { whole, cap }: { whole: boolean; cap: number | null },
): { min: number | null; max: number | null } | null {
  const min = readNumber(input.one('min'), { whole });
  const max = readNumber(input.one('max'), { whole });
  const unit = whole && cap !== null ? 'a whole number of months' : 'an amount in pounds';
  if (min === 'bad') errors['min'] = `Enter ${unit}, or leave it blank.`;
  if (max === 'bad') errors['max'] = `Enter ${unit}, or leave it blank.`;
  if (min === 'bad' || max === 'bad') return null;
  if (min === null && max === null) {
    errors['max'] = 'Give at least one end — a range with neither is not a rule.';
    return null;
  }
  if (cap !== null && ((min ?? 0) > cap || (max ?? 0) > cap)) {
    errors['max'] = `Keep it to ${cap} or fewer.`;
    return null;
  }
  if (min !== null && max !== null && min > max) {
    errors['min'] = 'The smallest is larger than the largest.';
    return null;
  }
  return { min, max };
}

function rangeLabel(
  min: number | null,
  max: number | null,
  noun: string,
  show: (n: number) => string,
): string {
  if (min !== null && max !== null) return `${noun} from ${show(min)} to ${show(max)}`;
  if (max !== null) return `${noun} of up to ${show(max)}`;
  return `${noun} of at least ${show(min as number)}`;
}

/**
 * Read and check a rule typed in by hand.
 *
 * Every problem at once, keyed by field, as the fund form does. Field names
 * come from the browser, so only the fields the chosen kind uses are read,
 * and every choice is checked against the list it must come from.
 */
export function readHandRule(input: HandRuleInput): HandRuleResult {
  const errors: Record<string, string> = {};
  const kind = input.one('kind').trim();
  if (!isOneOf(kind, HAND_RULE_KINDS)) {
    return { rule: null, errors: { kind: 'Choose what the rule is about.' } };
  }

  const spanRaw = input.one('sourceSpan').trim();
  if (spanRaw.length > HAND_RULE_LIMITS.maxSpan) {
    errors['sourceSpan'] = `Keep the quotation under ${HAND_RULE_LIMITS.maxSpan} characters.`;
  }
  const sourceSpan = spanRaw === '' ? null : spanRaw;

  const built = build(kind, input, errors);
  if (built === null || Object.keys(errors).length > 0) {
    return { rule: null, errors };
  }
  return { rule: { kind, sourceSpan, ...built }, errors: {} };
}

function build(
  kind: HandRuleKind,
  input: HandRuleInput,
  errors: Record<string, string>,
): Omit<HandRule, 'kind' | 'sourceSpan'> | null {
  switch (kind) {
    case 'legal_form': {
      const treatment = input.one('cicTreatment');
      if (!isOneOf(treatment, CIC_TREATMENTS)) {
        errors['cicTreatment'] = 'Choose what the guidance says about who may apply.';
        return null;
      }
      const conditions = input.one('conditions').trim();
      if (treatment === 'permitted_with_conditions' && conditions === '') {
        errors['conditions'] = 'Say what the conditions are, so you can check you meet them.';
        return null;
      }
      if (conditions.length > HAND_RULE_LIMITS.maxConditions) {
        errors['conditions'] = `Keep it under ${HAND_RULE_LIMITS.maxConditions} characters.`;
        return null;
      }
      return {
        label: CIC_TREATMENT_CHOICE[treatment],
        params: {
          conditions: treatment === 'permitted_with_conditions' ? conditions : null,
          permittedForms: null,
        },
        cicHandling: treatment,
      };
    }

    case 'organisation_age': {
      const years = readNumber(input.one('minYears'), { whole: false });
      if (years === null || years === 'bad' || years === 0) {
        errors['minYears'] = 'Enter how many years, for example 2 or 1.5.';
        return null;
      }
      if (years > HAND_RULE_LIMITS.maxYears) {
        errors['minYears'] = `Keep it to ${HAND_RULE_LIMITS.maxYears} years or fewer.`;
        return null;
      }
      const minMonths = Math.round(years * 12);
      return {
        label: `Existing for at least ${months(minMonths)}`,
        params: { minMonths },
        cicHandling: null,
      };
    }

    case 'jurisdiction': {
      const picked = input.all('nations').filter((n): n is Jurisdiction => isOneOf(n, JURISDICTIONS));
      if (picked.length === 0) {
        errors['nations'] = 'Tick at least one.';
        return null;
      }
      const permitted = picked.includes('uk_wide') ? (['uk_wide'] as Jurisdiction[]) : picked;
      return {
        label: `Organisations in ${formatJurisdictions(permitted)}`,
        params: { permitted },
        cicHandling: null,
      };
    }

    case 'region': {
      // Commas or new lines: people paste lists both ways.
      const listed = cleanList(input.one('regions').split(/[,\n;]/u));
      if (listed === 'too_long') {
        errors['regions'] = `Up to ${HAND_RULE_LIMITS.maxList} areas, each a short name.`;
        return null;
      }
      if (listed.length === 0) {
        errors['regions'] = 'Name at least one area, as your profile names yours.';
        return null;
      }
      return {
        label: `Only in ${joinAnd(listed)}`,
        params: { permittedRegions: listed },
        cicHandling: null,
      };
    }

    case 'beneficiary': {
      const listed = cleanList(input.all('groups'));
      if (listed === 'too_long') {
        errors['groups'] = 'Too many groups.';
        return null;
      }
      if (listed.length === 0) {
        errors['groups'] = 'Tick at least one group.';
        return null;
      }
      return {
        label: `For ${joinAnd(listed)}`,
        params: { anyOf: listed },
        cicHandling: null,
      };
    }

    case 'amount':
    case 'turnover': {
      const range = readRange(input, errors, { whole: false, cap: null });
      if (range === null) return null;
      const min = range.min === null ? null : Math.round(range.min);
      const max = range.max === null ? null : Math.round(range.max);
      return {
        label: rangeLabel(min, max, kind === 'amount' ? 'Grants' : 'Annual income', pounds),
        params: { minGbp: min, maxGbp: max },
        cicHandling: null,
      };
    }

    case 'duration': {
      const range = readRange(input, errors, { whole: true, cap: HAND_RULE_LIMITS.maxMonths });
      if (range === null) return null;
      return {
        label: rangeLabel(range.min, range.max, 'Projects', months),
        params: { minMonths: range.min, maxMonths: range.max },
        cicHandling: null,
      };
    }

    case 'capital_revenue': {
      const picked = input.all('spend').filter((s) => isOneOf(s, SPEND_KINDS));
      const permitted = [...new Set(picked)];
      if (permitted.length === 0) {
        errors['spend'] = 'Tick what the funder will pay for.';
        return null;
      }
      return {
        label:
          permitted.length === 2
            ? 'Capital and running costs'
            : permitted[0] === 'capital'
              ? 'Capital costs only'
              : 'Running costs only',
        params: { permitted },
        cicHandling: null,
      };
    }

    case 'match_funding':
      // Only the rule that constrains anything. "Match funding is not
      // required" passes everybody, and a rule that can only pass is noise on
      // the eligibility card.
      return { label: 'Match funding required', params: { required: true }, cicHandling: null };
  }
}
