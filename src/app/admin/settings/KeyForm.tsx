'use client';

import { useActionState } from 'react';
import { recheckKeyAction, removeKeyAction, saveKeyAction } from './actions';
import { EMPTY_ACTION } from './state';
import type { CredentialStatus, ProviderId } from '@/secrets/store';

export interface ProviderCopy {
  id: ProviderId;
  name: string;
  what: string;
  whereToGet: string;
  url: string;
  placeholder: string;
}

/** Connection state, worded so it is never ambiguous what the operator must do. */
function statusBadge(status: CredentialStatus) {
  if (status.masked === null) {
    return { className: 'badge badge-neutral', mark: '○', label: 'Not connected' };
  }
  if (status.lastCheckOk === true) {
    return { className: 'badge badge-positive', mark: '✓', label: 'Connected' };
  }
  return { className: 'badge badge-negative', mark: '✕', label: 'Not working' };
}

export function KeyForm({
  provider,
  status,
}: {
  provider: ProviderCopy;
  status: CredentialStatus;
}) {
  const [saveState, save, saving] = useActionState(saveKeyAction, EMPTY_ACTION);
  const [removeState, remove, removing] = useActionState(removeKeyAction, EMPTY_ACTION);
  const [recheckState, recheck, rechecking] = useActionState(recheckKeyAction, EMPTY_ACTION);

  /**
   * The latest outcome for this provider.
   *
   * By timestamp, not by the order they are written: save, remove and
   * re-check can each hold a result for the same provider, so a failed save
   * would otherwise keep captioning a key that a later re-check has just
   * proved fine.
   */
  const result =
    [saveState, removeState, recheckState]
      .filter((state) => state.provider === provider.id)
      .toSorted((a, b) => b.at - a.at)[0] ?? null;

  // Prefer the state the action just returned, so a save cannot leave the
  // badge saying "Not connected" beside a message saying "Connected".
  const current = result?.status ?? status;
  const badge = statusBadge(current);

  const fieldId = `key-${provider.id}`;
  const messageId = `msg-${provider.id}`;
  const showError = result !== null && !result.ok;

  return (
    <section className="card">
      <div className="row-between">
        <div>
          <h2 className="card-title">{provider.name}</h2>
          <p className="card-sub">{provider.what}</p>
        </div>
        <span className={badge.className}>
          <span aria-hidden="true">{badge.mark}</span>
          {badge.label}
        </span>
      </div>

      {current.masked === null ? null : (
        <div className="row" style={{ marginTop: 'var(--s-4)', gap: 'var(--s-2)' }}>
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--t-sm)',
              background: 'var(--surface-sunken)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-sm)',
              padding: '0.2rem 0.5rem',
            }}
          >
            {current.masked}
          </code>
          {current.lastCheckedAt ? (
            <span className="hint">Last checked {current.lastCheckedAt.slice(0, 10)}</span>
          ) : null}
        </div>
      )}

      {current.masked !== null && current.lastCheckOk === false && current.lastCheckNote ? (
        <p className="notice notice-caution" style={{ marginTop: 'var(--s-3)' }}>
          <span aria-hidden="true">⚠</span>
          <span>{current.lastCheckNote}</span>
        </p>
      ) : null}

      <form action={save} style={{ marginTop: 'var(--s-4)' }}>
        <input type="hidden" name="provider" value={provider.id} />
        <div className="field">
          <label className="label" htmlFor={fieldId}>
            {current.masked === null ? 'Paste your key' : 'Replace with a new key'}
          </label>
          <input
            id={fieldId}
            name="key"
            type="password"
            className="input input-mono"
            placeholder={provider.placeholder}
            autoComplete="off"
            spellCheck={false}
            required
            aria-invalid={showError}
            aria-describedby={`${messageId} hint-${provider.id}`}
          />
          <p className="hint" id={`hint-${provider.id}`}>
            {provider.whereToGet}{' '}
            <a href={provider.url} target="_blank" rel="noreferrer noopener">
              Get a key<span className="sr-only"> for {provider.name} (opens in a new tab)</span>
            </a>
          </p>
        </div>

        <div className="row" style={{ marginTop: 'var(--s-4)' }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Checking…' : 'Save and test'}
          </button>
          {current.masked === null ? null : (
            <>
              {/* formNoValidate, because the key field above is `required` and
                  this button is not asking for one. Without it the browser
                  blocks the submission with no request, no error and no log —
                  the same silent failure the ingest dry-run button had. */}
              <button
                className="btn btn-secondary"
                type="submit"
                formAction={recheck}
                formNoValidate
                disabled={rechecking}
              >
                {rechecking ? 'Testing…' : 'Test the stored key again'}
              </button>
              <button className="btn btn-secondary" type="submit" formAction={remove} formNoValidate disabled={removing}>
                {removing ? 'Removing…' : 'Remove'}
              </button>
            </>
          )}
        </div>
      </form>

      {/* Assertive so the outcome of a save is announced, not just shown. */}
      <div id={messageId} role="status" aria-live="polite">
        {result && result.message ? (
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
