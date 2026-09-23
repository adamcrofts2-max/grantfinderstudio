'use client';

import { useActionState, useState } from 'react';

import { recordDecisionAction } from './actions';
import { EMPTY_DECISION } from './state';
import type { Decision } from '@/domain/tracker/decision';

/**
 * Telling the product what the funder said.
 *
 * ## Why it is three buttons and not a tick box
 *
 * "Did you get it? yes/no" loses the commonest outcome of all. Most UK grant
 * applications are simply never answered, and a product that forces that into
 * "no" tells the applicant they failed at something nobody ever judged. The
 * third option is the honest one and it costs a single extra radio.
 *
 * ## Why the amount box appears and disappears
 *
 * It belongs only on an award, and the server says so — but a box that is
 * present, typed into, and then refused is a worse conversation than one that
 * was never offered. The server keeps the rule; this keeps the person from
 * meeting it.
 *
 * ## Why `today` is a prop
 *
 * It caps the date input, and a clock read during a client render gives one
 * answer in the server's HTML and another on hydration — React #418, and the
 * tree thrown away. The page reads the clock once and passes it down, which is
 * also what keeps one render internally consistent.
 */
const ANSWERS: ReadonlyArray<{ value: Decision; label: string; hint: string }> = [
  { value: 'awarded', label: 'We were funded', hint: 'In full or in part.' },
  { value: 'rejected', label: 'Turned down', hint: 'They came back and said no.' },
  {
    value: 'no_reply',
    label: 'Never heard back',
    hint: 'Counted separately. Silence is not a refusal.',
  },
];

export function DecisionForm({
  applicationId,
  today,
}: {
  applicationId: string;
  /** ISO date, read once by the page so every row agrees on what "today" is. */
  today: string;
}) {
  const [state, submit, saving] = useActionState(recordDecisionAction, EMPTY_DECISION);
  const [answer, setAnswer] = useState<Decision | null>(null);
  const mine = state.applicationId === applicationId;
  const problem = mine && !state.ok && state.message !== '' ? state : null;
  const errorId = `decision-error-${applicationId}`;

  return (
    <details className="card paste decision-form">
      <summary className="paste-summary">
        Record the funder’s answer
        <span className="chev chev-toggle" />
      </summary>
      <div className="paste-body">
        <p className="card-sub">
          Whatever they said. Your own results are the only evidence about funding that
          belongs to you outright, and they are what the next application argues from.
        </p>

        <form action={submit} style={{ marginTop: 'var(--s-4)' }}>
          <input name="applicationId" type="hidden" value={applicationId} />

          <fieldset className="decision-answers">
            <legend>What did they say?</legend>
            {ANSWERS.map((option) => (
              <label className="decision-answer" key={option.value}>
                <input
                  checked={answer === option.value}
                  name="decision"
                  onChange={() => setAnswer(option.value)}
                  type="radio"
                  value={option.value}
                />
                <span>
                  <strong>{option.label}</strong>
                  <span className="hint">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="field-row" style={{ marginTop: 'var(--s-4)' }}>
            <div className="field">
              <label className="label" htmlFor={`decision-date-${applicationId}`}>
                When did you hear?
              </label>
              <input
                aria-describedby={problem?.field === 'decidedOn' ? errorId : undefined}
                aria-invalid={problem?.field === 'decidedOn'}
                className="input"
                id={`decision-date-${applicationId}`}
                max={today}
                name="decidedOn"
                type="date"
              />
              <p className="hint">
                The day their answer arrived. For silence, the day you decided to stop
                waiting.
              </p>
            </div>

            {answer === 'awarded' ? (
              <div className="field">
                <label className="label" htmlFor={`decision-amount-${applicationId}`}>
                  How much, in pounds
                </label>
                <input
                  aria-describedby={
                    problem?.field === 'amountAwardedGbp' ? errorId : undefined
                  }
                  aria-invalid={problem?.field === 'amountAwardedGbp'}
                  className="input"
                  id={`decision-amount-${applicationId}`}
                  inputMode="decimal"
                  name="amountAwardedGbp"
                  placeholder="e.g. 12500"
                  type="text"
                />
                <p className="hint">
                  What they actually gave, which is often less than you asked for. Leave it
                  empty if they have not said yet.
                </p>
              </div>
            ) : null}
          </div>

          <div className="field" style={{ marginTop: 'var(--s-4)' }}>
            <label className="label" htmlFor={`decision-note-${applicationId}`}>
              Anything they told you (optional)
            </label>
            <textarea
              aria-describedby={problem?.field === 'note' ? errorId : undefined}
              aria-invalid={problem?.field === 'note'}
              className="input"
              id={`decision-note-${applicationId}`}
              name="note"
              rows={3}
            />
            <p className="hint">
              Their reasons, in their words if you have them. This is the part that is
              worth most when you apply to them again.
            </p>
          </div>

          {problem === null ? null : (
            <p
              className="notice notice-negative"
              id={errorId}
              role="alert"
              style={{ marginTop: 'var(--s-4)' }}
            >
              <span aria-hidden="true">✕</span>
              <span>{problem.message}</span>
            </p>
          )}

          <button
            className="btn btn-primary"
            disabled={saving}
            style={{ marginTop: 'var(--s-4)' }}
            type="submit"
          >
            {saving ? 'Recording…' : 'Record it'}
          </button>
        </form>
      </div>
    </details>
  );
}
