'use client';

import { useActionState } from 'react';

import { saveManualProfileAction } from './actions';
import { EMPTY_MANUAL, JURISDICTION_CHOICES, LEGAL_FORM_CHOICES } from './state';

/**
 * Enter the organisation's details by hand.
 *
 * The route that always works. Companies House lookup needs a key, an outbound
 * connection and a company on the register; without a fallback, a fresh
 * deployment can dead-end on its very first screen.
 *
 * What is typed here is recorded as self-declared and shown as such. Legal
 * form is the criterion most funders decide on, so a value the applicant
 * asserted must never be presentable as one verified against the register.
 */
export function ManualProfile() {
  const [state, save, saving] = useActionState(saveManualProfileAction, EMPTY_MANUAL);
  const error = (field: string): string | undefined => state.errors[field];

  return (
    <details className="card">
      <summary className="paste-summary">
        <span>Enter your details yourself</span>
        <span className="chev" aria-hidden="true">Open</span>
      </summary>

      <form className="paste-body" action={save}>
        <p className="card-sub">
          Use this if your organisation is not on Companies House, or if lookup is unavailable.
          We record it as your own declaration rather than as verified.
        </p>

        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <label className="label" htmlFor="legalName">Registered name</label>
          <input
            id="legalName"
            className="input"
            name="legalName"
            required
            aria-invalid={error('legalName') !== undefined}
            aria-describedby={error('legalName') ? 'legalName-error' : undefined}
          />
          {error('legalName') ? (
            <p className="hint" id="legalName-error" style={{ color: 'var(--negative)' }}>
              {error('legalName')}
            </p>
          ) : null}
        </div>

        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <label className="label" htmlFor="legalForm">Legal form</label>
          <select id="legalForm" className="input" name="legalForm" required defaultValue="">
            <option value="" disabled>Choose one</option>
            {LEGAL_FORM_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>{choice.label}</option>
            ))}
          </select>
          <p className="hint">
            If you are a CIC, which kind matters: some funders accept only bodies limited by
            guarantee. It is on your certificate of incorporation.
          </p>
          {error('legalForm') ? (
            <p className="hint" style={{ color: 'var(--negative)' }}>{error('legalForm')}</p>
          ) : null}
        </div>

        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <label className="label" htmlFor="jurisdiction">Where you are based</label>
          <select id="jurisdiction" className="input" name="jurisdiction" required defaultValue="">
            <option value="" disabled>Choose one</option>
            {JURISDICTION_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>{choice.label}</option>
            ))}
          </select>
          {error('jurisdiction') ? (
            <p className="hint" style={{ color: 'var(--negative)' }}>{error('jurisdiction')}</p>
          ) : null}
        </div>

        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <label className="label" htmlFor="region">
            County or area you work in <span className="hint">(optional)</span>
          </label>
          <input id="region" className="input" name="region" placeholder="Somerset" />
          <p className="hint">Many funders restrict by area, so this decides real eligibility.</p>
        </div>

        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <label className="label" htmlFor="companyNumber">
            Company number <span className="hint">(optional)</span>
          </label>
          <input id="companyNumber" className="input input-mono" name="companyNumber" placeholder="12345678" />
          {error('companyNumber') ? (
            <p className="hint" style={{ color: 'var(--negative)' }}>{error('companyNumber')}</p>
          ) : null}
        </div>

        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <label className="label" htmlFor="incorporationDate">
            Date you were set up <span className="hint">(optional)</span>
          </label>
          <input id="incorporationDate" className="input" type="date" name="incorporationDate" />
          <p className="hint">Some funders require you to have existed for a minimum time.</p>
          {error('incorporationDate') ? (
            <p className="hint" style={{ color: 'var(--negative)' }}>{error('incorporationDate')}</p>
          ) : null}
        </div>

        <button className="btn btn-primary" type="submit" disabled={saving} style={{ marginTop: 'var(--s-5)' }}>
          {saving ? 'Saving…' : 'Save these details'}
        </button>

        {state.message !== '' ? (
          <p
            className={`notice ${state.saved ? 'notice-neutral' : 'notice-caution'}`}
            style={{ marginTop: 'var(--s-4)' }}
            role={state.saved ? 'status' : 'alert'}
          >
            {state.saved ? null : <span aria-hidden="true">⚠</span>}
            <span>
              {state.message}
              {state.saved ? <> <a href="/">See your opportunities</a>.</> : null}
            </span>
          </p>
        ) : null}
      </form>
    </details>
  );
}
