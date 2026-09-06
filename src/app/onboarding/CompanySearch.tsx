'use client';

import { useActionState } from 'react';
import { confirmCompanyAction, searchCompaniesAction } from './actions';
import { EMPTY_CONFIRM, EMPTY_SEARCH } from './state';
import type { CompanyMatch } from '@/ingestion/companieshouse/normalise';

const FORM_LABELS: Record<string, string> = {
  cic_limited_by_guarantee: 'CIC limited by guarantee',
  cic_limited_by_shares: 'CIC limited by shares',
  charitable_incorporated_organisation: 'Charitable incorporated organisation',
  community_benefit_society: 'Community benefit society',
  company_limited_by_guarantee: 'Company limited by guarantee',
  company_limited_by_shares: 'Company limited by shares',
};

function describeForm(match: CompanyMatch): string {
  if (match.legalForm === null) {
    return match.isCic
      ? 'Community Interest Company — we will ask you which type'
      : 'We will ask you about your legal form';
  }
  return FORM_LABELS[match.legalForm] ?? match.legalForm;
}

function Result({ match }: { match: CompanyMatch }) {
  const [confirm, adopt, adopting] = useActionState(confirmCompanyAction, EMPTY_CONFIRM);
  const dissolved = match.status !== null && match.status !== 'active';
  return (
    <li className="result">
      <div className="row-between" style={{ alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <p className="result-name">{match.name}</p>
          <p className="result-meta">
            {match.companyNumber}
            {match.incorporatedOn ? ` · incorporated ${match.incorporatedOn}` : null}
            {match.address ? ` · ${match.address}` : null}
          </p>
          <p className="result-form">{describeForm(match)}</p>
        </div>
        <div className="row" style={{ gap: 'var(--s-2)', flex: '0 0 auto' }}>
          {match.isCic ? (
            <span className="badge badge-accent">CIC</span>
          ) : (
            <span className="badge badge-neutral">Not a CIC</span>
          )}
          {dissolved ? <span className="badge badge-negative">{match.status}</span> : null}
        </div>
      </div>

      {dissolved ? (
        <p className="notice notice-caution" style={{ marginTop: 'var(--s-2)' }}>
          <span aria-hidden="true">⚠</span>
          <span>This company is {match.status}. Funders will not accept an application from it.</span>
        </p>
      ) : (
        <form action={adopt} style={{ marginTop: 'var(--s-3)' }}>
          <input type="hidden" name="companyNumber" value={match.companyNumber} />
          <button className="btn btn-primary" type="submit" disabled={adopting || confirm.saved}>
            {adopting ? 'Saving…' : confirm.saved ? 'Saved' : 'This is us'}
          </button>
        </form>
      )}

      <div aria-live="polite">
        {confirm.message ? (
          <p
            className={`notice ${confirm.saved ? 'notice-neutral' : 'notice-caution'}`}
            style={{ marginTop: 'var(--s-3)', color: confirm.saved ? 'var(--positive)' : undefined, fontWeight: 550 }}
          >
            <span aria-hidden="true">{confirm.saved ? '✓' : '⚠'}</span>
            <span>{confirm.message}</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function CompanySearch() {
  const [state, search, searching] = useActionState(searchCompaniesAction, EMPTY_SEARCH);
  const nothingFound = state.searched && state.problem === null && state.matches.length === 0;

  return (
    <>
      <form action={search}>
        <div className="field">
          <label className="label" htmlFor="query">
            Your organisation’s name
          </label>
          <div className="row" style={{ flexWrap: 'nowrap', gap: 'var(--s-2)' }}>
            <input
              id="query"
              name="query"
              className="input"
              type="text"
              defaultValue={state.query}
              placeholder="e.g. Mendip Green Futures"
              autoComplete="organization"
              required
              aria-describedby="query-hint"
            />
            <button className="btn btn-primary" type="submit" disabled={searching}>
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          <p className="hint" id="query-hint">
            We look you up on the Companies House register. If you know your company number,
            you can type that instead.
          </p>
        </div>
      </form>

      <div aria-live="polite">
        {state.problem ? (
          <p className="notice notice-caution" style={{ marginTop: 'var(--s-4)' }}>
            <span aria-hidden="true">⚠</span>
            <span>{state.problem}</span>
          </p>
        ) : null}

        {nothingFound ? (
          <p className="notice notice-neutral" style={{ marginTop: 'var(--s-4)' }}>
            <span>
              Nothing matched “{state.query}”. Try a shorter version of the name, or enter
              your details yourself below.
            </span>
          </p>
        ) : null}

        {state.matches.length > 0 ? (
          <>
            <p className="eyebrow" style={{ marginTop: 'var(--s-5)' }}>
              {state.matches.length === 1 ? '1 match' : `${state.matches.length} matches`}
            </p>
            <ul className="results">
              {state.matches.map((match) => (
                <Result key={match.companyNumber} match={match} />
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </>
  );
}
