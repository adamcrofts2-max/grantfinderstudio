'use client';

import { useActionState } from 'react';

import { addBudgetLineAction, removeBudgetLineAction } from './actions';
import { EMPTY_EDIT } from './state';
import { COST_CATEGORIES, categoryLabel } from '@/domain/budget/categories';
import type { BudgetLine, BudgetValidation } from '@/domain/budget/validate';

const money = (n: number): string =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * The budget, and what the funder's own rules make of it.
 *
 * ## Why the findings are not a score
 *
 * `validateBudget` returns errors and warnings with the funder's numbers in
 * them — "overheads are 22.4% of the budget; this funder caps them at 15%" —
 * because a budget is rejected for a reason and the reason is actionable. A
 * traffic light would be neither.
 *
 * ## Why it says what it could NOT check
 *
 * The rules come only from criteria a human has verified against the funder's
 * own words. Two of them — excluded categories, and a cap on overheads — have
 * no criterion kind behind them, so they are never checked, and a card that
 * let somebody believe otherwise would be worse than one that says nothing.
 * `restrictionsFromCriteria` returns that list and this prints it.
 */
export function BudgetPanel({
  applicationId,
  lines,
  validation,
  amountRequestedGbp,
  known,
  unknown,
}: {
  applicationId: string;
  lines: readonly BudgetLine[];
  validation: BudgetValidation;
  amountRequestedGbp: number | null;
  known: readonly string[];
  unknown: readonly string[];
}) {
  const [added, add, adding] = useActionState(addBudgetLineAction, EMPTY_EDIT);
  const [removed, remove] = useActionState(removeBudgetLineAction, EMPTY_EDIT);
  const result = added.message !== '' ? added : removed.message !== '' ? removed : null;
  /** The field the last rejection blamed, so the form points rather than shrugs. */
  const blame = (field: string): boolean => !added.ok && added.field === field;
  const errors = validation.findings.filter((f) => f.severity === 'error');
  const warnings = validation.findings.filter((f) => f.severity === 'warning');

  return (
    <section className="card" id="budget">
      <div className="row-between" style={{ alignItems: 'baseline' }}>
        <div>
          <h2 className="card-title">The budget</h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-1)' }}>
            {lines.length === 0
              ? 'What the money would be spent on. Most funders ask for this, and it is the line-by-line detail an assessor checks first.'
              : known.length === 0
                ? `${lines.length} line${lines.length === 1 ? '' : 's'}. There are no funder rules on record to check them against — only the total.`
                : `${lines.length} line${lines.length === 1 ? '' : 's'}, checked against what this funder has told us.`}
          </p>
        </div>
        {lines.length === 0 ? null : (
          <span className="metric-value" style={{ whiteSpace: 'nowrap' }}>
            {money(validation.totalGbp)}
          </span>
        )}
      </div>

      {lines.length > 0 ? (
        <table className="budget-table" style={{ marginTop: 'var(--s-4)' }}>
          <thead>
            <tr>
              <th scope="col">What it pays for</th>
              <th scope="col">Kind of cost</th>
              <th className="num" scope="col">Amount</th>
              <th scope="col"><span className="visually-hidden">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const lineErrors = validation.findings.filter((f) => f.lineId === line.id);
              return (
                <tr key={line.id}>
                  <td>
                    {line.description}
                    {lineErrors.map((finding) => (
                      <span className="line-problem" key={finding.code}>
                        {finding.message}
                      </span>
                    ))}
                  </td>
                  <td className="muted">{categoryLabel(line.category)}</td>
                  <td className="num">{money(line.amountGbp)}</td>
                  <td>
                    <form action={remove}>
                      <input type="hidden" name="applicationId" value={applicationId} />
                      <input type="hidden" name="lineId" value={line.id} />
                      <button className="btn btn-quiet" type="submit">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td />
              <td className="num">{money(validation.totalGbp)}</td>
              <td />
            </tr>
            {amountRequestedGbp === null ? null : (
              <tr>
                <th scope="row">You are asking for</th>
                <td />
                <td className="num">{money(amountRequestedGbp)}</td>
                <td />
              </tr>
            )}
          </tfoot>
        </table>
      ) : null}

      {errors.length > 0 ? (
        <ul className="blockers" style={{ marginTop: 'var(--s-4)' }}>
          {errors
            .filter((finding) => finding.lineId === undefined)
            .map((finding) => (
              <li key={finding.code}>{finding.message}</li>
            ))}
        </ul>
      ) : null}

      {warnings.map((finding) => (
        <p className="notice notice-caution" key={finding.code} style={{ marginTop: 'var(--s-3)' }}>
          <span aria-hidden="true">⚠</span>
          <span>{finding.message}</span>
        </p>
      ))}

      {lines.length > 0 && validation.isSubmittable ? (
        <p
          className="notice notice-neutral"
          style={{ marginTop: 'var(--s-3)', color: 'var(--positive)', fontWeight: 550 }}
        >
          <span aria-hidden="true">✓</span>
          <span>Nothing here would stop this budget going in.</span>
        </p>
      ) : null}

      <form action={add} style={{ marginTop: 'var(--s-5)' }}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <h3 className="card-title" style={{ fontSize: 'var(--t-md)' }}>
          Add a line
        </h3>
        <div className="field" style={{ marginTop: 'var(--s-3)' }}>
          <label className="label" htmlFor="budget-description">
            What it pays for
          </label>
          <input
            aria-invalid={blame('description')}
            className="input"
            id="budget-description"
            name="description"
            placeholder="e.g. Youth worker, 2 days a week for 12 months"
            type="text"
          />
          <p className="hint">
            The words an assessor reads. “Staff costs” tells them nothing; the sentence above
            tells them what they are buying.
          </p>
        </div>
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="budget-category">
              Kind of cost
            </label>
            <select
              aria-invalid={blame('category')}
              className="input"
              defaultValue="staff"
              id="budget-category"
              name="category"
            >
              {COST_CATEGORIES.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="budget-amount">
              Amount
            </label>
            <input
              aria-invalid={blame('amountGbp')}
              className="input"
              id="budget-amount"
              inputMode="decimal"
              name="amountGbp"
              placeholder="e.g. 18000"
              type="text"
            />
          </div>
        </div>
        <p className="hint">
          {COST_CATEGORIES.find((c) => c.id === 'overheads')?.hint}
        </p>
        <div className="row" style={{ marginTop: 'var(--s-4)' }}>
          <button className="btn btn-secondary" disabled={adding} type="submit">
            {adding ? 'Adding…' : 'Add this line'}
          </button>
        </div>
      </form>

      <div aria-live="polite">
        {result ? (
          <p
            className={`notice ${result.ok ? 'notice-neutral' : 'notice-caution'}`}
            style={{
              marginTop: 'var(--s-3)',
              color: result.ok ? 'var(--positive)' : undefined,
              fontWeight: 550,
            }}
          >
            <span aria-hidden="true">{result.ok ? '✓' : '⚠'}</span>
            <span>{result.message}</span>
          </p>
        ) : null}
      </div>

      <div className="card-foot">
        <p className="hint">
          {known.length === 0
            ? 'This funder has published no budget rules we could verify, so the only check here is that the total matches what you are asking for.'
            : `Checked against this funder's own verified terms: ${known.join('; ')}.`}
        </p>
        <p className="hint">
          <strong>Not checked:</strong> {unknown.join('; ')}. We hold nothing verified about
          those, and will not guess at them from a funder’s prose — read their guidance before
          you submit.
        </p>
      </div>
    </section>
  );
}
