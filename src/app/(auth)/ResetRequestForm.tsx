'use client';

import { useActionState } from 'react';

import { requestResetAction } from './actions';
import { EMPTY_AUTH } from './state';

/**
 * Ask for a reset link.
 *
 * The form stays after a send, with the address still in it, so somebody
 * whose first email went to spam can ask again without retyping — the rate
 * limit, not the form, is what stops that turning into a flood.
 */
export function ResetRequestForm() {
  const [state, submit, pending] = useActionState(requestResetAction, EMPTY_AUTH);

  return (
    <form action={submit} className="stack" style={{ gap: 'var(--s-4)' }}>
      {state.message === '' ? null : state.ok ? (
        <p className="notice notice-neutral" role="status">
          <span>{state.message}</span>
        </p>
      ) : (
        <p className="notice notice-negative" role="alert">
          <span aria-hidden="true">✕</span>
          <span>{state.message}</span>
        </p>
      )}

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

      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? 'One moment…' : state.ok ? 'Send another link' : 'Send me a link'}
      </button>
    </form>
  );
}
