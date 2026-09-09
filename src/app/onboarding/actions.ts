'use server';

import { revalidatePath } from 'next/cache';
import { getDatabase, withAdmin } from '@/db';
import { CompaniesHouseClient, describeFailure } from '@/ingestion/companieshouse/client';
import { looksLikeCompanyNumber } from '@/ingestion/companieshouse/normalise';
import {
  EMPTY_SEARCH,
  type ConfirmState,
  type ManualState,
  type ProjectState,
  type SearchState,
  MANUAL_PROFILE_FIELDS,
  PROJECT_FIELDS,
} from './state';
import { NO_VALUES, readValues } from '@/app/formValues';
import { loadMasterKey } from '@/secrets/crypto';
import { readCredentialSecret } from '@/secrets/store';
import {
  ensureOrganisation,
  saveProject,
  saveSelfDeclaredProfile,
} from '@/db/onboarding';
import { JURISDICTIONS, LEGAL_FORMS, type Jurisdiction, type LegalForm } from '@/domain/types';
import { claimOrganisation, commitOrganisation } from '@/app/session';

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


  const orgClaim = await claimOrganisation();
  const database = await getDatabase();
  await database.withTenant(orgClaim.organisationId, async (tx) => {
    // On a fresh deployment there is no organisation yet, and this UPDATE
    // would silently affect nothing. Both routes in create it first.
    await ensureOrganisation(tx, orgClaim.organisationId, orgClaim.userId, profile.name);
    await tx.query(
      `UPDATE organisation_profiles
         SET legal_name = $2, company_number = $3, form = COALESCE($4, form),
             incorporation_date = $5, jurisdiction = COALESCE($6, jurisdiction),
             updated_at = now()
       WHERE organisation_id = $1`,
      [
        orgClaim.organisationId,
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
          orgClaim.organisationId,
          claim,
          value,
          `companies-house:${profile.companyNumber}`,
        ],
      );
    }
  });
  await commitOrganisation(orgClaim);

  const formNote =
    profile.legalForm === null
      ? ' We could not read your legal form from the register, so we will ask you about it.'
      : '';
  return {
    saved: true,
    message: `Saved ${profile.name} from the Companies House register.${formNote}`,
  };
}

/**
 * Enter the organisation's details by hand.
 *
 * The route that must always work. Companies House lookup needs a key, an
 * outbound connection and a company on the register — and if any of those is
 * missing on a fresh deployment there is otherwise no way past the first
 * screen at all.
 *
 * It also creates the organisation itself. `confirmCompanyAction` was written
 * as an UPDATE, which on an empty database silently changes nothing; both
 * paths now go through `ensureOrganisation` first.
 */
export async function saveManualProfileAction(
  _previous: ManualState,
  formData: FormData,
): Promise<ManualState> {
  const read = (name: string): string => String(formData.get(name) ?? '').trim();
  // Echoed back on every failure path: a rejected form must not cost somebody
  // the six fields they just typed.
  const values = readValues(formData, MANUAL_PROFILE_FIELDS);

  const legalName = read('legalName');
  const legalForm = read('legalForm');
  const jurisdiction = read('jurisdiction');
  const region = read('region');
  const companyNumber = read('companyNumber');
  const incorporationDate = read('incorporationDate');

  const errors: Record<string, string> = {};
  if (legalName === '') errors['legalName'] = 'We need the name your organisation is registered under.';
  if (!(LEGAL_FORMS as readonly string[]).includes(legalForm)) errors['legalForm'] = 'Choose the legal form.';
  if (!(JURISDICTIONS as readonly string[]).includes(jurisdiction)) errors['jurisdiction'] = 'Choose where you are based.';
  if (incorporationDate !== '' && !/^\d{4}-\d{2}-\d{2}$/u.test(incorporationDate)) {
    errors['incorporationDate'] = 'Use the date picker, or leave it blank.';
  }
  // A UK company number is 8 characters, sometimes with a two-letter prefix.
  if (companyNumber !== '' && !/^[A-Za-z]{0,2}\d{6,8}$/u.test(companyNumber)) {
    errors['companyNumber'] = 'That is not a company number. Leave it blank if you do not have one.';
  }

  if (Object.keys(errors).length > 0) {
    return { saved: false, message: 'Check the highlighted fields.', errors, values };
  }

  try {

    const orgClaim = await claimOrganisation();
    const database = await getDatabase();
    await database.withTenant(orgClaim.organisationId, async (tx) => {
      await ensureOrganisation(tx, orgClaim.organisationId, orgClaim.userId, legalName);
      await saveSelfDeclaredProfile(tx, orgClaim.organisationId, orgClaim.userId, {
        legalName,
        companyNumber: companyNumber === '' ? null : companyNumber.toUpperCase(),
        legalForm: legalForm as LegalForm,
        jurisdiction: jurisdiction as Jurisdiction,
        region: region === '' ? null : region,
        incorporationDate: incorporationDate === '' ? null : incorporationDate,
      });
    });
    await commitOrganisation(orgClaim);
  } catch {
    return {
      saved: false,
      message: 'We could not save that. Nothing has been changed — please try again.',
      errors: {},
      values,
    };
  }

  revalidatePath('/');
  revalidatePath('/organisation');
  revalidatePath('/onboarding');
  return {
    saved: true,
    message: 'Saved. These are recorded as your own declaration, not as verified against the register.',
    errors: {},
    // Cleared on success: the page moves on to the project.
    values: NO_VALUES,
  };
}


/**
 * What the organisation is trying to fund.
 *
 * Without this there is nothing to assess an opportunity against. Amount,
 * duration and beneficiary group are three of the ten criteria the engine
 * evaluates, and the three that change per application — a profile alone gets
 * you eligibility on legal form and very little else.
 */
export async function saveProjectAction(
  _previous: ProjectState,
  formData: FormData,
): Promise<ProjectState> {
  const read = (name: string): string => String(formData.get(name) ?? '').trim();
  const values = readValues(formData, PROJECT_FIELDS);

  const name = read('projectName');
  const description = read('description');
  const amountRaw = read('amountSoughtGbp').replace(/[£,\s]/gu, '');
  const durationRaw = read('durationMonths');
  const spend = read('capitalOrRevenue');
  const beneficiaries = formData.getAll('beneficiaries').map(String).filter((b) => b !== '');

  const errors: Record<string, string> = {};
  if (name === '') errors['projectName'] = 'Give the project a name you would put on a form.';

  let amountSoughtGbp: number | null = null;
  if (amountRaw !== '') {
    const parsed = Number(amountRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) errors['amountSoughtGbp'] = 'Enter an amount in pounds.';
    else amountSoughtGbp = Math.round(parsed);
  }

  let durationMonths: number | null = null;
  if (durationRaw !== '') {
    const parsed = Number(durationRaw);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 120) {
      errors['durationMonths'] = 'Enter a whole number of months, up to 120.';
    } else durationMonths = parsed;
  }

  if (spend !== '' && !['capital', 'revenue', 'both'].includes(spend)) {
    errors['capitalOrRevenue'] = 'Choose what the money is for.';
  }

  if (Object.keys(errors).length > 0) {
    return { saved: false, message: 'Check the highlighted fields.', errors, values };
  }

  try {
    const orgClaim = await claimOrganisation();
    const database = await getDatabase();
    await database.withTenant(orgClaim.organisationId, async (tx) => {
      await ensureOrganisation(tx, orgClaim.organisationId, orgClaim.userId, name);
      await saveProject(tx, orgClaim.organisationId, {
        name,
        description: description === '' ? null : description,
        amountSoughtGbp,
        durationMonths,
        beneficiaryGroups: beneficiaries,
        capitalOrRevenue: spend === '' ? null : (spend as 'capital' | 'revenue' | 'both'),
      });
    });
    await commitOrganisation(orgClaim);
  } catch {
    return {
      saved: false,
      message: 'We could not save that. Nothing has been changed — please try again.',
      errors: {},
      values,
    };
  }

  revalidatePath('/');
  revalidatePath('/onboarding');
  return {
    saved: true,
    message: 'Saved. Every fund is now checked against this.',
    errors: {},
    values: NO_VALUES,
  };
}
