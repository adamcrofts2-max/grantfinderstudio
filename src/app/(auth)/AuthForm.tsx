'use client';

import { useActionState } from 'react';

import { EMPTY_AUTH, type AuthState } from './state';

export function AuthForm({
  action,
  mode,
}: {
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  mode: 'sign-in' | 'sign-up';
}) {
  const [state, submit, pending] = useActionState(action, EMPTY_AUTH);
  const signingUp = mode === 'sign-up';

  return (
    <form action={submit} className="stack" style={{ gap: 'var(--s-4)' }}>
      {state.message === '' ? null : (
        <p className="notice notice-negative" role="alert">
          <span aria-hidden="true">✕</span>
          <span>{state.message}</span>
        </p>
      )}

      {state.problems.length === 0 ? null : (
        <ul className="list" role="alert">
          {state.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {signingUp ? (
        <div className="field">
          <label className="label" htmlFor="name">Your name</label>
          <input className="input" id="name" name="name" autoComplete="name" />
          <span className="hint">Optional. It appears on things you write.</span>
        </div>
      ) : null}

      <div className="field">
        <label className="label" htmlFor="email">Email address</label>
        <input
          className="input"
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          defaultValue={state.email}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="password">Password</label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          required
          // Tells a password manager to offer a generated one on sign-up and
          // the saved one on sign-in. Getting this wrong is why people end up
          // typing passwords by hand.
          autoComplete={signingUp ? 'new-password' : 'current-password'}
        />
        {signingUp ? (
          <span className="hint">
            At least 10 characters. A few unrelated words beat a short one with
            a symbol in it — length is what makes a password hard to guess.
          </span>
        ) : null}
      </div>

      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? 'One moment…' : signingUp ? 'Create the account' : 'Sign in'}
      </button>
    </form>
  );
}
