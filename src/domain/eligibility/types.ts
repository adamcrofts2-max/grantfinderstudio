import type {
  CapitalOrRevenue,
  CicTreatment,
  Jurisdiction,
  LegalForm,
} from '../types.js';

/** The outcome of a single criterion. `unknown` is never coerced. */
export type CriterionOutcome = 'pass' | 'fail' | 'unknown';

export interface CriterionResult {
  criterionId: string;
  label: string;
  outcome: CriterionOutcome;
  /** Human-readable explanation. Always populated, including for `pass`. */
  reason: string;
  /**
   * A concrete next step when the outcome is `unknown`. Turning an unknown
   * into an action is more useful to the applicant than a confidence score.
   */
  action?: string;
}

/**
 * A machine-evaluable eligibility rule.
 *
 * Criteria are produced by extracting funder guidance into this structured
 * form and are verified by a human before first use. The AI layer may propose
 * criteria; it never evaluates them.
 */
export type Criterion =
  | {
      kind: 'legal_form';
      id: string;
      label: string;
      /** How the funder treats the CIC form specifically. */
      cicTreatment: CicTreatment;
      /** Conditions text, required when cicTreatment is 'permitted_with_conditions'. */
      conditions?: string | null;
      /** Authoritative list used for non-CIC applicants. Null when not stated. */
      permittedForms?: readonly LegalForm[] | null;
    }
  | {
      kind: 'jurisdiction';
      id: string;
      label: string;
      permitted: readonly Jurisdiction[];
    }
  | {
      kind: 'region';
      id: string;
      label: string;
      /** Matched case-insensitively against the applicant's region. */
      permittedRegions: readonly string[];
    }
  | {
      kind: 'amount';
      id: string;
      label: string;
      minGbp: number | null;
      maxGbp: number | null;
    }
  | {
      kind: 'organisation_age';
      id: string;
      label: string;
      minMonths: number;
    }
  | {
      kind: 'turnover';
      id: string;
      label: string;
      minGbp: number | null;
      maxGbp: number | null;
    }
  | {
      kind: 'match_funding';
      id: string;
      label: string;
      required: boolean;
    }
  | {
      kind: 'capital_revenue';
      id: string;
      label: string;
      permitted: readonly CapitalOrRevenue[];
    }
  | {
      kind: 'beneficiary';
      id: string;
      label: string;
      /** Applicant passes if any of its beneficiary groups appears here. */
      anyOf: readonly string[];
    }
  | {
      kind: 'duration';
      id: string;
      label: string;
      minMonths: number | null;
      maxMonths: number | null;
    };

/** Overall verdict. Deliberately not a percentage. */
export type Verdict = 'eligible' | 'ineligible' | 'unknown';

export interface EligibilityVerdict {
  verdict: Verdict;
  results: CriterionResult[];
  /** Criteria that could not be decided, in evaluation order. */
  unknowns: CriterionResult[];
  /** Criteria the applicant fails, in evaluation order. */
  failures: CriterionResult[];
}

export interface EvaluationContext {
  /** ISO date (YYYY-MM-DD) used for any age calculation. Injected for determinism. */
  asOf: string;
}
