/**
 * The funder's budget rules, taken only from criteria a human has verified.
 *
 * `validateBudget` needs a `FunderRestrictions`. The question this module
 * answers is where one may honestly come from — and the answer is narrower
 * than the interface, which is the whole point of writing it down.
 *
 * ## What the verified criteria can tell us
 *
 * Two things, and they come from the same criteria the eligibility engine
 * already runs on:
 *
 *  - `amount` gives the funder's own minimum and maximum, so a budget that
 *    totals outside their range is caught.
 *  - `capital_revenue` gives which kinds of cost they pay for, so a capital
 *    line to a revenue-only funder is caught.
 *
 * ## What they cannot
 *
 * `excludedCategories` and `maxOverheadPercent` have no criterion kind behind
 * them. There is no honest way to fill them, so they are left empty and null —
 * **never guessed from the funder's prose**, which is exactly the kind of
 * invention this product refuses. Two of `validateBudget`'s checks therefore
 * cannot fire yet, and a screen that let somebody believe their overheads had
 * been checked against a cap would be worse than one that says nothing.
 *
 * So this returns what it DID check and what it could not, and the budget card
 * prints both. "We cannot verify this" is a required output, not a failure.
 */

import type { Criterion } from '../eligibility/types.js';
import type { FunderRestrictions } from './validate.js';

export interface RestrictionsFromFunder {
  restrictions: FunderRestrictions;
  /** Rules taken from this funder's own verified criteria. */
  known: string[];
  /** Rules we have nothing to check against, so nobody assumes we did. */
  unknown: string[];
}

/** Nothing known: permissive, because an unknown rule is not a prohibition. */
const NOTHING_KNOWN: FunderRestrictions = {
  excludedCategories: [],
  maxOverheadPercent: null,
  // Permitted rather than refused. `unknown` is never coerced to a fail, and
  // refusing every line of a budget because the funder published no cost-type
  // rule would be inventing a restriction rather than reporting one.
  capitalPermitted: true,
  revenuePermitted: true,
  minTotalGbp: null,
  maxTotalGbp: null,
};

export function restrictionsFromCriteria(
  criteria: readonly Criterion[],
): RestrictionsFromFunder {
  const restrictions: FunderRestrictions = { ...NOTHING_KNOWN };
  const known: string[] = [];

  const amount = criteria.find((c) => c.kind === 'amount');
  if (amount !== undefined && amount.kind === 'amount') {
    restrictions.minTotalGbp = amount.minGbp;
    restrictions.maxTotalGbp = amount.maxGbp;
    if (amount.minGbp !== null || amount.maxGbp !== null) {
      known.push(
        amount.minGbp !== null && amount.maxGbp !== null
          ? `they give between £${amount.minGbp.toLocaleString('en-GB')} and £${amount.maxGbp.toLocaleString('en-GB')}`
          : amount.maxGbp !== null
            ? `they give up to £${amount.maxGbp.toLocaleString('en-GB')}`
            : `they give at least £${(amount.minGbp ?? 0).toLocaleString('en-GB')}`,
      );
    }
  }

  const costType = criteria.find((c) => c.kind === 'capital_revenue');
  if (costType !== undefined && costType.kind === 'capital_revenue') {
    // 'mixed' means they will fund a budget containing both, so it permits
    // each on its own too.
    const permits = (kind: 'capital' | 'revenue'): boolean =>
      costType.permitted.includes(kind) || costType.permitted.includes('mixed');
    restrictions.capitalPermitted = permits('capital');
    restrictions.revenuePermitted = permits('revenue');
    known.push(
      restrictions.capitalPermitted && restrictions.revenuePermitted
        ? 'they fund both capital and running costs'
        : restrictions.capitalPermitted
          ? 'they fund capital costs only'
          : 'they fund running costs only',
    );
  }

  const unknown: string[] = [];
  if (amount === undefined) unknown.push('the size of grant they give');
  if (costType === undefined) unknown.push('whether they fund capital or running costs');
  // Always unknown, and said every time, because no criterion kind carries
  // either. If one is ever added, this is the line that has to change with it.
  unknown.push('which cost categories they refuse to pay for');
  unknown.push('any cap on overheads');

  return { restrictions, known, unknown };
}
