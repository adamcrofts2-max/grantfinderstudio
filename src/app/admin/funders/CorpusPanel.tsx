'use client';

import { useActionState } from 'react';

import { startCorpusAction, stepCorpusAction } from './corpus-actions';
import { EMPTY_CORPUS } from './corpus-state';
import type { CorpusProgress, CorpusStanding } from '@/db/corpus';
import { RECENT_WINDOW_LABEL } from '@/domain/grants/recency';

const count = (n: number): string => n.toLocaleString('en-GB');

/**
 * Watching the grant record arrive.
 *
 * Visibility, not a control. The record fills itself — a visit to the grant
 * search starts it and advances it, and a scheduled job backs that up — so
 * there is nothing here that has to be pressed for the product to work. This
 * panel exists so somebody can SEE how far it has got, how many funders were
 * skipped for stating no licence, and what last went wrong.
 *
 * The two buttons are for a bad day: one runs a step immediately rather than
 * waiting for the next visitor or the next scheduled run, and one restarts the
 * walk from the top when the data needs re-reading. Neither is part of the
 * normal path.
 */
export function CorpusPanel({
  progress,
  standing,
  lastProgress,
  stalledAfterHours,
}: {
  progress: CorpusProgress;
  /** Decided by the page, off one clock reading. */
  standing: CorpusStanding;
  /** "3 days ago", phrased by the page. Null when nothing has progressed. */
  lastProgress: string | null;
  stalledAfterHours: number;
}) {
  const [startState, start, starting] = useActionState(startCorpusAction, EMPTY_CORPUS);
  const [stepState, step, stepping] = useActionState(stepCorpusAction, EMPTY_CORPUS);

  // Whichever spoke last. Two independent forms would otherwise both show a
  // stale line beside a fresh one.
  const latest = [startState, stepState].toSorted((a, b) => b.at - a.at)[0] ?? EMPTY_CORPUS;

  const share =
    progress.fundersTotal === null || progress.fundersTotal <= 0
      ? null
      : Math.min(progress.fundersDone / progress.fundersTotal, 1);

  return (
    <section className="card" style={{ marginTop: 'var(--s-5)' }}>
      <h2 className="card-title">The grant record</h2>
      <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
        360Giving publish no search across all grants — their API answers for one named funder
        at a time, and their own advice to developers is to hold the data locally. So we walk
        their funder list and keep each funder’s awarded grants here, which is what makes the
        applicant’s search instant. A funder whose grants state no licence is skipped, not
        stored.
      </p>
      <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
        <strong>We keep {RECENT_WINDOW_LABEL}.</strong> All of it would be around 420 MB,
        which is more than a free database tier holds; three years is about a quarter of the
        rows and still leaves almost every active funder with enough grants to characterise.
        Their API has no date filter, so the older grants are still fetched and read — they
        are just not kept, and the count below says how many.
      </p>
      <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
        <strong>This runs itself.</strong> Somebody opening the grant search starts it and
        advances it, and a scheduled job carries on when nobody is about. Nothing below needs
        pressing for the product to work.
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
            {/* "Read" counted a funder the walk merely reached. Saying so
                keeps 100% from reading as "we have all of it". */}
            {progress.fundersFailed === 0
              ? ''
              : `, ${count(progress.fundersFailed)} of which failed`}
          </dd>
        </div>
        <div>
          <dt>Skipped, no licence</dt>
          <dd>{count(progress.fundersUnlicensed)}</dd>
        </div>
        <div>
          {/* Never silent again. A funder whose record we KNOW is incomplete
              makes every figure drawn from it — the median, the quartiles,
              the range — wrong.

              TWO CAUSES, one counter. Our page cap stops some publishers;
              others stop themselves, a page part way through failing. Both
              leave a partial record, which is what this number is about, and
              the second kind is also counted under "could not be read"
              because an operator re-fetching that list should find them. So
              the copy names both rather than leaving one funder looking like
              two. */}
          <dt>Records cut short</dt>
          <dd>
            {count(progress.fundersTruncated)}
            {progress.fundersTruncated === 0
              ? ''
              : ' — more grants than we fetch per funder, or a page of theirs that failed'}
          </dd>
        </div>
        <div>
          {/* The last uncounted way for the corpus to be short. A failure
              wrote one error string that the next step cleared, so three
              publishers could vanish behind "42 of 42 — 100%". */}
          <dt>Could not be read</dt>
          <dd>
            {count(progress.fundersFailed)}
            {progress.failedOrgIds.length === 0
              ? ''
              : ` — most recently ${progress.failedOrgIds.slice(0, 3).join(', ')}`}
            {/* Some of these have part of their record, some none: a
                publisher who failed on page one gave us nothing, one who
                failed on page seven gave us six pages. The last problem
                below says which, and says what was kept. */}
            {progress.fundersTruncated === 0 || progress.fundersFailed === 0
              ? ''
              : '. Some of them gave us part of their record — see below'}
          </dd>
        </div>
        <div>
          {/* The window is a deliberate cut, so it is measured like one. The
              page cap taught this: a corpus quietly missing part of itself is
              a corpus whose medians nobody can check. */}
          <dt>Older than {RECENT_WINDOW_LABEL}</dt>
          <dd>
            {count(progress.awardsDiscarded)}
            {progress.awardsDiscarded === 0 ? '' : ' fetched, read, not kept'}
          </dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>
            {/* Four states, not two. "In progress" was shown for anything
                started and unfinished, so a walk that could never finish
                reported itself as working indefinitely — here and, worse, on
                the applicant's search screen. */}
            {standing === 'never_started'
              ? 'never started'
              : standing === 'complete'
                ? `finished ${(progress.finishedAt ?? '').slice(0, 16).replace('T', ' ')}`
                : standing === 'stalled'
                  ? 'STALLED — not moving'
                  : 'filling'}
          </dd>
        </div>
      </dl>

      {/* THE ONE THING ON THIS PANEL THAT IS A JOB.
          Everything else here is visibility — the record fills itself. A
          stalled record does not, and it is the state an operator has to
          decide about: the API unreachable, a step dying before it reads a
          publisher, or a scheduler that has stopped firing. Named, dated, and
          next to the button that tries again. */}
      {standing !== 'stalled' ? null : (
        <p className="notice notice-negative" style={{ marginTop: 'var(--s-3)' }}>
          <span aria-hidden="true">✕</span>
          <span>
            <strong>
              {lastProgress === null
                ? 'The walk has not progressed at all since it started.'
                : `The walk last progressed ${lastProgress}.`}
            </strong>{' '}
            Anything over {stalledAfterHours} hours counts as stalled — a daily scheduled
            step and any page visit both advance it, so this means neither is getting
            through. Read the last problem below, then try a step by hand: it runs here and
            reports what happened, rather than failing silently on somebody else's clock.
            {progress.fundersTotal === null
              ? ' The funder list itself was never read, which points at the API or the base URL rather than at one publisher.'
              : ` ${count(progress.fundersDone)} of ${count(progress.fundersTotal)} funders were read before it stopped.`}
          </span>
        </p>
      )}

      {progress.lastError === null ? null : (
        <p className="notice notice-caution" style={{ marginTop: 'var(--s-3)' }}>
          <span aria-hidden="true">⚠</span>
          <span>
            {/* The stored message usually ends in a full stop of its own, and
                adding a second one produced "Nothing has been written.." on
                the one screen an operator reads when something is wrong. */}
            Last problem: {progress.lastError.replace(/\.\s*$/u, '')}. One publisher’s bad
            data does not stop the walk — the cursor moves past them.
          </span>
        </p>
      )}

      <div className="row-actions" style={{ marginTop: 'var(--s-4)' }}>
        <form action={start}>
          <button className="btn btn-secondary" type="submit" disabled={starting || stepping}>
            {starting ? 'Starting…' : 'Start again from the top'}
          </button>
        </form>
        <form action={step}>
          <button className="btn btn-primary" type="submit" disabled={starting || stepping}>
            {stepping ? 'Reading a few funders…' : 'Run one step now'}
          </button>
        </form>
      </div>

      <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
        A step reads as many funders as it has time for, well inside 360Giving’s published rate
        limits, and at most one step runs at a time however many people ask for one. “Start
        again from the top” re-reads every funder and deletes nothing as it goes, so the search
        keeps working throughout.
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
