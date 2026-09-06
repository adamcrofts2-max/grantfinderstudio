'use server';

import { revalidatePath } from 'next/cache';
import { withAdmin } from '@/db/dev-database';
import { loadMasterKey, SecretError } from '@/secrets/crypto';
import {
  checkKeyShape,
  deleteCredential,
  saveCredential,
  type ProviderId,
} from '@/secrets/store';
import { verifyCredential } from '@/secrets/verify';

export interface ActionState {
  provider: ProviderId | null;
  ok: boolean;
  message: string;
}

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

  await withAdmin(async (tx) => {
    await saveCredential(tx, provider, key, masterKey, verification, null);
  });

  revalidatePath('/settings');
  return { provider, ok: verification.ok, message: verification.note };
}

export async function removeKeyAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const provider = formData.get('provider');
  if (!isProvider(provider)) {
    return { provider: null, ok: false, message: 'Unknown provider.' };
  }
  await withAdmin(async (tx) => {
    await deleteCredential(tx, provider);
  });
  revalidatePath('/settings');
  return { provider, ok: true, message: 'Key removed.' };
}
