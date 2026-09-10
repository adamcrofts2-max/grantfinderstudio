/**
 * The shared shape of the hand-typed fund form.
 *
 * Kept OUT of `ManualFundForm.tsx`, which is `'use client'`, and this is not
 * tidiness — it is a correctness fix.
 *
 * A `'use server'` module that imports a plain value from a client module does
 * not get the value. The bundler replaces it with a client-reference proxy, so
 * `readValues(formData, MANUAL_FUND_FIELDS)` threw "fields is not iterable"
 * and the whole action failed before it validated anything. Adding a fund by
 * hand — the one route that is meant to work with no API key at all — could
 * not work in a real build.
 *
 * Nothing caught it. Vitest imports the array normally, because the client
 * boundary is a bundler behaviour rather than a runtime one; only the real
 * Next build applies the proxy. The same shape of blind spot as every other
 * fault found this week: a path exercised by nothing but production.
 *
 * `src/app/admin/settings/state.ts` already exists for the sibling reason —
 * a `'use server'` module may only EXPORT async functions. Both rules point at
 * the same discipline: shared constants and types live in a module with no
 * directive at all.
 */

import { NO_VALUES, type FormValues } from '@/app/formValues';

export const MANUAL_FUND_FIELDS = [
  'funderName',
  'title',
  'sourceUrl',
  'minAmountGbp',
  'maxAmountGbp',
  'deadlineKind',
  'deadline',
  'jurisdiction',
  'summary',
] as const;

export interface ManualFundFormState {
  saved: boolean;
  message: string;
  errors: Record<string, string>;
  /** What was typed, so a rejected form is not handed back empty. */
  values: FormValues;
}

export const EMPTY_MANUAL_FUND: ManualFundFormState = {
  saved: false,
  message: '',
  errors: {},
  values: NO_VALUES,
};
