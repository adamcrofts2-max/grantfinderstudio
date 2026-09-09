'use client';

import { useActionState } from 'react';

import { adminSignInAction } from '../actions';
import { EMPTY_ADMIN_AUTH } from '../state';

export function AdminSignIn() {
  const [state, submit, pending] = useActionState(adminSignInAction, EMPTY_ADMIN_AUTH);

  return (
    <form action={submit} style={{ marginTop: 'var(--s-5)' }}>
      <div className="field">
        <label className="label" htmlFor="email">Email address</label>
        <input
          id="email"
          className="input"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={state.email}
          required
        />
      </div>

      <div className="field" style={{ marginTop: 'var(--s-4)' }}>
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password"
          className="input"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <button
        className="btn btn-primary"
        type="submit"
        disabled={pending}
        style={{ marginTop: 'var(--s-5)', width: '100%' }}
      >
        {pending ? 'Checking…' : 'Sign in'}
      </button>

      {state.ok ? null : (
        <p className="notice notice-caution" style={{ marginTop: 'var(--s-4)' }} role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{state.message}</span>
        </p>
      )}
    </form>
  );
}
