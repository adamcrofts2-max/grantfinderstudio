'use client';

import { useActionState, useState } from 'react';
import { confirmFactAction, correctFactAction } from './actions';
import { EMPTY_FACT_ACTION } from './state';

export interface FactView {
  id: string;
  claim: string;
  value: string;
  source: string;
  sourceSpan: string | null;
  confidence: string;
  confirmed: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  companies_house: 'Companies House',
  document: 'Your documents',
  user: 'You told us',
  ai_extraction: 'Read from a document',
  '360giving': '360Giving',
  funder_published: 'The funder',
};

/** Turn a stored claim key into something a person would say. */
function readable(claim: string): string {
  return claim.replaceAll('_', ' ').replace(/^./u, (c) => c.toUpperCase());
}

/**
 * One fact, as a row rather than a card.
 *
 * Checking nine facts is one job done nine times, so the row carries one
 * decision — "that's right" — and demotes everything else. The "needs
 * checking" badge is gone: the section heading counts them and the button
 * says what is being asked. Correcting is rarer than confirming, so it is a
 * quiet control rather than a second button of equal weight.
 */
function Fact({ fact }: { fact: FactView }) {
  const [confirmState, confirm, confirming] = useActionState(confirmFactAction, EMPTY_FACT_ACTION);
  const [correctState, correct, correcting] = useActionState(correctFactAction, EMPTY_FACT_ACTION);
  const [editing, setEditing] = useState(false);

  const result =
    confirmState.factId === fact.id ? confirmState
    : correctState.factId === fact.id ? correctState
    : null;
  const confirmed = fact.confirmed || (result?.ok ?? false);

  return (
    <li className="fact">
      <div className="fact-main">
        <div className="fact-body">
          <p className="fact-claim">{readable(fact.claim)}</p>
          <p className="fact-value">{fact.value}</p>
          <p className="fact-source">
            {SOURCE_LABEL[fact.source] ?? fact.source}
            {fact.confidence === 'high' ? null : ` · ${fact.confidence} confidence`}
          </p>
        </div>

        {confirmed ? (
          <p className="fact-done">
            <span aria-hidden="true">✓</span> Confirmed
          </p>
        ) : editing ? null : (
          <div className="fact-do">
            <form action={confirm}>
              <input type="hidden" name="factId" value={fact.id} />
              <button className="btn btn-primary btn-small" type="submit" disabled={confirming}>
                {confirming ? 'Confirming…' : 'That’s right'}
              </button>
            </form>
            <button className="link-quiet" type="button" onClick={() => setEditing(true)}>
              Correct it
            </button>
          </div>
        )}
      </div>

      {fact.sourceSpan ? <p className="fact-span">“{fact.sourceSpan}”</p> : null}

      {confirmed || !editing ? null : (
        <form action={correct} className="fact-edit">
          <input type="hidden" name="factId" value={fact.id} />
          <label className="sr-only" htmlFor={`v-${fact.id}`}>
            Correct value for {readable(fact.claim)}
          </label>
          <input
            id={`v-${fact.id}`}
            name="value"
            className="input"
            defaultValue={fact.value}
            required
          />
          <button className="btn btn-primary btn-small" type="submit" disabled={correcting}>
            {correcting ? 'Saving…' : 'Save'}
          </button>
          <button className="link-quiet" type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}

      <div aria-live="polite">
        {result?.message && !result.ok ? (
          <p className="notice notice-caution" style={{ marginTop: 'var(--s-2)' }}>
            <span aria-hidden="true">⚠</span>
            <span>{result.message}</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function FactList({ facts }: { facts: FactView[] }) {
  const unconfirmed = facts.filter((f) => !f.confirmed);
  const confirmed = facts.filter((f) => f.confirmed);

  return (
    <>
      <section className="card">
        <h2 className="card-title">
          {unconfirmed.length === 0
            ? 'Everything is checked'
            : `${unconfirmed.length} to check`}
        </h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          Nothing here is used in an application until you have said it is right. That is what
          stops a funding bid resting on something nobody verified.
        </p>
        {unconfirmed.length > 0 ? (
          <ul className="facts">
            {unconfirmed.map((fact) => (
              <Fact key={fact.id} fact={fact} />
            ))}
          </ul>
        ) : null}
      </section>

      {confirmed.length > 0 ? (
        <section className="card">
          <h2 className="card-title">Confirmed — {confirmed.length}</h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            These are what your applications are written from. You will not be asked for them again.
          </p>
          <ul className="facts">
            {confirmed.map((fact) => (
              <Fact key={fact.id} fact={fact} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
