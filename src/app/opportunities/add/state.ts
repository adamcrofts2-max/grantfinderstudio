/**
 * Shared types for the add-a-fund screens.
 *
 * Separate from actions.ts because a 'use server' module may export only
 * async functions.
 */

export interface AddState {
  ok: boolean | null;
  message: string;
  opportunityId?: string;
  criteriaCount?: number;
  injected?: number;
}

export const IDLE: AddState = { ok: null, message: '' };

import { formatJurisdictions, type Jurisdiction } from '@/domain/types';

/** Plain-English names for the criterion kinds, for the review screen. */
export const KIND_LABEL: Record<string, string> = {
  legal_form: 'What kind of organisation',
  jurisdiction: 'Which nation',
  region: 'Which area',
  amount: 'How much you can ask for',
  organisation_age: 'How long you have existed',
  turnover: 'Your income',
  match_funding: 'Match funding',
  capital_revenue: 'Capital or running costs',
  beneficiary: 'Who benefits',
  duration: 'How long the project runs',
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replace(/_/gu, ' ');
}

const money = (value: unknown): string =>
  typeof value === 'number' ? `£${value.toLocaleString('en-GB')}` : 'not stated';

/**
 * A range where either end may be unstated.
 *
 * "From not stated to £500,000" is what you get from formatting both ends
 * blindly, and it reads like a bug even when the underlying rule is right.
 */
function range(min: unknown, max: unknown, noun: string): string {
  const hasMin = typeof min === 'number';
  const hasMax = typeof max === 'number';
  if (hasMin && hasMax) return `${noun} from ${money(min)} to ${money(max)}`;
  if (hasMax) return `${noun} up to ${money(max)}`;
  if (hasMin) return `${noun} of at least ${money(min)}`;
  return `${noun} not stated`;
}

function monthRange(min: unknown, max: unknown): string {
  const hasMin = typeof min === 'number';
  const hasMax = typeof max === 'number';
  if (hasMin && hasMax) return `Between ${min as number} and ${max as number} months`;
  if (hasMax) return `Up to ${max as number} months`;
  if (hasMin) return `At least ${min as number} months`;
  return 'Length not stated';
}

const list = (value: unknown): string =>
  Array.isArray(value) && value.length > 0 ? value.map(String).join(', ') : 'not stated';

/** Render a criterion's parameters as something a person can check. */
export function describeParams(kind: string, params: unknown): string {
  if (typeof params !== 'object' || params === null) return '';
  const p = params as Record<string, unknown>;

  switch (kind) {
    case 'amount':
      return range(p['minGbp'], p['maxGbp'], 'Grants');
    case 'turnover':
      return range(p['minGbp'], p['maxGbp'], 'Income');
    case 'organisation_age':
      return typeof p['minMonths'] === 'number'
        ? `At least ${p['minMonths']} months old`
        : 'not stated';
    case 'duration':
      return monthRange(p['minMonths'], p['maxMonths']);
    case 'match_funding':
      return p['required'] === true ? 'Required' : 'Not required';
    case 'jurisdiction':
      return Array.isArray(p['permitted'])
        ? formatJurisdictions(p['permitted'] as Jurisdiction[])
        : '';
    case 'region':
      return list(p['permittedRegions']);
    case 'capital_revenue':
      return list(p['permitted']);
    case 'beneficiary':
      return list(p['anyOf']);
    case 'legal_form':
      // A form rule with no list is carried entirely by its CIC note; an
      // empty "not stated" line under the heading reads as a missing value.
      return Array.isArray(p['permittedForms'])
        ? (p['permittedForms'] as string[]).map((f) => f.replace(/_/gu, ' ')).join(', ')
        : '';
    default:
      return '';
  }
}

/** What a CIC most needs to know: does this funder's form rule shut us out? */
export const CIC_TREATMENT_NOTE: Record<string, string> = {
  explicitly_permitted: 'This funder says community interest companies may apply.',
  charity_only:
    'This funder says registered charities only. A CIC is not a charity, so this would rule you out.',
  asset_locked_only:
    'This funder requires an asset lock. Every CIC has a statutory asset lock, so you meet this.',
  limited_by_guarantee_only:
    'Only organisations limited by guarantee. This depends on which kind of CIC you are.',
  no_share_capital_only:
    'Only organisations without share capital. This depends on which kind of CIC you are.',
  permitted_with_conditions: 'Permitted, but with conditions attached.',
  not_stated:
    'The guidance does not mention community interest companies. That is common, and worth asking the funder about.',
};
