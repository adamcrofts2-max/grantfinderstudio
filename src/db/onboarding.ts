/**
 * First run on an empty database.
 *
 * The demo seed only ever runs against the in-memory dev database, so a real
 * deployment starts with no organisation, no profile and no user. Everything
 * downstream — facts, applications, documents — hangs off an organisation row,
 * and `confirmCompanyAction` was written as an UPDATE, which on a fresh
 * database silently affects nothing. This module is what makes the first
 * screen work.
 */

import { describeLegalForm, type Jurisdiction, type LegalForm } from '../domain/types.js';
import type { Queryable } from './client.js';

/**
 * Create the user account. ADMIN path.
 *
 * `users` carries no tenant column and no policy, and `app_user` is granted
 * only SELECT on it, so this is the one part of first run that genuinely
 * belongs to the operator rather than to a tenant.
 */
export async function ensureUser(tx: Queryable, userId: string): Promise<void> {
  await tx.query(
    `INSERT INTO users (id, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [userId, `${userId}@example.invalid`, 'Account holder'],
  );
}

/**
 * Create the organisation, its membership and its profile. TENANT path.
 *
 * This must NOT run on the admin path, and finding that out is what a real
 * Postgres was for. `FORCE ROW LEVEL SECURITY` binds the table owner too, so
 * an owner-connection insert into `organisations` is refused exactly like any
 * other. Every PGlite test seeded as a superuser — which bypasses RLS
 * entirely — so the failure was invisible until the app ran against a real
 * database as a non-superuser, which is what every managed host gives you.
 *
 * Run inside the tenant context, the policies are satisfied by construction:
 * `WITH CHECK` requires the row's organisation to equal the active tenant, so
 * an organisation can only ever create itself.
 */
export async function ensureOrganisation(
  tx: Queryable,
  organisationId: string,
  userId: string,
  name: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO organisations (id, name) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [organisationId, name],
  );

  await tx.query(
    `INSERT INTO memberships (id, organisation_id, user_id, role)
     VALUES ($1, $2, $3, 'owner')
     ON CONFLICT (id) DO NOTHING`,
    [`m_${organisationId}_${userId}`, organisationId, userId],
  );

  await tx.query(
    `INSERT INTO organisation_profiles (id, organisation_id, legal_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (organisation_id) DO NOTHING`,
    [`profile_${organisationId}`, organisationId, name],
  );
}

export interface SelfDeclaredProfile {
  legalName: string;
  companyNumber: string | null;
  legalForm: LegalForm;
  jurisdiction: Jurisdiction;
  region: string | null;
  incorporationDate: string | null;
}

/**
 * Record details the applicant typed in themselves.
 *
 * Kept deliberately distinct from a Companies House lookup. Every fact stored
 * here carries `source: 'user'`, so a self-declared legal form can never be
 * mistaken on screen for one verified against the register — which matters,
 * because legal form is the criterion most funders decide on.
 *
 * These facts ARE confirmed, unlike an extraction: the person typed them, so
 * they are asserting them. Asking someone to confirm what they just wrote
 * would be theatre, and the same reasoning `correctFact` already uses.
 */
export async function saveSelfDeclaredProfile(
  tx: Queryable,
  organisationId: string,
  userId: string,
  profile: SelfDeclaredProfile,
): Promise<void> {
  await tx.query(
    `UPDATE organisation_profiles
     SET legal_name = $2, company_number = $3, form = $4, jurisdiction = $5,
         region = $6, incorporation_date = $7, updated_at = now()
     WHERE organisation_id = $1`,
    [
      organisationId,
      profile.legalName,
      profile.companyNumber,
      profile.legalForm,
      profile.jurisdiction,
      profile.region,
      profile.incorporationDate,
    ],
  );

  const facts: Array<[string, string | null]> = [
    ['legal_name', profile.legalName],
    ['company_number', profile.companyNumber],
    // The words, not our identifier: a fact is read by people.
    ['legal_form', describeLegalForm(profile.legalForm)],
    ['area_of_operation', profile.region],
    ['incorporation_date', profile.incorporationDate],
  ];

  for (const [claim, value] of facts) {
    if (value === null || value.trim() === '') continue;
    await tx.query(
      `INSERT INTO facts
         (id, organisation_id, claim, value, source, source_ref, retrieved_at,
          confidence_level, confirmed_by, confirmed_at)
       VALUES ($1, $2, $3, $4, 'user', NULL, now(), 'high', $5, now())
       ON CONFLICT (id) DO UPDATE SET
         value = EXCLUDED.value, retrieved_at = now(),
         confirmed_by = EXCLUDED.confirmed_by, confirmed_at = now()`,
      [`self_${organisationId}_${claim}`, organisationId, claim, value.trim(), userId],
    );
  }
}

/** Whether this organisation has told us who it is yet. */
export async function hasProfile(tx: Queryable, organisationId: string): Promise<boolean> {
  const r = await tx.query<{ form: string | null }>(
    'SELECT form FROM organisation_profiles WHERE organisation_id = $1',
    [organisationId],
  );
  return r.rows[0]?.form != null;
}

export interface ProjectDetails {
  name: string;
  description: string | null;
  amountSoughtGbp: number | null;
  durationMonths: number | null;
  beneficiaryGroups: readonly string[];
  capitalOrRevenue: 'capital' | 'revenue' | 'both' | null;
}

/**
 * What the organisation is trying to fund. TENANT path, like everything else
 * that carries an organisation_id.
 *
 * Without a project there is nothing to assess an opportunity against: the
 * amount, duration and beneficiary criteria are three of the ten the engine
 * evaluates, and they are the three that vary per application. A profile alone
 * gets you eligibility on legal form and little else.
 *
 * One project per organisation for now, updated in place. Multiple concurrent
 * projects is a real need and a bigger change than first run should carry.
 */
export async function saveProject(
  tx: Queryable,
  organisationId: string,
  project: ProjectDetails,
): Promise<void> {
  const existing = await tx.query<{ id: string }>(
    'SELECT id FROM projects ORDER BY created_at LIMIT 1',
  );
  const id = existing.rows[0]?.id ?? `project_${organisationId}`;

  await tx.query(
    `INSERT INTO projects
       (id, organisation_id, name, description, beneficiary_groups,
        amount_sought_gbp, duration_months, capital_or_revenue)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       beneficiary_groups = EXCLUDED.beneficiary_groups,
       amount_sought_gbp = EXCLUDED.amount_sought_gbp,
       duration_months = EXCLUDED.duration_months,
       capital_or_revenue = EXCLUDED.capital_or_revenue`,
    [
      id,
      organisationId,
      project.name,
      project.description,
      [...project.beneficiaryGroups],
      project.amountSoughtGbp,
      project.durationMonths,
      project.capitalOrRevenue,
    ],
  );
}

export interface RegisterProfile {
  name: string;
  companyNumber: string;
  legalForm: string | null;
  incorporatedOn: string | null;
  jurisdiction: string | null;
  address: string | null;
  /** County or town from the registered office, for matching on area. */
  area: string | null;
}

/**
 * Record what the Companies House register says. TENANT path.
 *
 * Lifted out of `confirmCompanyAction`, which held the only fact-writing SQL
 * outside this module and was the only writer that got it wrong. Every other
 * one — `saveSelfDeclaredProfile` here, `addFact` in the workspace — keys a
 * fact as `self_<organisation>_<claim>` and upserts. This one keyed it
 * `ch_<companyNumber>_<claim>` and plain INSERTed, which failed two ways:
 *
 *  - **Confirming twice threw.** `facts_pkey` rejected the second write, the
 *    server action had no handler for it, and the page became "Application
 *    error: a server-side exception has occurred". Onboarding is explicitly
 *    also how somebody corrects their own details, so this is a supported
 *    journey, not an edge case.
 *  - **Two organisations could not confirm the same company.** The key is
 *    global and carried no organisation, so the second tenant to look up a
 *    given company number crashed. A cross-tenant collision in a product whose
 *    whole promise is that tenants cannot touch each other.
 *
 * The confirmation rule is the interesting part of the upsert. A fact somebody
 * has already checked keeps its confirmation only while the register still
 * says the same thing; if the value has CHANGED, the confirmation is withdrawn,
 * because what they confirmed is no longer what we hold. Anything else would
 * let an application quote a figure nobody ever checked.
 */
export async function saveRegisterProfile(
  tx: Queryable,
  organisationId: string,
  profile: RegisterProfile,
): Promise<void> {
  await tx.query(
    `UPDATE organisation_profiles
       SET legal_name = $2, company_number = $3, form = COALESCE($4, form),
           incorporation_date = $5, jurisdiction = COALESCE($6, jurisdiction),
           -- COALESCE, not overwrite: somebody who typed "Wells" and then ran
           -- the lookup should keep their own answer over the register's
           -- county only if the register has nothing. Region drives matching,
           -- and it was never set by this route at all.
           region = COALESCE(region, $7),
           updated_at = now()
     WHERE organisation_id = $1`,
    [
      organisationId,
      profile.name,
      profile.companyNumber,
      profile.legalForm,
      profile.incorporatedOn,
      profile.jurisdiction,
      profile.area,
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
         (id, organisation_id, claim, value, source, source_ref, retrieved_at,
          confidence_level)
       VALUES ($1, $2, $3, $4, 'companies_house', $5, now(), 'high')
       ON CONFLICT (id) DO UPDATE SET
         value = EXCLUDED.value,
         source_ref = EXCLUDED.source_ref,
         retrieved_at = EXCLUDED.retrieved_at,
         -- Keep a confirmation only while the register still says what was
         -- confirmed. A changed value has never been checked by anybody.
         confirmed_by = CASE
           WHEN facts.value = EXCLUDED.value THEN facts.confirmed_by ELSE NULL END,
         confirmed_at = CASE
           WHEN facts.value = EXCLUDED.value THEN facts.confirmed_at ELSE NULL END`,
      [
        `ch_${organisationId}_${profile.companyNumber}_${claim}`,
        organisationId,
        claim,
        value,
        `companies-house:${profile.companyNumber}`,
      ],
    );
  }
}
