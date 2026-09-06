'use server';

import { withAdmin } from '@/db/dev-database';
import { CompaniesHouseClient, describeFailure } from '@/ingestion/companieshouse/client';
import { looksLikeCompanyNumber } from '@/ingestion/companieshouse/normalise';
import { EMPTY_SEARCH, type ConfirmState, type SearchState } from './state';
import { loadMasterKey } from '@/secrets/crypto';
import { readCredentialSecret } from '@/secrets/store';
import { DEMO_ORG_ID } from '@/demo/seed';

/** Build a client from the stored operator credential, if there is one. */
async function buildClient(): Promise<CompaniesHouseClient | null> {
  let masterKey: Buffer;
  try {
    masterKey = loadMasterKey(process.env['APP_ENCRYPTION_KEY']);
  } catch {
    return null;
  }
  const key = await withAdmin((tx) =>
    readCredentialSecret(tx, 'companies_house', masterKey),
  );
  if (key === null) return null;
  // Overridable so the connector can be pointed at a staging or contract-test
  // endpoint without changing code.
  const baseUrl = process.env['COMPANIES_HOUSE_BASE_URL'];
  return new CompaniesHouseClient(baseUrl ? { apiKey: key, baseUrl } : { apiKey: key });
}

/**
 * Find a company by name, or by number when the input looks like one.
 *
 * Lookup is a convenience, never a gate. Every failure path leaves the user
 * able to continue by entering their details themselves.
 */
export async function searchCompaniesAction(
  _previous: SearchState,
  formData: FormData,
): Promise<SearchState> {
  const query = String(formData.get('query') ?? '').trim();
  if (query.length < 2) {
    return { ...EMPTY_SEARCH, query, searched: true };
  }

  const client = await buildClient();
  if (client === null) {
    return {
      query,
      matches: [],
      searched: true,
      problem:
        'Company lookup is not set up yet, so we cannot check your details against Companies House. You can still enter them yourself below.',
    };
  }

  if (looksLikeCompanyNumber(query)) {
    const result = await client.fetchProfile(query);
    return result.ok
      ? { query, matches: [result.profile], problem: null, searched: true }
      : { query, matches: [], problem: describeFailure(result.failure), searched: true };
  }

  const result = await client.searchByName(query);
  return result.ok
    ? { query, matches: result.matches, problem: null, searched: true }
    : { query, matches: [], problem: describeFailure(result.failure), searched: true };
}

/**
 * Adopt a company from the register as this organisation's profile.
 *
 * Everything taken from Companies House is written with
 * `source: 'companies_house'` and a retrieval timestamp, so the provenance
 * model can later distinguish a verified legal form from one the user typed.
 * The legal form is deliberately NOT written when the register's company type
 * is unrecognised: an unknown form must become a question, never a default.
 */
export async function confirmCompanyAction(
  _previous: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const companyNumber = String(formData.get('companyNumber') ?? '').trim();
  if (companyNumber === '') {
    return { saved: false, message: 'No company was selected.' };
  }

  const client = await buildClient();
  if (client === null) {
    return {
      saved: false,
      message: 'Company lookup is not available. Enter your details yourself instead.',
    };
  }

  // Re-fetch rather than trusting the values that came back through the form:
  // a browser can edit those, and this is the record eligibility rests on.
  const result = await client.fetchProfile(companyNumber);
  if (!result.ok) {
    return { saved: false, message: describeFailure(result.failure) };
  }
  const profile = result.profile;

  await withAdmin(async (tx) => {
    await tx.query(
      `UPDATE organisation_profiles
         SET legal_name = $2, company_number = $3, form = COALESCE($4, form),
             incorporation_date = $5, jurisdiction = COALESCE($6, jurisdiction),
             updated_at = now()
       WHERE organisation_id = $1`,
      [
        DEMO_ORG_ID,
        profile.name,
        profile.companyNumber,
        profile.legalForm,
        profile.incorporatedOn,
        profile.jurisdiction,
      ],
    );

    // Facts carry where each value came from, so the interface can show a
    // verified legal form differently from a self-declared one.
    const facts: Array<[string, string | null]> = [
      ['legal_name', profile.name],
      ['company_number', profile.companyNumber],
      ['legal_form', profile.legalForm],
      ['incorporation_date', profile.incorporatedOn],
      ['registered_office', profile.address],
    ];
    for (const [claim, value] of facts) {
      if (value === null) continue;
      await tx.query(
        `INSERT INTO facts
           (id, organisation_id, claim, value, source, source_ref, retrieved_at, confidence_level)
         VALUES ($1, $2, $3, $4, 'companies_house', $5, now(), 'high')`,
        [
          `ch_${profile.companyNumber}_${claim}`,
          DEMO_ORG_ID,
          claim,
          value,
          `companies-house:${profile.companyNumber}`,
        ],
      );
    }
  });

  const formNote =
    profile.legalForm === null
      ? ' We could not read your legal form from the register, so we will ask you about it.'
      : '';
  return {
    saved: true,
    message: `Saved ${profile.name} from the Companies House register.${formNote}`,
  };
}
