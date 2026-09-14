'use client';

import { useActionState } from 'react';

import { startCorpusAction, stepCorpusAction } from './corpus-actions';
import { EMPTY_CORPUS } from './corpus-state';
import type { CorpusProgress } from '@/db/corpus';

const count = (n: number): string => n.toLocaleString('en-GB');

/**
 * Assembling the grant record, and watching it arrive.
 *
 * This exists because 360Giving publish no search across all grants. Their API
 * answers for one named funder at a time, so the only way an applicant can
 * search grant TEXT is a copy held here — which is what 360Giving themselves
 * tell developers to do. The walk is thousands of funders long and cannot
 * happen in one request, so it is a sequence of steps.
 */
export function CorpusPanel({ progress }: { progress: CorpusProgress }) {
  const [startState, start, starting] = useActionState(startCorpusAction, EMPTY_CORPUS);
  const [stepState, step, stepping] = useActionState(stepCorpusAction, EMPTY_CORPUS);

  // Whichever spoke last. Two independent forms would otherwise both show a
  // stale line beside a fresh one.
  const latest = [startState, stepState].toSorted((a, b) => b.at - a.at)[0] ?? EMPTY_CORPUS;

  const running = progress.startedAt !== null && progress.finishedAt === null;
  const share =
    progress.fundersTotal === null || progress.fundersTotal <= 0
      ? null
      : Math.min(progress.fundersDone / progress.fundersTotal, 1);

  return (
    <section className="card" style={{ marginTop: 'var(--s-5)' }}>
      <h2 className="card-title">The grant record</h2>
      <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
        360Giving publish no search across all grants — their API answers for one named funder
        at a time, and their own advice to developers is to hold the data locally. So this walks
        their funder list and keeps each funder’s awarded grants here, which is what makes the
        applicant’s search instant. A funder whose grants state no licence is skipped, not
        stored.
      </p>

      <dl className="admin-notes" style={{ marginTop: 'var(--s-4)' }}>
        <div>
          <dt>Grants held</dt>
          <dd>{count(progress.awardsWritten)} written this run</dd>
        </div>
        <div>
          <dt>Funders read</dt>
          <dd>
            {count(progress.fundersDone)}
            {progress.fundersTotal === null ? '' : ` of ${count(progress.fundersTotal)}`}
            {share === null ? '' : ` — ${Math.round(share * 100)}%`}
          </dd>
        </div>
        <div>
          <dt>Skipped, no licence</dt>
          <dd>{count(progress.fundersUnlicensed)}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>
            {progress.startedAt === null
              ? 'never started'
              : progress.finishedAt !== null
                ? `finished ${progress.finishedAt.slice(0, 16).replace('T', ' ')}`
                : 'in progress'}
          </dd>
        </div>
      </dl>

      {progress.lastError === null ? null : (
        <p className="notice notice-caution" style={{ marginTop: 'var(--s-3)' }}>
          <span aria-hidden="true">⚠</span>
          <span>
            Last problem: {progress.lastError}. One publisher’s bad data does not stop the
            walk — the cursor moves past them.
          </span>
        </p>
      )}

      <div className="row-actions" style={{ marginTop: 'var(--s-4)' }}>
        <form action={start}>
          <button className="btn btn-secondary" type="submit" disabled={starting || stepping}>
            {starting ? 'Starting…' : running ? 'Start again from the top' : 'Start the walk'}
          </button>
        </form>
        <form action={step}>
          <button className="btn btn-primary" type="submit" disabled={starting || stepping}>
            {stepping ? 'Reading a few funders…' : 'Run one step now'}
          </button>
        </form>
      </div>

      <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
        A step reads a handful of funders, well inside 360Giving’s published rate limits. The
        scheduled job advances it on its own; the button is here so a failure can be seen at
        once rather than an hour later.
      </p>

      <div aria-live="polite">
        {latest.message === '' ? null : (
          <p
            className={latest.ok ? 'notice notice-neutral' : 'notice notice-caution'}
            style={{ marginTop: 'var(--s-3)' }}
            role={latest.ok ? undefined : 'alert'}
          >
            <span aria-hidden="true">{latest.ok ? '✓' : '⚠'}</span>
            <span>{latest.message}</span>
          </p>
        )}
      </div>
    </section>
  );
}
