'use client';

import { useActionState, useState } from 'react';

import { readableClaim, SUGGESTED_CLAIMS } from '@/domain/provenance/self-declared';

import { addFactAction } from './actions';
import { EMPTY_SELF_DECLARED } from './state';

const CLAIM_HINT: Record<string, string> = {
  mission: 'Somewhere between a sentence and a short paragraph. Funders quote it back.',
  area_of_operation: 'Where you actually work — many funders restrict by area.',
  beneficiary_groups: 'Who you are for. Age, circumstance, place.',
  programme_description: 'What the work is, in the words you would use to a stranger.',
  annual_turnover: 'With the year it covers, e.g. “£118,400 for the year ending 31 March 2026”.',
  financial_year_end: 'The date your accounts run to.',
  staff_count: 'Headcount and full-time equivalent, if they differ.',
  volunteer_count: 'Regular volunteers, not everyone who has ever helped.',
  trustee_or_director_count: 'How many people are on the board.',
  people_supported_last_year: 'A number you could stand behind if asked.',
  outcomes_achieved: 'What changed because of the work.',
  safeguarding_policy: 'Whether you have one, and when it was last reviewed.',
  equal_opportunities_policy: 'Whether you have one, and when it was last reviewed.',
  previous_funders: 'Who has funded you before.',
  largest_grant_received: 'The biggest single grant, and roughly when.',
};

/**
 * Telling us something about yourself.
 *
 * The route to a fact that needs no key. It is deliberately a small form
 * rather than a wizard: somebody adding their turnover should be able to do it
 * in fifteen seconds and add the next one without the page moving underneath
 * them.
 *
 * The suggestions are the keys extraction uses, so a fact typed here and the
 * same fact read out of a document later are one fact rather than two.
 */
export function AddFact({ known, open = false }: { known: string[]; open?: boolean }) {
  const [state, submit, saving] = useActionState(addFactAction, EMPTY_SELF_DECLARED);
  const [claim, setClaim] = useState('');

  const remaining = SUGGESTED_CLAIMS.filter((suggested) => !known.includes(suggested));
  const choices = remaining.length > 0 ? remaining : SUGGESTED_CLAIMS;
  const hint = CLAIM_HINT[claim];

  return (
    <details className="card" id="add-fact" open={open}>
      <summary className="paste-summary">
        <span>Tell us something yourself</span>
        <span className="chev chev-toggle" aria-hidden="true" />
      </summary>

      <div className="paste-body">
        <p className="card-sub">
          Most facts come out of documents you share. You can also just tell us — it is
          recorded as <strong>you told us</strong> rather than as read from a document, and it
          counts as confirmed, because you are the one who would have confirmed it.
        </p>

        <form action={submit} style={{ marginTop: 'var(--s-5)' }}>
          <div className="field">
            <label className="label" htmlFor="claim">What is this about</label>
            <select
              id="claim"
              className="input"
              name="claim"
              value={claim}
              onChange={(event) => setClaim(event.target.value)}
            >
              <option value="">Choose one</option>
              {choices.map((option) => (
                <option key={option} value={option}>{readableClaim(option)}</option>
              ))}
            </select>
            {hint === undefined ? null : <p className="hint">{hint}</p>}
            {state.errors['claim'] === undefined ? null : (
              <p className="hint" style={{ color: 'var(--negative)' }}>{state.errors['claim']}</p>
            )}
          </div>

          <div className="field" style={{ marginTop: 'var(--s-4)' }}>
            <label className="label" htmlFor="customClaim">
              Or name it yourself <span className="hint">(optional)</span>
            </label>
            <input
              id="customClaim"
              className="input"
              name="customClaim"
              placeholder="Accreditations"
            />
            <p className="hint">
              Use this when the list has nothing for what you mean. Anything you type here is
              used instead of the choice above.
            </p>
          </div>

          <div className="field" style={{ marginTop: 'var(--s-4)' }}>
            <label className="label" htmlFor="value">What you would put on a form</label>
            <textarea
              id="value"
              className="input"
              name="value"
              rows={3}
              aria-invalid={state.errors['value'] !== undefined}
              required
            />
            {state.errors['value'] === undefined ? null : (
              <p className="hint" style={{ color: 'var(--negative)' }}>{state.errors['value']}</p>
            )}
          </div>

          <button className="btn btn-primary" type="submit" disabled={saving}
            style={{ marginTop: 'var(--s-5)' }}>
            {saving ? 'Saving…' : 'Save this fact'}
          </button>

          {state.message === '' ? null : (
            <p
              className={`notice ${state.saved ? 'notice-neutral' : 'notice-caution'}`}
              style={{ marginTop: 'var(--s-4)' }}
              role={state.saved ? 'status' : 'alert'}
            >
              {state.saved ? null : <span aria-hidden="true">⚠</span>}
              <span>{state.message}</span>
            </p>
          )}
        </form>
      </div>
    </details>
  );
}
