/**
 * Map Companies House records onto our domain.
 *
 * This is the highest-stakes mapping in the product. Companies House is the
 * only place we can learn, authoritatively, whether a CIC is limited by
 * guarantee or by shares — and that single fact decides whether a
 * `no_share_capital_only` or `limited_by_guarantee_only` fund is a pass or a
 * fail.
 *
 * 87% of CICs are limited by guarantee and 13% by shares, and founders
 * routinely do not know which they are. Self-declaration would therefore put
 * roughly one in eight users at risk of a confidently wrong verdict. That is
 * why this mapping exists.
 *
 * Its governing rule: NEVER GUESS. A company type we do not recognise yields
 * `null`, which the onboarding flow turns into a question for the user rather
 * than an assumption.
 */

import type { Jurisdiction, LegalForm } from '../../domain/types.js';
import type { RawAddress, RawCompanyProfile, RawSearchItem } from './types.js';

/** The subtype value Companies House uses to mark a CIC. */
export const CIC_SUBTYPE = 'community-interest-company';

/**
 * Company types with no share capital (members guarantee instead).
 * Source: Companies House api-enumerations constants.yml.
 */
const GUARANTEE_TYPES = new Set([
  'private-limited-guarant-nsc',
  'private-limited-guarant-nsc-limited-exemption',
]);

/** Company types that have share capital. */
const SHARE_TYPES = new Set([
  'ltd',
  'plc',
  'private-limited-shares-section-30-exemption',
  'old-public-company',
]);

const NON_CIC_FORMS: ReadonlyMap<string, LegalForm> = new Map([
  ['charitable-incorporated-organisation', 'charitable_incorporated_organisation'],
  ['scottish-charitable-incorporated-organisation', 'charitable_incorporated_organisation'],
  ['registered-society-non-jurisdictional', 'community_benefit_society'],
  ['industrial-and-provident-society', 'community_benefit_society'],
  ['private-limited-guarant-nsc', 'company_limited_by_guarantee'],
  ['private-limited-guarant-nsc-limited-exemption', 'company_limited_by_guarantee'],
  ['ltd', 'company_limited_by_shares'],
  ['plc', 'company_limited_by_shares'],
  ['private-limited-shares-section-30-exemption', 'company_limited_by_shares'],
]);

const JURISDICTIONS: ReadonlyMap<string, Jurisdiction> = new Map([
  ['england-wales', 'uk_wide'],
  ['england', 'england'],
  ['wales', 'wales'],
  ['scotland', 'scotland'],
  ['northern-ireland', 'northern_ireland'],
  ['united-kingdom', 'uk_wide'],
]);

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, 500);
}

function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (raw === null || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

export function isCicRecord(subtype: unknown): boolean {
  return text(subtype)?.toLowerCase() === CIC_SUBTYPE;
}

/**
 * Determine the legal form.
 *
 * Returns null when the combination is not one we recognise. The caller must
 * treat null as "ask the user", never as a default.
 */
export function toLegalForm(
  companyType: unknown,
  companySubtype: unknown,
): LegalForm | null {
  const type = text(companyType)?.toLowerCase() ?? null;
  if (type === null) return null;

  if (isCicRecord(companySubtype)) {
    if (GUARANTEE_TYPES.has(type)) return 'cic_limited_by_guarantee';
    if (SHARE_TYPES.has(type)) return 'cic_limited_by_shares';
    // A CIC of an unrecognised type. Do not guess which — the whole point of
    // consulting Companies House is to avoid that guess.
    return null;
  }

  return NON_CIC_FORMS.get(type) ?? null;
}

export function toJurisdiction(value: unknown): Jurisdiction | null {
  const raw = text(value)?.toLowerCase();
  return raw === undefined || raw === null ? null : (JURISDICTIONS.get(raw) ?? null);
}

export function formatAddress(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const address = value as RawAddress;
  const parts = [
    text(address.address_line_1),
    text(address.locality),
    text(address.region),
    text(address.postal_code),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(', ');
}

/** A company as shown in a picker. Enough to tell two similar names apart. */
export interface CompanyMatch {
  companyNumber: string;
  name: string;
  status: string | null;
  /** True when Companies House marks it a CIC. */
  isCic: boolean;
  /** Null when the type is unrecognised — the user is then asked. */
  legalForm: LegalForm | null;
  incorporatedOn: string | null;
  address: string | null;
}

export function toCompanyMatch(raw: RawSearchItem): CompanyMatch | null {
  const companyNumber = text(raw.company_number);
  const name = text(raw.title);
  if (companyNumber === null || name === null) return null;

  return {
    companyNumber,
    name,
    status: text(raw.company_status),
    isCic: isCicRecord(raw.company_subtype),
    legalForm: toLegalForm(raw.company_type, raw.company_subtype),
    incorporatedOn: isoDate(raw.date_of_creation),
    address: text(raw.address_snippet) ?? formatAddress(raw.address),
  };
}

export interface CompanyProfile extends CompanyMatch {
  jurisdiction: Jurisdiction | null;
  /** Set when the company has been dissolved. */
  ceasedOn: string | null;
}

export function toCompanyProfile(raw: RawCompanyProfile): CompanyProfile | null {
  const companyNumber = text(raw.company_number);
  const name = text(raw.company_name);
  if (companyNumber === null || name === null) return null;

  return {
    companyNumber,
    name,
    status: text(raw.company_status),
    isCic: isCicRecord(raw.subtype),
    legalForm: toLegalForm(raw.type, raw.subtype),
    incorporatedOn: isoDate(raw.date_of_creation),
    address: formatAddress(raw.registered_office_address),
    jurisdiction: toJurisdiction(raw.jurisdiction),
    ceasedOn: isoDate(raw.date_of_cessation),
  };
}

/** Whether the company can still apply for anything. */
export function isActive(profile: Pick<CompanyProfile, 'status'>): boolean {
  return profile.status === 'active';
}

/** A company number is 8 characters: digits, or two letters then six digits. */
export function looksLikeCompanyNumber(input: string): boolean {
  return /^(?:\d{8}|[A-Za-z]{2}\d{6})$/.test(input.trim());
}
