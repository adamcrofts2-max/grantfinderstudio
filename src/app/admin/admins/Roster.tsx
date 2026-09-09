'use client';

import { useActionState } from 'react';

import { ADMIN_CONSTANTS } from '@/domain/auth/admin';

import {
  addAdminAction,
  changeAdminPasswordAction,
  restoreAdminAction,
  standDownAdminAction,
} from './actions';
import { EMPTY_ROSTER, type RosterState } from './state';

export interface AdminRowView {
  id: string;
  email: string;
  createdAt: string;
  lastSignedInAt: string | null;
  disabled: boolean;
  isYou: boolean;
}

function Outcome({ state }: { state: RosterState }) {
  if (state.message === '' && state.problems.length === 0) return null;
  return (
    <div
      className={state.ok ? 'notice notice-neutral' : 'notice notice-caution'}
      style={{ marginTop: 'var(--s-3)' }}
      role={state.ok ? undefined : 'alert'}
    >
      <span aria-hidden="true">{state.ok ? '✓' : '⚠'}</span>
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
  );
}

/**
 * The roster.
 *
 * Stand-down and restore are separate actions rather than one toggle: the two
 * are not symmetrical — one ends somebody's access immediately and the other
 * hands it back — and a control whose meaning depends on the row's current
 * state is the kind that gets clicked by mistake.
 */
export function Roster({ admins }: { admins: AdminRowView[] }) {
  const [addState, add, adding] = useActionState(addAdminAction, EMPTY_ROSTER);
  const [downState, standDown, standingDown] = useActionState(standDownAdminAction, EMPTY_ROSTER);
  const [backState, restore, restoring] = useActionState(restoreAdminAction, EMPTY_ROSTER);
  const [passwordState, changePassword, changing] = useActionState(
    changeAdminPasswordAction,
    EMPTY_ROSTER,
  );

  /**
   * The latest outcome for one row.
   *
   * Both stand-down and restore can hold a result for the same admin, so this
   * compares their timestamps rather than checking one first: the alternative
   * is a restored admin still captioned "stood down".
   */
  const rowState = (id: string): RosterState | null => {
    const candidates = [downState, backState].filter((s) => s.adminId === id);
    return candidates.toSorted((a, b) => b.at - a.at)[0] ?? null;
  };

  return (
    <>
      <section className="card">
        <h2 className="card-title">Admins — {admins.length}</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          Everybody who can open this console. Standing somebody down takes effect at once —
          the sessions they hold are deleted rather than left to expire.
        </p>

        <ul className="admin-list" style={{ marginTop: 'var(--s-4)' }}>
          {admins.map((admin) => {
            const outcome = rowState(admin.id);
            return (
              <li className="admin-list-item" key={admin.id}>
                <div style={{ minWidth: 0 }}>
                  <p className="admin-list-title">
                    {admin.email}
                    {admin.isYou ? <span className="hint"> · you</span> : null}
                  </p>
                  <p className="hint">
                    {admin.disabled ? 'Stood down' : 'Can sign in'} · added {admin.createdAt} ·{' '}
                    {admin.lastSignedInAt === null
                      ? 'never signed in'
                      : `last signed in ${admin.lastSignedInAt}`}
                  </p>
                  {outcome === null ? null : <Outcome state={outcome} />}
                </div>

                {admin.disabled ? (
                  <form action={restore}>
                    <input type="hidden" name="adminId" value={admin.id} />
                    <button className="btn btn-secondary btn-small" type="submit" disabled={restoring}>
                      {restoring ? 'Working…' : 'Bring back'}
                    </button>
                  </form>
                ) : admin.isYou ? (
                  <span className="hint">Only another admin can stand you down</span>
                ) : (
                  <form action={standDown}>
                    <input type="hidden" name="adminId" value={admin.id} />
                    <button className="btn btn-secondary btn-small" type="submit" disabled={standingDown}>
                      {standingDown ? 'Working…' : 'Stand down'}
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card" style={{ marginTop: 'var(--s-5)' }}>
        <h2 className="card-title">Add an admin</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          You set their first password and hand it over yourself. There is no invitation email,
          because an emailed console password is a console password sitting in an inbox.
        </p>

        <form action={add} style={{ marginTop: 'var(--s-4)' }}>
          <div className="field">
            <label className="label" htmlFor="new-admin-email">Their email address</label>
            <input
              id="new-admin-email"
              className="input"
              name="email"
              type="email"
              autoComplete="off"
              defaultValue={addState.email}
              required
            />
          </div>

          <div className="field" style={{ marginTop: 'var(--s-4)' }}>
            <label className="label" htmlFor="new-admin-password">A password for them</label>
            <input
              id="new-admin-password"
              className="input"
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
            <p className="hint">
              At least {ADMIN_CONSTANTS.minPasswordLength} characters. They can change it here
              once they are in.
            </p>
          </div>

          <button
            className="btn btn-primary"
            type="submit"
            disabled={adding}
            style={{ marginTop: 'var(--s-5)' }}
          >
            {adding ? 'Adding…' : 'Add this admin'}
          </button>
        </form>
        <Outcome state={addState} />
      </section>

      <section className="card" style={{ marginTop: 'var(--s-5)' }}>
        <h2 className="card-title">Change your password</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          Everywhere else you are signed in to the console is signed out when you do. This
          browser stays.
        </p>

        <form action={changePassword} style={{ marginTop: 'var(--s-4)' }}>
          <div className="field">
            <label className="label" htmlFor="current-password">Your current password</label>
            <input
              id="current-password"
              className="input"
              name="current"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          <div className="field" style={{ marginTop: 'var(--s-4)' }}>
            <label className="label" htmlFor="next-password">A new one</label>
            <input
              id="next-password"
              className="input"
              name="next"
              type="password"
              autoComplete="new-password"
              required
            />
          </div>

          <button
            className="btn btn-primary"
            type="submit"
            disabled={changing}
            style={{ marginTop: 'var(--s-5)' }}
          >
            {changing ? 'Changing…' : 'Change it'}
          </button>
        </form>
        <Outcome state={passwordState} />
      </section>
    </>
  );
}
