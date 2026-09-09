import { NO_VALUES, type FormValues } from '@/app/formValues';

export interface IngestFormState {
  ok: boolean;
  message: string;
  detail: string[];
  errors: Record<string, string>;
  /** What was typed, so a rejected form is not handed back empty. */
  values: FormValues;
}

export const INGEST_FIELDS = [
  'orgId',
  'funderName',
  'website',
  'jurisdiction',
  'publisher',
  'licence',
  'licenceUrl',
  'attribution',
] as const;

export const EMPTY_INGEST: IngestFormState = {
  ok: true,
  message: '',
  detail: [],
  errors: {},
  values: NO_VALUES,
};
