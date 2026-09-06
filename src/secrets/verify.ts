/**
 * Live credential verification.
 *
 * A key that is merely *stored* is not a key that *works*. Every save is
 * checked against the provider, so the settings screen can say "connected"
 * only when it genuinely is.
 *
 * Failures are translated into something an operator can act on. The raw
 * provider error is never shown: it can echo the key back.
 */

import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODEL } from '../ai/providers/anthropic.js';
import type { ProviderId, VerificationResult } from './store.js';

const TIMEOUT_MS = 15_000;

/** Never let a provider error carry the key into a log or a page. */
function safeMessage(error: unknown, key: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replaceAll(key, '[redacted]').slice(0, 200);
}

async function verifyAnthropic(key: string): Promise<VerificationResult> {
  try {
    const client = new Anthropic({ apiKey: key, timeout: TIMEOUT_MS, maxRetries: 0 });
    // Retrieve the model this product actually uses, rather than listing
    // models and reporting whichever came back first — that would say
    // "connected" while telling the operator about a model we never call.
    const model = await client.models.retrieve(DEFAULT_MODEL);
    return { ok: true, note: `Connected. ${model.display_name ?? model.id} is available.` };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, note: 'Anthropic rejected that key. Check you copied all of it.' };
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, note: 'That key is valid but lacks permission for the Messages API.' };
    }
    if (error instanceof Anthropic.NotFoundError) {
      return {
        ok: false,
        note: `That key works, but ${DEFAULT_MODEL} is not available to it.`,
      };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, note: 'Anthropic rate-limited the check. The key may be fine — try again shortly.' };
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return {
        ok: false,
        note: 'Could not reach Anthropic from this server. Check outbound network access.',
      };
    }
    return { ok: false, note: `Could not verify: ${safeMessage(error, key)}` };
  }
}

async function verifyCompaniesHouse(key: string): Promise<VerificationResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Overridable so the check can be pointed at a staging or contract-test
  // endpoint; defaults to the real service.
  const baseUrl =
    process.env['COMPANIES_HOUSE_BASE_URL'] ??
    'https://api.company-information.service.gov.uk';
  try {
    // Companies House uses HTTP basic auth with the key as the username.
    const auth = Buffer.from(`${key}:`).toString('base64');
    const response = await fetch(`${baseUrl}/company/00000006`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: controller.signal,
    });
    if (response.status === 401) {
      return { ok: false, note: 'Companies House rejected that key.' };
    }
    if (response.status === 429) {
      return { ok: false, note: 'Companies House rate-limited the check. Try again shortly.' };
    }
    if (!response.ok) {
      return { ok: false, note: `Companies House returned ${response.status}.` };
    }
    return { ok: true, note: 'Connected. Company lookups are working.' };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, note: 'Companies House did not respond in time.' };
    }
    return {
      ok: false,
      note: `Could not reach Companies House from this server: ${safeMessage(error, key)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyCredential(
  provider: ProviderId,
  key: string,
): Promise<VerificationResult> {
  return provider === 'anthropic'
    ? verifyAnthropic(key)
    : verifyCompaniesHouse(key);
}
