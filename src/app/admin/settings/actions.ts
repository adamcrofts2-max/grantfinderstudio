'use server';

import { revalidatePath } from 'next/cache';
import { withAdmin } from '@/db';
import { loadMasterKey, SecretError } from '@/secrets/crypto';
import {
  checkKeyShape,
  deleteCredential,
  readCredentialStatuses,
  saveCredential,
  type ProviderId,
} from '@/secrets/store';
import { verifyCredential } from '@/secrets/verify';
import { saveSetting, SettingError } from '@/settings/store';

import { requireAdmin } from '../session';
import type { ActionState, SettingActionState } from './state';

function isProvider(value: unknown): value is ProviderId {
  return value === 'anthropic' || value === 'companies_house';
}

/**
 * Save a key: shape check, live verification, then encrypted storage.
 *
 * A key that fails verification is still stored, with the failure recorded —
 * an operator whose provider is temporarily down should not have to re-paste
 * the key later, and the screen shows plainly that it is not working.
 */
export async function saveKeyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // A server action is a public endpoint. This screen used to live in the
  // tenant app with no guard at all, which meant anyone who could reach the
  // deployment — signed in or not — could overwrite the platform's keys.
  const admin = await requireAdmin();

  const provider = formData.get('provider');
  const key = String(formData.get('key') ?? '');

  if (!isProvider(provider)) {
    return { provider: null, ok: false, message: 'Unknown provider.' };
  }

  const shapeProblem = checkKeyShape(provider, key);
  if (shapeProblem !== null) {
    return { provider, ok: false, message: shapeProblem };
  }

  let masterKey: Buffer;
  try {
    masterKey = loadMasterKey(process.env['APP_ENCRYPTION_KEY']);
  } catch (error) {
    return {
      provider,
      ok: false,
      message:
        error instanceof SecretError
          ? error.message
          : 'Encryption is not configured on this server.',
    };
  }

  const verification = await verifyCredential(provider, key);

  const status = await withAdmin(async (tx) => {
    await saveCredential(tx, provider, key, masterKey, verification, admin.adminId);
    // Read the stored state back so the badge reflects what was actually
    // saved, rather than waiting on a revalidation the form does not await.
    return (await readCredentialStatuses(tx))[provider];
  });

  revalidatePath('/admin/settings');
  revalidatePath('/admin');
  return { provider, ok: verification.ok, message: verification.note, status };
}

export async function removeKeyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const provider = formData.get('provider');
  if (!isProvider(provider)) {
    return { provider: null, ok: false, message: 'Unknown provider.' };
  }
  const status = await withAdmin(async (tx) => {
    await deleteCredential(tx, provider);
    return (await readCredentialStatuses(tx))[provider];
  });
  revalidatePath('/admin/settings');
  revalidatePath('/admin');
  return { provider, ok: true, message: 'Key removed.', status };
}

/**
 * Change an operational setting — a base URL, a page cap.
 *
 * Clearing the box is how you go back to the environment variable or the
 * built-in default, so an empty submission is a deliberate action rather than
 * a validation failure.
 */
export async function saveSettingAction(
  _previous: SettingActionState,
  formData: FormData,
): Promise<SettingActionState> {
  const admin = await requireAdmin();
  const key = String(formData.get('key') ?? '');
  const value = String(formData.get('value') ?? '');

  try {
    await withAdmin((tx) => saveSetting(tx, key, value, admin.adminId));
  } catch (error) {
    return {
      key,
      ok: false,
      message:
        error instanceof SettingError
          ? error.message
          : 'That could not be saved. Nothing has been changed.',
    };
  }

  revalidatePath('/admin/settings');
  revalidatePath('/admin');
  return {
    key,
    ok: true,
    message: value.trim() === '' ? 'Cleared — back to the default.' : 'Saved.',
  };
}
