/**
 * Companies House Public Data API client.
 *
 * Auth is HTTP Basic with the API key as the username and an empty password.
 * The published rate limit is 600 requests per five minutes, which onboarding
 * lookups will not trouble — but a 429 is handled explicitly rather than
 * surfacing as a generic failure.
 *
 * The key never appears in a thrown error: provider errors can echo it back.
 */

import {
  toCompanyMatch,
  toCompanyProfile,
  type CompanyMatch,
  type CompanyProfile,
} from './normalise.js';
import type { RawCompanyProfile, RawSearchItem, RawSearchResponse } from './types.js';

export const COMPANIES_HOUSE_BASE_URL =
  'https://api.company-information.service.gov.uk';

export type LookupFailure =
  | { kind: 'not_found' }
  | { kind: 'unauthorised' }
  | { kind: 'rate_limited' }
  | { kind: 'unavailable'; detail: string };

export type SearchOutcome =
  | { ok: true; matches: CompanyMatch[] }
  | { ok: false; failure: LookupFailure };

export type ProfileOutcome =
  | { ok: true; profile: CompanyProfile }
  | { ok: false; failure: LookupFailure };

/** Injected so the client is testable without a network or a key. */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESULTS = 10;

function failureFor(status: number): LookupFailure | null {
  if (status === 401 || status === 403) return { kind: 'unauthorised' };
  if (status === 404) return { kind: 'not_found' };
  if (status === 429) return { kind: 'rate_limited' };
  if (status >= 400) {
    return { kind: 'unavailable', detail: `Companies House returned ${status}.` };
  }
  return null;
}

export class CompaniesHouseClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: ClientOptions) {
    if (options.apiKey.trim() === '') {
      throw new Error('A Companies House API key is required.');
    }
    this.baseUrl = options.baseUrl ?? COMPANIES_HOUSE_BASE_URL;
    this.authHeader = `Basic ${Buffer.from(`${options.apiKey}:`).toString('base64')}`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl =
      options.fetchImpl ??
      (async (url, init) => {
        const response = await fetch(url, init as RequestInit);
        return { status: response.status, json: () => response.json() };
      });
  }

  private async request(path: string): Promise<
    { ok: true; body: unknown } | { ok: false; failure: LookupFailure }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { Authorization: this.authHeader, Accept: 'application/json' },
        signal: controller.signal,
      });
      const failure = failureFor(response.status);
      if (failure) return { ok: false, failure };
      return { ok: true, body: await response.json() };
    } catch (error) {
      const detail =
        error instanceof Error && error.name === 'AbortError'
          ? 'Companies House did not respond in time.'
          : 'Could not reach Companies House.';
      return { ok: false, failure: { kind: 'unavailable', detail } };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Search by name.
   *
   * This is the primary entry point: a founder always knows their company
   * name, and often does not have the number to hand.
   */
  async searchByName(query: string): Promise<SearchOutcome> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return { ok: true, matches: [] };

    const result = await this.request(
      `/search/companies?q=${encodeURIComponent(trimmed)}&items_per_page=${MAX_RESULTS}`,
    );
    if (!result.ok) return { ok: false, failure: result.failure };

    const body = result.body as RawSearchResponse;
    const items = Array.isArray(body.items) ? (body.items as RawSearchItem[]) : [];
    const matches = items
      .map((item) => toCompanyMatch(item))
      .filter((match): match is CompanyMatch => match !== null);

    return { ok: true, matches };
  }

  /** Fetch the full record once a company has been chosen. */
  async fetchProfile(companyNumber: string): Promise<ProfileOutcome> {
    const trimmed = companyNumber.trim().toUpperCase();
    if (trimmed === '') return { ok: false, failure: { kind: 'not_found' } };

    const result = await this.request(`/company/${encodeURIComponent(trimmed)}`);
    if (!result.ok) return { ok: false, failure: result.failure };

    const profile = toCompanyProfile(result.body as RawCompanyProfile);
    return profile === null
      ? {
          ok: false,
          failure: { kind: 'unavailable', detail: 'The record could not be read.' },
        }
      : { ok: true, profile };
  }
}

/** Wording an operator or applicant can act on. */
export function describeFailure(failure: LookupFailure): string {
  switch (failure.kind) {
    case 'not_found':
      return 'No company with that number was found.';
    case 'unauthorised':
      return 'Company lookup is not configured correctly. You can still enter your details by hand.';
    case 'rate_limited':
      return 'Company lookup is busy right now. Try again in a moment, or enter your details by hand.';
    case 'unavailable':
      return `${failure.detail} You can still enter your details by hand.`;
  }
}
