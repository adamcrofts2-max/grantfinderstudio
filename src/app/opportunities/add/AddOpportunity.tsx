'use client';

import { useActionState, useState } from 'react';

import { addOpportunityAction } from './actions';
import { IDLE } from './state';

/**
 * Paste a funder's guidance to add a fund.
 *
 * The copy carries a real finding, not a apology: there is no machine-readable
 * source of open UK trust and foundation calls, so the applicant bringing the
 * fund is the design rather than a gap in it. Saying so plainly is better than
 * an empty search box that implies a database we do not have.
 */
export function AddOpportunity({ ready = true }: { ready?: boolean }) {
  const [state, add, adding] = useActionState(addOpportunityAction, IDLE);
  const [guidance, setGuidance] = useState('');

  const tooShort = guidance.trim().length > 0 && guidance.trim().length < 200;

  return (
    <form className="card" action={add}>
      <h2 className="card-title">Paste the funder’s guidance</h2>
      <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
        The eligibility section and the deadline are the parts that matter. We turn them into
        rules you can check — and nothing is used to judge anything until you have.
      </p>

      <div className="field" style={{ marginTop: 'var(--s-4)' }}>
        <label className="label" htmlFor="sourceUrl">
          Web address of the guidance <span className="hint">(optional)</span>
        </label>
        <input
          id="sourceUrl"
          className="input"
          type="url"
          name="sourceUrl"
          placeholder="https://example.org/our-grants"
        />
      </div>

      <div className="field" style={{ marginTop: 'var(--s-4)' }}>
        <label className="label" htmlFor="guidance">
          The guidance itself
        </label>
        <textarea
          id="guidance"
          className="input"
          name="guidance"
          rows={12}
          value={guidance}
          onChange={(event) => setGuidance(event.target.value)}
          placeholder={
            'Who can apply\nWe fund registered charities and community interest companies working in the South West.\n\nGrant size\nBetween £5,000 and £25,000.\n\nDeadline\nApplications close on 30 November 2026.'
          }
        />
        <p className="hint">
          {guidance.trim().length === 0
            ? 'Copy the whole page if it is easier — we will pick out what matters.'
            : `${guidance.trim().length.toLocaleString('en-GB')} characters pasted.`}
        </p>
      </div>

      {tooShort ? (
        <p className="notice notice-caution">
          <span aria-hidden="true">⚠</span>
          <span>That looks like too little to go on. Include the eligibility rules.</span>
        </p>
      ) : null}

      {/* An enabled primary button that cannot possibly work is worse than a
          disabled one: it spends somebody's paste, their wait and their trust
          before telling them what the page already knew. */}
      <button
        className="btn btn-primary"
        type="submit"
        disabled={!ready || adding || guidance.trim().length < 200}
        style={{ marginTop: 'var(--s-4)' }}
      >
        {adding ? 'Reading the guidance…' : 'Read this fund'}
      </button>
      {ready ? null : (
        <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
          Reading guidance is not switched on for this deployment. Whoever runs it can turn
          it on; in the meantime, typing the fund in yourself works and needs nothing.
        </p>
      )}

      {adding ? (
        <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
          This takes a few seconds. Nothing is saved until it has been read.
        </p>
      ) : null}

      {state.ok === false ? (
        <p className="notice notice-caution" style={{ marginTop: 'var(--s-4)' }} role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{state.message}</span>
        </p>
      ) : null}
    </form>
  );
}
