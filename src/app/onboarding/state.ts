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
