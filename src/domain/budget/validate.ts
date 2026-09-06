/**
 * Budget validation against funder restrictions.
 *
 * Budgets are where applications quietly fail: a line the funder excludes, an
 * overhead rate above the cap, a total that does not match the amount asked
 * for. Assessors notice all three. None of these need a language model to
 * detect, so none of them use one.
 */

export type CostCategory =
  | 'staff'
  | 'freelancers'
  | 'equipment'
  | 'materials'
  | 'venues'
  | 'travel'
  | 'training'
  | 'marketing'
  | 'evaluation'
  | 'management'
  | 'overheads'
  | 'capital';

export interface BudgetLine {
  id: string;
  category: CostCategory;
  description: string;
  amountGbp: number;
}

export interface FunderRestrictions {
  /** Categories this funder will not pay for. */
  excludedCategories: readonly CostCategory[];
  /** Overheads cap as a percentage of the total, or null when uncapped. */
  maxOverheadPercent: number | null;
  capitalPermitted: boolean;
  revenuePermitted: boolean;
  minTotalGbp: number | null;
  maxTotalGbp: number | null;
}

export type FindingSeverity = 'error' | 'warning';

export interface BudgetFinding {
  severity: FindingSeverity;
  code: string;
  message: string;
  /** Budget line this concerns, when it concerns one. */
  lineId?: string;
}

export interface BudgetValidation {
  totalGbp: number;
  findings: BudgetFinding[];
  /** True when nothing would stop this budget being submitted. */
  isSubmittable: boolean;
}

const CAPITAL_CATEGORIES: ReadonlySet<CostCategory> = new Set(['capital', 'equipment']);

function gbp(value: number): string {
  return `£${value.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
}

export function budgetTotal(lines: readonly BudgetLine[]): number {
  return lines.reduce((sum, line) => sum + line.amountGbp, 0);
}

/**
 * Validate a budget.
 *
 * `amountRequestedGbp` is what the application asks the funder for. When the
 * budget does not sum to it, that is an error rather than a warning: it is the
 * single most common avoidable rejection in a grant budget.
 */
export function validateBudget(
  lines: readonly BudgetLine[],
  restrictions: FunderRestrictions,
  amountRequestedGbp: number | null,
): BudgetValidation {
  const findings: BudgetFinding[] = [];
  const total = budgetTotal(lines);

  if (lines.length === 0) {
    findings.push({
      severity: 'error',
      code: 'budget_empty',
      message: 'The budget has no lines.',
    });
  }

  for (const line of lines) {
    if (line.amountGbp <= 0) {
      findings.push({
        severity: 'error',
        code: 'line_not_positive',
        message: `"${line.description}" has an amount of ${gbp(line.amountGbp)}.`,
        lineId: line.id,
      });
    }

    if (restrictions.excludedCategories.includes(line.category)) {
      findings.push({
        severity: 'error',
        code: 'category_excluded',
        message: `This funder does not pay for ${line.category}, but "${line.description}" is a ${line.category} cost.`,
        lineId: line.id,
      });
    }

    const isCapitalLine = CAPITAL_CATEGORIES.has(line.category);
    if (isCapitalLine && !restrictions.capitalPermitted) {
      findings.push({
        severity: 'error',
        code: 'capital_not_permitted',
        message: `This funder does not fund capital costs, but "${line.description}" is one.`,
        lineId: line.id,
      });
    }
    if (!isCapitalLine && !restrictions.revenuePermitted) {
      findings.push({
        severity: 'error',
        code: 'revenue_not_permitted',
        message: `This funder funds capital costs only, but "${line.description}" is a running cost.`,
        lineId: line.id,
      });
    }
  }

  if (restrictions.maxOverheadPercent !== null && total > 0) {
    const overheads = lines
      .filter((l) => l.category === 'overheads')
      .reduce((sum, l) => sum + l.amountGbp, 0);
    const percent = (overheads / total) * 100;
    if (percent > restrictions.maxOverheadPercent) {
      findings.push({
        severity: 'error',
        code: 'overheads_exceed_cap',
        message: `Overheads are ${percent.toFixed(1)}% of the budget; this funder caps them at ${restrictions.maxOverheadPercent}%.`,
      });
    }
  }

  if (restrictions.minTotalGbp !== null && total < restrictions.minTotalGbp) {
    findings.push({
      severity: 'error',
      code: 'total_below_minimum',
      message: `The budget totals ${gbp(total)}; this funder's minimum is ${gbp(restrictions.minTotalGbp)}.`,
    });
  }
  if (restrictions.maxTotalGbp !== null && total > restrictions.maxTotalGbp) {
    findings.push({
      severity: 'error',
      code: 'total_above_maximum',
      message: `The budget totals ${gbp(total)}; this funder's maximum is ${gbp(restrictions.maxTotalGbp)}.`,
    });
  }

  if (amountRequestedGbp !== null && lines.length > 0) {
    // Tolerate rounding to the nearest penny, nothing more.
    if (Math.abs(total - amountRequestedGbp) > 0.005) {
      findings.push({
        severity: 'error',
        code: 'total_mismatch',
        message: `The budget totals ${gbp(total)} but the application asks for ${gbp(amountRequestedGbp)}.`,
      });
    }
  }

  if (amountRequestedGbp === null && lines.length > 0) {
    findings.push({
      severity: 'warning',
      code: 'amount_requested_unknown',
      message: 'We do not yet know how much you are asking for, so we cannot check the budget against it.',
    });
  }

  return {
    totalGbp: total,
    findings,
    isSubmittable: !findings.some((f) => f.severity === 'error'),
  };
}
