'use client';

import { useActionState } from 'react';

import { eraseOrganisationAction } from './data-actions';
import { EMPTY_ERASE } from './state';
import { confirmationPrompt } from '@/domain/privacy/erasure';

/**
 * Taking a copy, and deleting the lot.
 *
 * ## Why the two live together
 *
 * They are one decision made twice: somebody about to delete their account
 * should be offered the export in the same breath, because after the delete
 * there is nothing to export. Putting the download somewhere else would mean
 * the moment it matters most is the moment it is hardest to find.
 *
 * ## Why the delete is folded away and the export is not
 *
 * The export is safe and the delete is not. An irreversible control that sits
 * open on a page somebody visits to check their facts is a control that will
 * eventually be pressed by accident.
 */
export function DataRights({
  organisationName,
  willRemove,
}: {
  /** Null when onboarding has not given it one yet. */
  organisationName: string | null;
  /** Built on the server from real counts, so it names this account. */
  willRemove: string;
}) {
  const [state, erase, erasing] = useActionState(eraseOrganisationAction, EMPTY_ERASE);

  return (
    <section className="card" style={{ marginTop: 'var(--s-6)' }}>
      <h2 className="card-title">Your data</h2>
      <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
        Everything above is yours. <a href="/privacy">What we hold</a> lists it table by
        table, generated from the database itself.
      </p>

      <div className="row" style={{ marginTop: 'var(--s-4)' }}>
        <a className="btn btn-secondary" href="/api/account/export" download>
          Download everything we hold
        </a>
        <span className="hint">
          One JSON file, every row, with a legend so it reads without our schema.
        </span>
      </div>

      <details className="card paste danger" style={{ marginTop: 'var(--s-5)' }}>
        <summary className="paste-summary">
          Delete this organisation
          <span className="chev chev-toggle" />
        </summary>
        <div className="paste-body">
          <p className="card-sub">{willRemove}</p>
          <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
            There is no grace period and no recovery. If you want a copy, take the download
            above first — afterwards there is nothing left to hand back.
          </p>

          <form action={erase} style={{ marginTop: 'var(--s-4)' }}>
            <div className="field">
              <label className="label" htmlFor="erase-confirm">
                {confirmationPrompt(organisationName)}
              </label>
              <input
                aria-describedby={state.message === '' ? undefined : 'erase-problem'}
                aria-invalid={state.message !== ''}
                autoComplete="off"
                className="input"
                defaultValue={state.value}
                id="erase-confirm"
                name="confirm"
                type="text"
              />
            </div>

            {state.message === '' ? null : (
              <p
                className="notice notice-negative"
                id="erase-problem"
                role="alert"
                style={{ marginTop: 'var(--s-3)' }}
              >
                <span aria-hidden="true">✕</span>
                <span>{state.message}</span>
              </p>
            )}

            <button
              className="btn btn-secondary"
              disabled={erasing}
              style={{ marginTop: 'var(--s-4)' }}
              type="submit"
            >
              {erasing ? 'Deleting…' : 'Delete everything, permanently'}
            </button>
          </form>
        </div>
      </details>
    </section>
  );
}
