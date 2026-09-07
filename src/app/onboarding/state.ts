/**
 * Shared onboarding state.
 *
 * Kept out of `actions.ts` because a `'use server'` module may only export
 * async functions — a constant exported from one arrives as `undefined` on the
 * client, with no build error to warn you.
 */

import type { CompanyMatch } from '@/ingestion/companieshouse/normalise';

export interface SearchState {
  query: string;
  matches: CompanyMatch[];
  /** Set when lookup could not run. The manual route stays open regardless. */
  problem: string | null;
  searched: boolean;
}

export const EMPTY_SEARCH: SearchState = {
  query: '',
  matches: [],
  problem: null,
  searched: false,
};

export interface ConfirmState {
  saved: boolean;
  message: string;
}

export const EMPTY_CONFIRM: ConfirmState = { saved: false, message: '' };

export interface ManualState {
  saved: boolean;
  message: string;
  /** Per-field problems, so a form does not have to be retyped. */
  errors: Record<string, string>;
}

export const EMPTY_MANUAL: ManualState = { saved: false, message: '', errors: {} };

/**
 * The legal forms an applicant can choose, in the words they would use.
 *
 * The two CIC forms are listed separately because the difference decides real
 * eligibility questions: several funders accept only bodies limited by
 * guarantee, or only those without share capital.
 */
export const LEGAL_FORM_CHOICES = [
  { value: 'cic_limited_by_guarantee', label: 'Community interest company, limited by guarantee' },
  { value: 'cic_limited_by_shares', label: 'Community interest company, limited by shares' },
  { value: 'charity', label: 'Registered charity' },
  { value: 'charitable_incorporated_organisation', label: 'Charitable incorporated organisation (CIO)' },
  { value: 'company_limited_by_guarantee', label: 'Company limited by guarantee' },
  { value: 'unincorporated_association', label: 'Unincorporated association' },
  { value: 'community_benefit_society', label: 'Community benefit society' },
] as const;

export const JURISDICTION_CHOICES = [
  { value: 'england', label: 'England' },
  { value: 'scotland', label: 'Scotland' },
  { value: 'wales', label: 'Wales' },
  { value: 'northern_ireland', label: 'Northern Ireland' },
] as const;

export interface ProjectState {
  saved: boolean;
  message: string;
  errors: Record<string, string>;
}

export const EMPTY_PROJECT: ProjectState = { saved: false, message: '', errors: {} };

/** Beneficiary groups as funders name them, so a criterion can actually match. */
export const BENEFICIARY_CHOICES = [
  'young people',
  'older people',
  'disabled people',
  'carers',
  'refugees and asylum seekers',
  'people experiencing poverty',
  'people with mental ill health',
  'women and girls',
  'ethnic minority communities',
  'the general community',
] as const;

export const SPEND_CHOICES = [
  { value: 'revenue', label: 'Running costs — staff, sessions, delivery' },
  { value: 'capital', label: 'Capital — building work, equipment, vehicles' },
  { value: 'both', label: 'Both' },
] as const;
