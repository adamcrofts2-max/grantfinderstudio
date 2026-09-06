/**
 * Map stored eligibility criteria into the domain's discriminated union.
 *
 * Criteria are held as `kind` plus a JSONB `params` blob, because the shape
 * differs per kind and a column-per-parameter table would be mostly nulls.
 * That flexibility ends here: a row whose params do not match its kind is
 * rejected rather than partially applied.
 *
 * A criterion that silently loses a bound — a maximum amount that arrives as
 * undefined, say — would turn a hard exclusion into a pass. Rejecting is the
 * only safe failure.
 */

import type { Criterion } from '../domain/eligibility/types.js';
import type { CapitalOrRevenue, CicTreatment, Jurisdiction, LegalForm } from '../domain/types.js';

export interface CriterionRow {
  id: string;
  kind: string;
  label: string;
  params: unknown;
  cic_handling: string | null;
}

export type MapResult =
  | { ok: true; criterion: Criterion }
  | { ok: false; id: string; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accepts a number or null; rejects anything else, including undefined. */
function nullableNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new TypeError(`${field} must be a number or null`);
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a number`);
  }
  return value;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean`);
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new TypeError(`${field} must be an array of strings`);
  }
  if (value.length === 0) throw new TypeError(`${field} must not be empty`);
  return value as string[];
}

const CIC_TREATMENTS = new Set<string>([
  'explicitly_permitted', 'charity_only', 'asset_locked_only',
  'limited_by_guarantee_only', 'no_share_capital_only',
  'permitted_with_conditions', 'not_stated',
]);

export function mapCriterion(row: CriterionRow): MapResult {
  try {
    if (!isRecord(row.params)) throw new TypeError('params must be an object');
    const p = row.params;
    const base = { id: row.id, label: row.label };

    switch (row.kind) {
      case 'legal_form': {
        const treatment = row.cic_handling;
        if (treatment === null || !CIC_TREATMENTS.has(treatment)) {
          throw new TypeError('legal_form requires a valid cic_handling value');
        }
        return {
          ok: true,
          criterion: {
            ...base,
            kind: 'legal_form',
            cicTreatment: treatment as CicTreatment,
            conditions: typeof p.conditions === 'string' ? p.conditions : null,
            permittedForms: Array.isArray(p.permittedForms)
              ? (p.permittedForms as LegalForm[])
              : null,
          },
        };
      }
      case 'jurisdiction':
        return {
          ok: true,
          criterion: {
            ...base,
            kind: 'jurisdiction',
            permitted: stringArray(p.permitted, 'permitted') as Jurisdiction[],
          },
        };
      case 'region':
        return {
          ok: true,
          criterion: {
            ...base,
            kind: 'region',
            permittedRegions: stringArray(p.permittedRegions, 'permittedRegions'),
          },
        };
      case 'amount':
        return {
          ok: true,
          criterion: {
            ...base,
            kind: 'amount',
            minGbp: nullableNumber(p.minGbp, 'minGbp'),
            maxGbp: nullableNumber(p.maxGbp, 'maxGbp'),
          },
        };
      case 'organisation_age':
        return {
          ok: true,
          criterion: {
            ...base,
            kind: 'organisation_age',
            minMonths: requiredNumber(p.minMonths, 'minMonths'),
          },
        };
      case 'turnover':
        return {
          ok: true,
          criterion: {
            ...base,
            kind: 'turnover',
            minGbp: nullableNumber(p.minGbp, 'minGbp'),
            maxGbp: nullableNumber(p.maxGbp, 'maxGbp'),
          },
        };
      case 'match_funding':
        return {
          ok: true,
          criterion: {
            ...base,
            kind: 'match_funding',
            required: requiredBoolean(p.required, 'required'),
          },
        };
      case 'capital_revenue':
        return {
          ok: true,
          criterion: {
            ...base,
            kind: 'capital_revenue',
            permitted: stringArray(p.permitted, 'permitted') as CapitalOrRevenue[],
          },
        };
      case 'beneficiary':
        return {
          ok: true,
          criterion: {
            ...base,
            kind: 'beneficiary',
            anyOf: stringArray(p.anyOf, 'anyOf'),
          },
        };
      case 'duration':
        return {
          ok: true,
          criterion: {
            ...base,
            kind: 'duration',
            minMonths: nullableNumber(p.minMonths, 'minMonths'),
            maxMonths: nullableNumber(p.maxMonths, 'maxMonths'),
          },
        };
      default:
        throw new TypeError(`unknown criterion kind "${row.kind}"`);
    }
  } catch (error) {
    return {
      ok: false,
      id: row.id,
      reason: error instanceof Error ? error.message : 'could not be read',
    };
  }
}

export interface MapBatch {
  criteria: Criterion[];
  rejected: Array<{ id: string; reason: string }>;
}

export function mapCriteria(rows: readonly CriterionRow[]): MapBatch {
  const criteria: Criterion[] = [];
  const rejected: MapBatch['rejected'] = [];
  for (const row of rows) {
    const result = mapCriterion(row);
    if (result.ok) criteria.push(result.criterion);
    else rejected.push({ id: result.id, reason: result.reason });
  }
  return { criteria, rejected };
}
