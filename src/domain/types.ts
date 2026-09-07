/**
 * Shared domain vocabulary.
 *
 * Everything in `src/domain` is pure: no I/O, no database, no network, no AI.
 * These types are the contract between the domain core and every outer layer.
 */

/** UK jurisdictions are modelled explicitly and never as free text. */
export type Jurisdiction =
  | 'england'
  | 'wales'
  | 'scotland'
  | 'northern_ireland'
  | 'uk_wide';

export type LegalForm =
  | 'cic_limited_by_guarantee'
  | 'cic_limited_by_shares'
  | 'charity'
  | 'charitable_incorporated_organisation'
  | 'community_benefit_society'
  | 'company_limited_by_guarantee'
  | 'company_limited_by_shares'
  | 'unincorporated_association'
  | 'other';

export const CIC_LEGAL_FORMS = [
  'cic_limited_by_guarantee',
  'cic_limited_by_shares',
] as const satisfies readonly LegalForm[];

export function isCic(form: LegalForm): boolean {
  return (CIC_LEGAL_FORMS as readonly LegalForm[]).includes(form);
}

/**
 * How a funder treats the CIC legal form.
 *
 * This is the product's wedge. Funders exclude or admit CICs in distinct
 * patterns, and applicants routinely misread them in both directions.
 * `not_stated` is deliberately a first-class value: the honest response to
 * silence is to ask the funder, not to guess.
 */
/**
 * How a funder treats the CIC form, as its own guidance states it.
 *
 * The array is the single definition and the type is derived from it, so the
 * runtime list and the compile-time union cannot drift. They already did once:
 * the Analyst agent was written against invented values and only failed at the
 * database enum.
 */
export const CIC_TREATMENTS = [
  'explicitly_permitted',
  'charity_only',
  'asset_locked_only',
  'limited_by_guarantee_only',
  'no_share_capital_only',
  'permitted_with_conditions',
  'not_stated',
] as const;

export type CicTreatment = (typeof CIC_TREATMENTS)[number];

/** Confidence that an opportunity record still reflects reality. */
export type Freshness =
  | 'current'
  | 'recently_verified'
  | 'needs_verification'
  | 'stale'
  | 'closed'
  | 'unknown';

/**
 * The nature of a deadline. Kept separate from the date itself so that an
 * estimate can never be rendered as a confirmed date.
 */
export type DeadlineType =
  | 'confirmed'
  | 'rolling'
  | 'expected'
  | 'estimated'
  | 'unknown';

export type CapitalOrRevenue = 'capital' | 'revenue' | 'mixed';

/** Where a piece of information came from. Required on every stored fact. */
export type SourceType =
  | 'user'
  | 'document'
  | 'companies_house'
  | '360giving'
  | 'funder_published'
  | 'ai_extraction';

/** The applicant organisation, as far as it is currently known. */
export interface ApplicantProfile {
  legalForm: LegalForm;
  jurisdiction: Jurisdiction;
  /** Free-form region label, e.g. "Somerset". Null when not yet known. */
  region: string | null;
  /** ISO date (YYYY-MM-DD). Null when not yet known. */
  incorporationDate: string | null;
  annualTurnoverGbp: number | null;
}

/** The project the organisation wants funded. */
export interface ProjectRequest {
  amountSoughtGbp: number | null;
  durationMonths: number | null;
  beneficiaryGroups: string[];
  capitalOrRevenue: CapitalOrRevenue | null;
  hasMatchFunding: boolean | null;
}

/**
 * All CICs carry a statutory asset lock, regardless of whether they are
 * limited by guarantee or by shares.
 */
export function hasStatutoryAssetLock(form: LegalForm): boolean {
  return (
    isCic(form) ||
    form === 'charity' ||
    form === 'charitable_incorporated_organisation' ||
    form === 'community_benefit_society'
  );
}

/** Whether the legal form has share capital. */
export function hasShareCapital(form: LegalForm): boolean {
  return form === 'cic_limited_by_shares' || form === 'company_limited_by_shares';
}

/** Whether the legal form is limited by guarantee. */
export function isLimitedByGuarantee(form: LegalForm): boolean {
  return (
    form === 'cic_limited_by_guarantee' || form === 'company_limited_by_guarantee'
  );
}

const JURISDICTION_LABELS: Readonly<Record<Jurisdiction, string>> = {
  england: 'England',
  wales: 'Wales',
  scotland: 'Scotland',
  northern_ireland: 'Northern Ireland',
  uk_wide: 'the whole UK',
};

/**
 * Human-readable jurisdiction name.
 *
 * Enum values are a storage detail. They should never reach the user, who
 * reads "northern_ireland" as a bug, and rightly so.
 */
export function formatJurisdiction(value: Jurisdiction): string {
  return JURISDICTION_LABELS[value];
}

/** Format a list of jurisdictions as prose: "England, Wales and Scotland". */
export function formatJurisdictions(values: readonly Jurisdiction[]): string {
  const labels = values.map((v) => formatJurisdiction(v));
  if (labels.length === 0) return 'nowhere stated';
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)!}`;
}
