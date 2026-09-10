import { NO_VALUES } from '@/app/formValues';
import type { ManualFundFormState } from '@/app/manualFundState';

/** The shared manual-fund shape; the console writes shared rows with it. */
export type CatalogueFormState = ManualFundFormState;

export const EMPTY_CATALOGUE_FORM: CatalogueFormState = {
  saved: false,
  message: '',
  errors: {},
  values: NO_VALUES,
};
