/**
 * Build an AI provider from the operator credential stored in the database.
 *
 * The key is entered at /admin/settings, verified against Anthropic, and stored
 * encrypted. This is the one place it is decrypted for use, and the plaintext
 * never leaves this function's caller.
 *
 * Two routes in, and both must be honoured: a key entered at /admin/settings and
 * stored encrypted, or ANTHROPIC_API_KEY supplied to the process — which is
 * how a deployment configures itself, and what the provider already falls back
 * to. Checking only the stored one made `isWriterAvailable` and this function
 * disagree: the interface offered a feature that then reported encryption was
 * not configured.
 *
 * The stored key wins where both exist, because someone entering a key in
 * Settings is making a deliberate choice about which account pays.
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
  const stored = await readStoredKey();
  if (stored !== null) return { available: true, provider: new AnthropicProvider({ apiKey: stored }) };

  const fromEnvironment = process.env['ANTHROPIC_API_KEY'] ?? '';
  if (fromEnvironment.trim() !== '') {
    return { available: true, provider: new AnthropicProvider({ apiKey: fromEnvironment }) };
  }

  return {
    available: false,
    reason: 'No Anthropic key is set up yet. Add one in Settings and this will work.',
  };
}

/**
 * The stored key, or null for any reason it cannot be had.
 *
 * A missing encryption key, an empty credentials table and an unreachable
 * database all mean the same thing to the caller: there is no stored key, so
 * try the environment.
 */
async function readStoredKey(): Promise<string | null> {
  try {
    const masterKey = loadMasterKey(process.env['APP_ENCRYPTION_KEY']);
    return await withAdmin((tx) => readCredentialSecret(tx, 'anthropic', masterKey));
  } catch {
    return null;
  }
}
