'use client';

import { useActionState } from 'react';

import { JURISDICTIONS } from '@/domain/types';

import { selectKey, valueOf } from '@/app/formValues';

import { ingestFunderAction } from './actions';
import { EMPTY_INGEST } from './state';

const JURISDICTION_LABEL: Record<string, string> = {
  england: 'England',
  wales: 'Wales',
  scotland: 'Scotland',
  northern_ireland: 'Northern Ireland',
  uk_wide: 'UK-wide',
};

/**
 * Loading one funder's grants.
 *
 * Per funder rather than a corpus-wide button, because that is the shape of
 * the work: an operator who has just been asked about a trust loads that
 * trust. It finishes inside a request instead of needing a job runner this
 * product does not have.
 *
 * The licence fields have no defaults. Publishers choose their own licences
 * and some are share-alike, so pre-filling "CC BY 4.0" would put the wrong
 * licence on somebody else's data every time an operator tabbed past it.
 */
export function IngestForm() {
  const [state, submit, running] = useActionState(ingestFunderAction, EMPTY_INGEST);
  const error = (field: string): string | undefined => state.errors[field];
  const was = (field: string): string => valueOf(state.values, field);

  const problem = (field: string) =>
    error(field) === undefined ? null : (
      <p className="hint" style={{ color: 'var(--negative)' }}>{error(field)}</p>
    );

  return (
    <form action={submit}>
      <div className="field">
        <label className="label" htmlFor="orgId">360Giving organisation id</label>
        <input
          id="orgId"
          className="input input-mono"
          name="orgId"
          placeholder="GB-CHC-1164883"
          aria-invalid={error('orgId') !== undefined}
          required
            defaultValue={was('orgId')}
          />
        <p className="hint">
          From the publisher’s page on the 360Giving registry — usually their charity or
          company number with a register prefix.
        </p>
        {problem('orgId')}
      </div>

      <div className="row" style={{ marginTop: 'var(--s-4)', alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: '1 1 16rem' }}>
          <label className="label" htmlFor="funderName">Funder name</label>
          <input id="funderName" className="input" name="funderName"
            placeholder="Somerset Community Foundation" required
            defaultValue={was('funderName')}
          />
          {problem('funderName')}
        </div>
        <div className="field" style={{ flex: '1 1 10rem' }}>
          <label className="label" htmlFor="jurisdiction">
            Jurisdiction <span className="hint">(optional)</span>
          </label>
          <select key={selectKey(state.values, 'jurisdiction')} id="jurisdiction" className="input" name="jurisdiction"
            defaultValue={was('jurisdiction')}>
            <option value="">Not stated</option>
            {JURISDICTIONS.map((j) => (
              <option key={j} value={j}>{JURISDICTION_LABEL[j] ?? j}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="field" style={{ marginTop: 'var(--s-4)' }}>
        <label className="label" htmlFor="website">
          Website <span className="hint">(optional)</span>
        </label>
        <input id="website" className="input" name="website" type="url"
          placeholder="https://example.org"
            defaultValue={was('website')}
          />
        {problem('website')}
      </div>

      <fieldset className="ingest-licence">
        <legend>Licence — from the publisher’s own terms</legend>
        <p className="hint" style={{ marginTop: 0 }}>
          Publishers choose their own open licence and some are share-alike, so nothing here
          is pre-filled. Read their terms and copy them across. The ingest refuses to run
          without both fields.
        </p>

        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <label className="label" htmlFor="publisher">Publisher</label>
          <input id="publisher" className="input" name="publisher"
            placeholder="Somerset Community Foundation" required
            defaultValue={was('publisher')}
          />
          {problem('publisher')}
        </div>

        <div className="row" style={{ marginTop: 'var(--s-4)', alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: '1 1 10rem' }}>
            <label className="label" htmlFor="licence">Licence</label>
            <input id="licence" className="input" name="licence" placeholder="CC BY 4.0" required
            defaultValue={was('licence')}
          />
            {problem('licence')}
          </div>
          <div className="field" style={{ flex: '1 1 14rem' }}>
            <label className="label" htmlFor="licenceUrl">
              Licence URL <span className="hint">(optional)</span>
            </label>
            <input id="licenceUrl" className="input" name="licenceUrl" type="url"
              placeholder="https://creativecommons.org/licenses/by/4.0/"
            defaultValue={was('licenceUrl')}
          />
          </div>
        </div>

        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <label className="label" htmlFor="attribution">Attribution</label>
          <input id="attribution" className="input" name="attribution"
            placeholder="Grant data © Somerset Community Foundation, via 360Giving" required
            defaultValue={was('attribution')}
          />
          <p className="hint">The credit line their licence requires. Shown wherever this data is.</p>
          {problem('attribution')}
        </div>
      </fieldset>

      <button className="btn btn-primary" type="submit" disabled={running}
        style={{ marginTop: 'var(--s-5)' }}>
        {running ? 'Fetching…' : 'Load this funder’s grants'}
      </button>
      {running ? (
        <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
          Two requests a second, so a large publisher takes a while. Nothing is written until
          the fetch finishes.
        </p>
      ) : null}

      {state.message === '' ? null : (
        <div
          className={`notice ${state.ok ? 'notice-neutral' : 'notice-caution'}`}
          style={{ marginTop: 'var(--s-4)' }}
          role={state.ok ? 'status' : 'alert'}
        >
          {state.ok ? null : <span aria-hidden="true">⚠</span>}
          <span>
            {state.message}
            {state.detail.length > 0 ? (
              <ul style={{ margin: 'var(--s-2) 0 0', paddingLeft: '1.1rem' }}>
                {state.detail.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </span>
        </div>
      )}
    </form>
  );
}
