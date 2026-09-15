'use client';

import { useActionState } from 'react';

import { addOutcomeAction, removeOutcomeAction } from './actions';
import { EMPTY_EDIT } from './state';
import type { Outcome } from '@/db/outcomes';

/**
 * What the money would achieve, as a logic model.
 *
 * ## Why three boxes and not one
 *
 * Activity, output, outcome. "We will run 12 workshops" is an output; "34
 * young people moved into work or training" is an outcome; and conflating them
 * is the single most common weakness an assessor names. One free-text box
 * would let that happen. Three make the form ask the question.
 *
 * The indicator and target are optional on purpose. Plenty of funders do not
 * ask for them, and a blank is honest where an invented measure would not be —
 * this product does not fill a field to look complete.
 */
export function OutcomesPanel({
  applicationId,
  outcomes,
}: {
  applicationId: string;
  outcomes: readonly Outcome[];
}) {
  const [added, add, adding] = useActionState(addOutcomeAction, EMPTY_EDIT);
  const [removed, remove] = useActionState(removeOutcomeAction, EMPTY_EDIT);
  const result = added.message !== '' ? added : removed.message !== '' ? removed : null;
  const blame = (field: string): boolean => !added.ok && added.field === field;

  return (
    <section className="card" id="outcomes">
      <h2 className="card-title">What it would achieve</h2>
      <p className="card-sub" style={{ marginTop: 'var(--s-1)' }}>
        {outcomes.length === 0
          ? 'What you will do, what that produces, and what changes as a result. Funders ask for all three, and the difference between the last two is what they read most closely.'
          : `${outcomes.length} row${outcomes.length === 1 ? '' : 's'}. Each one is an activity, what it produces, and what changes because of it.`}
      </p>

      {outcomes.length > 0 ? (
        <ol className="logic-model" style={{ marginTop: 'var(--s-4)' }}>
          {outcomes.map((row) => (
            <li key={row.id}>
              <div className="logic-row">
                <div>
                  <p className="eyebrow">We will</p>
                  <p>{row.activity}</p>
                </div>
                <div>
                  <p className="eyebrow">Which produces</p>
                  <p>{row.output}</p>
                </div>
                <div>
                  <p className="eyebrow">So that</p>
                  <p>{row.outcome}</p>
                </div>
              </div>
              {row.indicator === null && row.target === null ? (
                <p className="hint">
                  No measure recorded. Fine unless this funder asks how you will know.
                </p>
              ) : (
                <p className="hint">
                  Measured by {row.indicator ?? 'an unstated indicator'}
                  {row.target === null ? '' : `, target ${row.target}`}.
                </p>
              )}
              <form action={remove}>
                <input type="hidden" name="applicationId" value={applicationId} />
                <input type="hidden" name="outcomeId" value={row.id} />
                <button className="btn btn-quiet" type="submit">
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ol>
      ) : null}

      <form action={add} style={{ marginTop: 'var(--s-5)' }}>
        <input type="hidden" name="applicationId" value={applicationId} />
        <h3 className="card-title" style={{ fontSize: 'var(--t-md)' }}>
          Add a row
        </h3>
        <div className="field" style={{ marginTop: 'var(--s-3)' }}>
          <label className="label" htmlFor="outcome-activity">
            What you will do
          </label>
          <input
            aria-invalid={blame('activity')}
            className="input"
            id="outcome-activity"
            name="activity"
            placeholder="Run a weekly evening skills session in Wells"
            type="text"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="outcome-output">
            What that produces
          </label>
          <input
            aria-invalid={blame('output')}
            className="input"
            id="outcome-output"
            name="output"
            placeholder="40 sessions a year, reaching 60 young people"
            type="text"
          />
          <p className="hint">
            Countable. This is the output — how much of the activity there is.
          </p>
        </div>
        <div className="field">
          <label className="label" htmlFor="outcome-outcome">
            What changes as a result
          </label>
          <input
            aria-invalid={blame('outcome')}
            className="input"
            id="outcome-outcome"
            name="outcome"
            placeholder="At least 25 of them move into work, training or further education"
            type="text"
          />
          <p className="hint">
            The outcome — what is different for somebody afterwards. Not the activity again.
          </p>
        </div>
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="outcome-indicator">
              How you would know <span className="optional">(optional)</span>
            </label>
            <input
              className="input"
              id="outcome-indicator"
              name="indicator"
              placeholder="Destination survey at 6 months"
              type="text"
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="outcome-target">
              Target <span className="optional">(optional)</span>
            </label>
            <input
              className="input"
              id="outcome-target"
              name="target"
              placeholder="25 of 60"
              type="text"
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 'var(--s-4)' }}>
          <button className="btn btn-primary" disabled={adding} type="submit">
            {adding ? 'Adding…' : 'Add this row'}
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
    </section>
  );
}
