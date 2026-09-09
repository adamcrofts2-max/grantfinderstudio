'use client';

import { useActionState } from 'react';

import { adminClaimAction } from '../actions';
import { EMPTY_ADMIN_AUTH } from '../state';
import { ADMIN_CONSTANTS } from '@/domain/auth/admin';

/**
 * The one-time claim.
 *
 * Shown only while no admin exists. It asks for the secret held in the hosting
 * environment as well as an address and a password, because without it this
 * form would be a race between whoever runs the service and whoever finds the
 * deployment first.
 */
export function AdminClaim() {
  const [state, submit, pending] = useActionState(adminClaimAction, EMPTY_ADMIN_AUTH);

  return (
    <>
      <p className="page-sub">
        No admin exists on this deployment yet. Claim it now — once you do, this form is gone
        for good and there is no other way to create an admin.
      </p>

      <form action={submit} style={{ marginTop: 'var(--s-5)' }}>
        <div className="field">
          <label className="label" htmlFor="email">Your email address</label>
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
          <label className="label" htmlFor="secret">Claim secret</label>
          <input
            id="secret"
            className="input input-mono"
            name="secret"
            type="password"
            autoComplete="off"
            required
          />
          <p className="hint">
            The value of <code>ADMIN_CLAIM_SECRET</code> in the hosting environment. Nobody
            without it can claim this console.
          </p>
        </div>

        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <label className="label" htmlFor="password">A password for the console</label>
          <input
            id="password"
            className="input"
            name="password"
            type="password"
            autoComplete="new-password"
            required
          />
          <p className="hint">
            At least {ADMIN_CONSTANTS.minPasswordLength} characters — longer than a customer’s,
            because this one account can see how the whole service is running. Sessions here
            last {ADMIN_CONSTANTS.sessionHours} hours rather than a month.
          </p>
        </div>

        <button
          className="btn btn-primary"
          type="submit"
          disabled={pending}
          style={{ marginTop: 'var(--s-5)', width: '100%' }}
        >
          {pending ? 'Creating…' : 'Claim the console'}
        </button>

        {state.ok ? null : (
          <div className="notice notice-caution" style={{ marginTop: 'var(--s-4)' }} role="alert">
            <span aria-hidden="true">⚠</span>
            <span>
              {state.message}
              {state.problems.length > 0 ? (
                <ul style={{ margin: 'var(--s-2) 0 0', paddingLeft: '1.1rem' }}>
                  {state.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              ) : null}
            </span>
          </div>
        )}
      </form>
    </>
  );
}
