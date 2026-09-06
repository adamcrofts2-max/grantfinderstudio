/**
 * Shared settings state.
 *
 * Kept out of `actions.ts` because a `'use server'` module may only export
 * async functions.
 */

import type { CredentialStatus, ProviderId } from '@/secrets/store';

export interface ActionState {
  provider: ProviderId | null;
  ok: boolean;
  message: string;
  /** The stored state after the action, so the badge cannot contradict the message. */
  status?: CredentialStatus;
}

export const EMPTY_ACTION: ActionState = { provider: null, ok: false, message: '' };
