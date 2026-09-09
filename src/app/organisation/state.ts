export interface FactActionState {
  factId: string | null;
  ok: boolean;
  message: string;
}

export const EMPTY_FACT_ACTION: FactActionState = { factId: null, ok: false, message: '' };

import { NO_VALUES, type FormValues } from '@/app/formValues';

export const SELF_DECLARED_FIELDS = ['claim', 'customClaim', 'value'] as const;

export interface SelfDeclaredState {
  saved: boolean;
  message: string;
  errors: Record<string, string>;
  /** What was typed, so a rejected form is not handed back empty. */
  values: FormValues;
}

export const EMPTY_SELF_DECLARED: SelfDeclaredState = {
  saved: false,
  message: '',
  errors: {},
  values: NO_VALUES,
};
