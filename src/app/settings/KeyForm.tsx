'use client';

import { useActionState } from 'react';
import { removeKeyAction, saveKeyAction, type ActionState } from './actions';
import type { CredentialStatus, ProviderId } from '@/secrets/store';

const EMPTY: ActionState = { provider: null, ok: false, message: '' };

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
  const [saveState, save, saving] = useActionState(saveKeyAction, EMPTY);
  const [removeState, remove, removing] = useActionState(removeKeyAction, EMPTY);

  const badge = statusBadge(status);
  const result =
    saveState.provider === provider.id
      ? saveState
      : removeState.provider === provider.id
        ? removeState
        : null;

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

      {status.masked === null ? null : (
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
            {status.masked}
          </code>
          {status.lastCheckedAt ? (
            <span className="hint">Last checked {status.lastCheckedAt.slice(0, 10)}</span>
          ) : null}
        </div>
      )}

      {status.masked !== null && status.lastCheckOk === false && status.lastCheckNote ? (
        <p className="notice notice-caution" style={{ marginTop: 'var(--s-3)' }}>
          <span aria-hidden="true">⚠</span>
          <span>{status.lastCheckNote}</span>
        </p>
      ) : null}

      <form action={save} style={{ marginTop: 'var(--s-4)' }}>
        <input type="hidden" name="provider" value={provider.id} />
        <div className="field">
          <label className="label" htmlFor={fieldId}>
            {status.masked === null ? 'Paste your key' : 'Replace with a new key'}
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
          {status.masked === null ? null : (
            <button className="btn btn-secondary" type="submit" formAction={remove} disabled={removing}>
              {removing ? 'Removing…' : 'Remove'}
            </button>
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
