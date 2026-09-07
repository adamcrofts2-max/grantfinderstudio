/**
 * Read models for the discovery screens.
 *
 * Every query runs inside a tenant context, so Row-Level Security applies even
 * though these particular reads mostly touch shared reference data.
 */

import {
  assessOpportunity,
  type OpportunityAssessment,
  type OpportunitySummary,
} from '../domain/assessment/assess.js';
import type { Award } from '../domain/funder/behaviour.js';
import type { ApplicantProfile, ProjectRequest } from '../domain/types.js';
import { DEMO_APPLICATION_FEATURES } from '../demo/seed.js';
import { mapCriteria } from './criteria-mapper.js';
import type { CriterionRow } from './criteria-mapper.js';
import type { Queryable, TenantDatabase } from './client.js';

interface ProfileRow {
  legal_name: string | null;
  company_number: string | null;
  form: ApplicantProfile['legalForm'] | null;
  incorporation_date: string | null;
  jurisdiction: ApplicantProfile['jurisdiction'] | null;
  region: string | null;
  annual_turnover_gbp: string | null;
  mission: string | null;
}

export interface OrganisationView {
  name: string;
  companyNumber: string | null;
  mission: string | null;
  profile: ApplicantProfile;
}

export interface ProjectView extends ProjectRequest {
  name: string;
  description: string | null;
}

function numberOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function loadOrganisation(
  tx: Queryable,
): Promise<OrganisationView | null> {
  const r = await tx.query<ProfileRow>(`
    SELECT legal_name, company_number, form, incorporation_date::text AS incorporation_date,
           jurisdiction, region, annual_turnover_gbp::text AS annual_turnover_gbp, mission
    FROM organisation_profiles
    LIMIT 1
  `);
  const row = r.rows[0];
  if (!row) return null;

  return {
    name: row.legal_name ?? 'Your organisation',
    companyNumber: row.company_number,
    mission: row.mission,
    profile: {
      legalForm: row.form ?? 'other',
      jurisdiction: row.jurisdiction ?? 'uk_wide',
      region: row.region,
      incorporationDate: row.incorporation_date,
      annualTurnoverGbp: numberOrNull(row.annual_turnover_gbp),
    },
  };
}

interface ProjectRow {
  name: string;
  description: string | null;
  beneficiary_groups: string[];
  amount_sought_gbp: string | null;
  duration_months: number | null;
  capital_or_revenue: 'capital' | 'revenue' | 'both' | null;
}

export async function loadProject(tx: Queryable): Promise<ProjectView | null> {
  const r = await tx.query<ProjectRow>(`
    SELECT name, description, beneficiary_groups,
           amount_sought_gbp::text AS amount_sought_gbp, duration_months,
           capital_or_revenue::text AS capital_or_revenue
    FROM projects
    ORDER BY created_at
    LIMIT 1
  `);
  const row = r.rows[0];
  if (!row) return null;

  return {
    name: row.name,
    description: row.description,
    beneficiaryGroups: row.beneficiary_groups ?? [],
    amountSoughtGbp: numberOrNull(row.amount_sought_gbp),
    durationMonths: row.duration_months,
    // Not yet captured in onboarding; the engine reports these as unknown
    // rather than assuming, which is the correct behaviour.
    // 'both' means no capital/revenue restriction can exclude this project.
    capitalOrRevenue: row.capital_or_revenue === 'both' ? null : row.capital_or_revenue,
    hasMatchFunding: null,
  };
}

interface OpportunityRow {
  id: string;
  title: string;
  summary: string | null;
  funder_id: string;
  funder_name: string;
  deadline: string | null;
  deadline_kind: OpportunitySummary['deadlineType'];
  freshness_state: OpportunitySummary['freshness'];
  retrieved_at: string;
  source_url: string | null;
  licence: string | null;
  attribution: string | null;
}

export interface OpportunityWithSource extends OpportunitySummary {
  summary: string | null;
  funderId: string;
  sourceUrl: string | null;
  licence: string | null;
  attribution: string | null;
}

function toSummary(row: OpportunityRow): OpportunityWithSource {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    funderId: row.funder_id,
    funderName: row.funder_name,
    deadline: row.deadline,
    deadlineType: row.deadline_kind,
    freshness: row.freshness_state,
    retrievedAt: row.retrieved_at,
    sourceUrl: row.source_url,
    licence: row.licence,
    attribution: row.attribution,
  };
}

const OPPORTUNITY_SELECT = `
  SELECT o.id, o.title, o.summary, o.funder_id, f.name AS funder_name,
         o.deadline::text AS deadline, o.deadline_kind, o.freshness_state,
         o.retrieved_at::text AS retrieved_at, o.source_url,
         d.licence, d.attribution
  FROM opportunities o
  JOIN funders f ON f.id = o.funder_id
  LEFT JOIN source_datasets d ON d.id = o.source_dataset_id
`;

export async function loadOpportunities(
  tx: Queryable,
): Promise<OpportunityWithSource[]> {
  const r = await tx.query<OpportunityRow>(`${OPPORTUNITY_SELECT} ORDER BY o.title`);
  return r.rows.map(toSummary);
}

export async function loadOpportunity(
  tx: Queryable,
  id: string,
): Promise<OpportunityWithSource | null> {
  const r = await tx.query<OpportunityRow>(`${OPPORTUNITY_SELECT} WHERE o.id = $1`, [id]);
  const row = r.rows[0];
  return row ? toSummary(row) : null;
}

interface AwardRow {
  id: string;
  amount_gbp: string;
  awarded_on: string;
  recipient_name: string | null;
  jurisdiction: Award['jurisdiction'];
  region: string | null;
}

export async function loadAwards(tx: Queryable, funderId: string): Promise<Award[]> {
  const r = await tx.query<AwardRow>(
    `SELECT id, amount_gbp::text AS amount_gbp, awarded_on::text AS awarded_on,
            recipient_name, jurisdiction, region
     FROM funder_awards WHERE funder_id = $1`,
    [funderId],
  );
  return r.rows.map((row) => ({
    id: row.id,
    amountGbp: Number(row.amount_gbp),
    awardedOn: row.awarded_on,
    recipientName: row.recipient_name,
    jurisdiction: row.jurisdiction,
    region: row.region,
    tags: [],
  }));
}

/**
 * The criteria the eligibility engine is allowed to decide on.
 *
 * Verified only, and this filter is load-bearing. The architecture's rule is
 * that AI proposes criteria, a person verifies them, and only then does the
 * engine decide. Without the `verified_at IS NOT NULL` clause, a criterion a
 * model invented from pasted guidance would drive a verdict the moment it was
 * stored — which would make the AI the decision-maker and quietly remove the
 * one guarantee this product is built on.
 *
 * An opportunity with nothing verified yet therefore has an empty criteria
 * set, and `evaluateEligibility` returns `unknown` for that. Knowing nothing
 * about a funder's rules is not the same as meeting them.
 */
export async function loadCriteria(tx: Queryable, opportunityId: string) {
  const r = await tx.query<CriterionRow>(
    `SELECT id, kind, label, params, cic_handling
     FROM eligibility_criteria
     WHERE opportunity_id = $1 AND verified_at IS NOT NULL
     ORDER BY id`,
    [opportunityId],
  );
  return mapCriteria(r.rows);
}

export interface ProposedCriterion {
  id: string;
  kind: string;
  label: string;
  params: unknown;
  cicHandling: string | null;
  sourceSpan: string | null;
  proposedBy: string;
}

/**
 * Criteria awaiting a person's judgement.
 *
 * Separate from `loadCriteria` on purpose: these are for a review screen, not
 * for the engine, and keeping them in different functions means no caller can
 * pass one where the other belongs.
 */
export async function loadProposedCriteria(
  tx: Queryable,
  opportunityId: string,
): Promise<ProposedCriterion[]> {
  const r = await tx.query<CriterionRow & { source_span: string | null; proposed_by: string }>(
    `SELECT id, kind, label, params, cic_handling, source_span, proposed_by
     FROM eligibility_criteria
     WHERE opportunity_id = $1 AND verified_at IS NULL AND rejected_at IS NULL
     ORDER BY id`,
    [opportunityId],
  );
  return r.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    params: row.params,
    cicHandling: row.cic_handling,
    sourceSpan: row.source_span,
    proposedBy: row.proposed_by,
  }));
}

export interface AssessedOpportunity {
  opportunity: OpportunityWithSource;
  assessment: OpportunityAssessment;
}

const NO_FEATURES = {
  questionCount: 0,
  totalWordBudget: 0,
  requiredAttachments: 0,
  requiresLatestAccounts: false,
  requiredPolicies: [] as string[],
  requiresMatchFunding: false,
  requiresBudgetTemplate: false,
};

/** Assess every opportunity for the tenant's organisation and project. */
export async function assessAll(
  database: TenantDatabase,
  organisationId: string,
  asOf: string,
): Promise<{
  organisation: OrganisationView | null;
  project: ProjectView | null;
  assessed: AssessedOpportunity[];
}> {
  return database.withTenant(organisationId, async (tx) => {
    const organisation = await loadOrganisation(tx);
    const project = await loadProject(tx);
    const opportunities = await loadOpportunities(tx);

    if (!organisation || !project) {
      return { organisation, project, assessed: [] };
    }

    const assessed: AssessedOpportunity[] = [];
    for (const opportunity of opportunities) {
      const { criteria } = await loadCriteria(tx, opportunity.id);
      const awards = await loadAwards(tx, opportunity.funderId);
      assessed.push({
        opportunity,
        assessment: assessOpportunity({
          applicant: organisation.profile,
          project,
          opportunity,
          criteria,
          awards,
          features: DEMO_APPLICATION_FEATURES[opportunity.id] ?? NO_FEATURES,
          asOf,
        }),
      });
    }
    return { organisation, project, assessed };
  });
}
