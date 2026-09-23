/**
 * Shared shapes for editing a fund of your own and its rules.
 *
 * Kept out of `actions.ts` because a `'use server'` module may export only
 * async functions, and out of the client form because a server action that
 * imports a value from a client module receives a proxy, not the value — see
 * `src/app/manualFundState.ts`.
 */

import { NO_VALUES, type FormValues } from '@/app/formValues';

/** The single-valued rule fields echoed back when a rule is refused. */
export const RULE_FIELDS = [
  'kind',
  'cicTreatment',
  'conditions',
  'minYears',
  'regions',
  'min',
  'max',
  'sourceSpan',
] as const;

export interface RuleFormState {
  saved: boolean;
  message: string;
  errors: Record<string, string>;
  values: FormValues;
}

export const EMPTY_RULE: RuleFormState = {
  saved: false,
  message: '',
  errors: {},
  values: NO_VALUES,
};
