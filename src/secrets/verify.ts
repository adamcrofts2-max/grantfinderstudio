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

/**
 * What a Companies House response status means for the key.
 *
 * Pure, and separated from the fetch because the real service is unreachable
 * from the build environment — so the mapping was never exercised anywhere,
 * and it was wrong in a way that cost somebody their first real deployment.
 *
 * The old check probed `/company/00000006` and treated every non-OK status as
 * a bad key. Two problems, one fatal:
 *
 *  - A 404 means AUTHENTICATED BUT NOT FOUND. An unauthenticated request, or
 *    one with a bad key, gets 401. So a 404 proves the key works — and
 *    reporting it as "Companies House returned 404" marked a perfectly good
 *    key as failing, which then hid the company search from the onboarding
 *    screen with no explanation anywhere a person would look.
 *  - Probing one hard-coded company number makes the check depend on that
 *    company continuing to exist. It is not the API's job to keep a
 *    twelve-digit historical registration alive for our health check.
 *
 * 401 is the only status that means "this key is wrong", and it is the only
 * one reported that way now.
 */
export function interpretCompaniesHouseStatus(status: number): VerificationResult {
  if (status === 401) {
    return {
      ok: false,
      note: 'Companies House rejected that key. Check you copied all of it, and that it is a REST API key for a LIVE application — a test-application key only works against their sandbox.',
    };
  }
  if (status === 403) {
    return {
      ok: false,
      note: 'That key is valid but not permitted to read company data. In your Companies House application, check it is a REST key rather than a streaming key.',
    };
  }
  if (status === 429) {
    return { ok: false, note: 'Companies House rate-limited the check. The key may be fine — try again shortly.' };
  }
  if (status === 404) {
    // Authenticated. The register simply had nothing for the probe, which is
    // not a fact about the key.
    return { ok: true, note: 'Connected. Company lookups are working.' };
  }
  if (status >= 500) {
    return {
      ok: false,
      note: `Companies House is having trouble (${status}). The key may be fine — try again shortly.`,
    };
  }
  if (status >= 400) {
    return { ok: false, note: `Companies House returned ${status}.` };
  }
  return { ok: true, note: 'Connected. Company lookups are working.' };
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
    // Search rather than a specific company: it answers 200 for any key that
    // works, and depends on no single registration continuing to exist.
    const response = await fetch(
      `${baseUrl}/search/companies?q=community&items_per_page=1`,
      {
        headers: { Authorization: `Basic ${auth}` },
        signal: controller.signal,
      },
    );
    return interpretCompaniesHouseStatus(response.status);
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
