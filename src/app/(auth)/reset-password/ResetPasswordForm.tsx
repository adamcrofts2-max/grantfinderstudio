'use client';

import { useActionState, useEffect, useState } from 'react';

import { tokenFromFragment } from '@/domain/auth/reset';

import { resetPasswordAction } from '../actions';
import { EMPTY_AUTH } from '../state';

/**
 * Choose a new password.
 *
 * The token arrives in the fragment, which the server never sees — so it is
 * read here, held in the form, and wiped from the address bar at once. Left
 * there it would sit in the browser's history, and be on screen for anybody
 * sharing it or looking over a shoulder.
 */
export function ResetPasswordForm() {
  const [state, submit, pending] = useActionState(resetPasswordAction, EMPTY_AUTH);
  // `undefined` until the fragment has been read: on the server, and for the
  // first client render, there is no way to know yet.
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const found = tokenFromFragment(window.location.hash);
    setToken(found);
    if (window.location.hash !== '') {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  if (token === undefined) {
    return <p className="hint">Reading your link…</p>;
  }

  if (token === null) {
    return (
      <p className="notice notice-caution" role="alert">
        <span aria-hidden="true">⚠</span>
        <span>
          This link is not complete. Open it from the email again — some email programs split
          a long link in two — or <a href="/forgot-password">ask for a new one</a>.
        </span>
      </p>
    );
  }

  return (
    <form action={submit} className="stack" style={{ gap: 'var(--s-4)' }}>
      {state.message === '' ? null : (
        <p className="notice notice-negative" role="alert">
          <span aria-hidden="true">✕</span>
          <span>
            {state.message}
            {state.problems.length === 0 ? (
              <>
                {' '}
                <a href="/forgot-password">Ask for a new link</a>.
              </>
            ) : null}
          </span>
        </p>
      )}

      {state.problems.length === 0 ? null : (
        <ul className="list" role="alert">
          {state.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <input type="hidden" name="token" value={token} />

      <div className="field">
        <label className="label" htmlFor="password">New password</label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
        />
        <span className="hint">
          At least 10 characters. A few unrelated words beat a short one with a symbol in it.
        </span>
      </div>

      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? 'One moment…' : 'Save the new password'}
      </button>
    </form>
  );
}
