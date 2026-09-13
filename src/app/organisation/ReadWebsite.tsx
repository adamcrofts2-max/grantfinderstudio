'use client';

import { useActionState } from 'react';

import { readWebsiteAction } from './website-actions';
import { EMPTY_READ_WEBSITE } from './state';

/**
 * "Read my website."
 *
 * Most CICs have already written who they are, who they serve and where — on
 * their own About page. Asking them to type it again into a form is work
 * nobody should repeat, and it is the slowest part of getting to the five
 * confirmed facts the Writer needs.
 *
 * The copy is careful about two things, because both are true and neither is
 * obvious: everything it finds is UNCONFIRMED and appears above for checking,
 * and we read one page rather than crawling a site.
 */
export function ReadWebsite({ open }: { open?: boolean }) {
  const [state, submit, reading] = useActionState(readWebsiteAction, EMPTY_READ_WEBSITE);

  return (
    <details className="card" id="read-website" open={open ?? false}>
      <summary className="paste-summary">
        <span>Read it from our website instead</span>
        <span className="chev chev-toggle" aria-hidden="true" />
      </summary>

      <div className="paste-body">
        <p className="card-sub">
          Give us the page that describes what you do — an “About us” page usually works better
          than a home page. We read that one page, not your whole site, and everything we find
          appears above as something for you to check. Nothing goes into an application until
          you have said it is right.
        </p>

        <form action={submit} style={{ marginTop: 'var(--s-4)' }}>
          <div className="field">
            <label className="label" htmlFor="website">Your website address</label>
            <input
              id="website"
              className="input"
              name="website"
              type="url"
              inputMode="url"
              placeholder="https://example.org/about-us"
              defaultValue={state.value}
              required
              aria-describedby="website-hint"
            />
            <p className="hint" id="website-hint">
              Must begin https:// . We will not send a username or password to a website, and we
              only read a public address.
            </p>
          </div>

          <button
            className="btn btn-primary"
            type="submit"
            disabled={reading}
            style={{ marginTop: 'var(--s-4)' }}
          >
            {reading ? 'Reading the page…' : 'Read this page'}
          </button>
        </form>

        <div aria-live="polite">
          {state.message === '' ? null : (
            <p
              className={state.ok ? 'notice notice-neutral' : 'notice notice-caution'}
              style={{ marginTop: 'var(--s-3)' }}
              role={state.ok ? undefined : 'alert'}
            >
              <span aria-hidden="true">{state.ok ? '✓' : '⚠'}</span>
              <span>
                {state.message}
                {state.url === null ? null : (
                  <>
                    {' '}
                    Read from{' '}
                    <a href={state.url} target="_blank" rel="noreferrer noopener">
                      {state.url}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                    .
                  </>
                )}
              </span>
            </p>
          )}

          {/* Told, not logged. A page trying to talk the extractor into
              something is a thing its owner should know about — and if it is
              their own site, somebody has put it there. */}
          {state.instructionLike.length === 0 ? null : (
            <div className="banner" style={{ marginTop: 'var(--s-3)' }} role="status">
              <span aria-hidden="true">⚠</span>
              <span>
                <strong>Something on that page was addressed to us rather than describing
                you.</strong>{' '}
                We ignored it, and none of it became a fact. Worth a look if you did not put it
                there:
                <ul style={{ margin: 'var(--s-2) 0 0', paddingLeft: '1.1rem' }}>
                  {state.instructionLike.slice(0, 3).map((line) => (
                    <li key={line}>“{line.slice(0, 200)}”</li>
                  ))}
                </ul>
              </span>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
