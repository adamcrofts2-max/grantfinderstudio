/**
 * Form state for the sign-in and sign-up screens.
 *
 * Separate from `actions.ts` because a `'use server'` module may export only
 * async functions, and separate from the components because a server action
 * and a client component both need to name the same shape.
 */
export interface AuthState {
  ok: boolean;
  /** Shown above the form. Empty before anything has been submitted. */
  message: string;
  /** Every problem at once, so nobody discovers the rules one submit at a time. */
  problems: string[];
  /** Kept so a failed submit does not clear the field. */
  email: string;
}

export const EMPTY_AUTH: AuthState = { ok: false, message: '', problems: [], email: '' };
