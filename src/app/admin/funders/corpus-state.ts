/**
 * State for the corpus controls.
 *
 * A plain module, not the `'use server'` one and not a `'use client'` one. A
 * `'use server'` file importing a value from a `'use client'` file gets a
 * client-reference proxy instead of the value — which is how adding a fund by
 * hand came to throw "fields is not iterable" in production while every test
 * passed. Shared constants live in their own module for that reason.
 */

export interface CorpusActionState {
  ok: boolean;
  message: string;
  /** So a rerender can tell a fresh result from a stale one. */
  at: number;
}

export const EMPTY_CORPUS: CorpusActionState = { ok: false, message: '', at: 0 };
