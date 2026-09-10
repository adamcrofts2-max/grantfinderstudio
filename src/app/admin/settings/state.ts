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
  /**
   * When this outcome was produced.
   *
   * Three actions — save, remove and re-check — can each hold a result for the
   * SAME provider, and the screen keeps the last of each. Without a clock,
   * whichever is checked first wins, so a failed save would keep captioning a
   * key that a later re-check has just proved fine. The roster had the same
   * bug for the same reason.
   */
  at: number;
}

export const EMPTY_ACTION: ActionState = { provider: null, ok: false, message: '', at: 0 };

export interface SettingActionState {
  key: string | null;
  ok: boolean;
  message: string;
}

export const EMPTY_SETTING_ACTION: SettingActionState = {
  key: null,
  ok: true,
  message: '',
};
