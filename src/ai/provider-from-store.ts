/**
 * Build an AI provider from the operator credential stored in the database.
 *
 * The key is entered at /settings, verified against Anthropic, and stored
 * encrypted. This is the one place it is decrypted for use, and the plaintext
 * never leaves this function's caller.
 *
 * Returns a reason rather than throwing when nothing is configured, so a
 * feature can report itself unavailable instead of failing obscurely.
 */

import { withAdmin } from '../db/index.js';
import { loadMasterKey } from '../secrets/crypto.js';
import { readCredentialSecret } from '../secrets/store.js';
import { AnthropicProvider } from './providers/anthropic.js';
import type { AiProvider } from './types.js';

export type ProviderOutcome =
  | { available: true; provider: AiProvider }
  | { available: false; reason: string };

export async function providerFromStore(): Promise<ProviderOutcome> {
  let masterKey: Buffer;
  try {
    masterKey = loadMasterKey(process.env['APP_ENCRYPTION_KEY']);
  } catch {
    return {
      available: false,
      reason: 'Encryption is not configured on this server, so stored keys cannot be read.',
    };
  }

  const key = await withAdmin((tx) => readCredentialSecret(tx, 'anthropic', masterKey));
  if (key === null) {
    return {
      available: false,
      reason: 'No Anthropic key is set up yet. Add one in Settings and drafting will work.',
    };
  }

  return { available: true, provider: new AnthropicProvider({ apiKey: key }) };
}
