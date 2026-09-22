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

export interface ReadWebsiteState {
  ok: boolean;
  message: string;
  /** The address actually read, after redirects, so somebody can check it. */
  url: string | null;
  /** How many unconfirmed facts it proposed. */
  proposed: number;
  /**
   * Text on the page that addressed the model rather than describing the
   * organisation.
   *
   * Surfaced rather than logged: a page trying to talk the extractor into
   * something is a thing the page's owner should be told about, and the honest
   * version of "we read your website" includes what we noticed while doing it.
   */
  instructionLike: string[];
  /** Echoed back so a refusal does not cost somebody their typing. */
  value: string;
}

export const EMPTY_READ_WEBSITE: ReadWebsiteState = {
  ok: false,
  message: '',
  url: null,
  proposed: 0,
  instructionLike: [],
  value: '',
};

/**
 * What the erase action hands back.
 *
 * It only ever hands back a refusal. A successful erase has nowhere to return
 * to — the organisation, the membership and quite possibly the sign-in are all
 * gone by then — so it redirects instead.
 */
export interface EraseState {
  message: string;
  /** Echoed so a mistyped name does not also clear the box. */
  value: string;
}

export const EMPTY_ERASE: EraseState = { message: '', value: '' };
