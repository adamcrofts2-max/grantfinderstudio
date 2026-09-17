'use client';

import { useActionState } from 'react';

import { reviewApplicationAction } from './actions';
import { EMPTY_REVIEW, findingLabel, SEVERITY_LABEL } from './state';
import type { StoredReview } from '@/db/reviews';

/**
 * Review the whole application before it goes in.
 *
 * Deliberately framed as a first pass, not a verdict. It is the free step
 * before a person reads it: the machine takes the structural faults so that
 * whoever reads it next — a trustee, a colleague, later a paid bid writer —
 * spends their time on judgement instead of on things arithmetic can catch.
 *
 * ## Why a stored review is shown, and shown with a date on it
 *
 * Each review costs a model call, and one used to live in `useActionState`
 * and be gone the moment somebody navigated away. So the last one is loaded
 * and is this panel's resting state.
 *
 * But a finding QUOTES the words it is about — that is what makes it
 * checkable — and an answer rewritten afterwards leaves the quote describing
 * text that no longer exists. `answersEdited` is how many answers have been
 * saved since, and when any have, the panel says so instead of presenting a
 * stale reading as current. That is the difference between keeping work and
 * pretending it is still true.
 */
/**
 * THE CLOCK IS READ ON THE SERVER, NOT HERE.
 *
 * "3 minutes ago" was computed in this component from `Date.now()`, and this
 * component is `'use client'` — which in Next means it is rendered on the
 * server for the initial HTML and then hydrated in the browser. Those are two
 * different clock readings, so a load that straddled a minute tick put "3
 * minutes ago" in the HTML and "4 minutes ago" on hydration: a text mismatch,
 * React error #418, and the whole tree thrown away and re-rendered. It fired
 * only when the boundary happened to fall inside the load, which is why it
 * never showed up in a test and did show up as an occasional console error.
 *
 * `storedWhen` is the phrase, computed once by the page that loaded the
 * review. A review just run in this session needs no clock at all: it is
 * "just now" by definition.
 */
export function ReviewPanel({
  applicationId,
  readinessPercent,
  stored,
  storedWhen,
  answersEdited,
}: {
  applicationId: string;
  readinessPercent: number;
  stored: StoredReview | null;
  /** How long ago the stored review was read, phrased by the server. */
  storedWhen: string | null;
  answersEdited: number;
}) {
  const [state, review, reviewing] = useActionState(reviewApplicationAction, EMPTY_REVIEW);

  // A review just run is current by definition. Otherwise fall back to the
  // last stored one, which is where the date and the staleness notice apply.
  const fresh = state.ok === true;
  const shown = fresh
    ? {
        mode: state.mode,
        message: state.message,
        findings: state.findings,
        mostImportant: state.mostImportant,
        strengths: state.strengths,
        injected: state.injected,
        discarded: state.discarded,
        // Null, like the `createdAt` this replaced: a review just run needs no
        // date line, no staleness notice and no gap above the headline,
        // because nothing has moved under it yet.
        when: null as string | null,
        readinessThen: null as number | null,
      }
    : stored === null
      ? null
      : {
          mode: stored.mode,
          message: stored.summary ?? `${stored.findings.length} things to look at.`,
          findings: stored.findings,
          mostImportant: stored.mostImportant,
          strengths: stored.strengths,
          injected: stored.injected,
          discarded: 0,
          when: storedWhen,
          readinessThen: stored.readinessPercent,
        };

  return (
    <section className="card">
      <h2 className="card-title">Read it back before you send it</h2>
      <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
        A first pass over the whole application: answers that miss the question, two that cannot
        both be true, claims nobody could check. It will not rewrite anything — that stays yours.
      </p>

      <div className="row" style={{ marginTop: 'var(--s-4)' }}>
        <form action={review}>
          <input type="hidden" name="applicationId" value={applicationId} />
          <input type="hidden" name="mode" value="standard" />
          <input type="hidden" name="readinessPercent" value={readinessPercent} />
          <button className="btn btn-primary" type="submit" disabled={reviewing}>
            {reviewing
              ? 'Reading it…'
              : stored === null
                ? 'Review the application'
                : 'Review it again'}
          </button>
        </form>
        <form action={review}>
          <input type="hidden" name="applicationId" value={applicationId} />
          <input type="hidden" name="mode" value="red_team" />
          <input type="hidden" name="readinessPercent" value={readinessPercent} />
          <button className="btn btn-secondary" type="submit" disabled={reviewing}>
            Read it like an assessor looking for a reason to say no
          </button>
        </form>
      </div>

      {state.ok === false ? (
        <p className="notice notice-caution" style={{ marginTop: 'var(--s-4)' }} role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{state.message}</span>
        </p>
      ) : null}

      {shown === null ? null : (
        <div style={{ marginTop: 'var(--s-5)' }}>
          {shown.when === null ? null : (
            <p className="hint">
              Read {shown.when}
              {shown.readinessThen === null || shown.readinessThen === readinessPercent
                ? ''
                : `, when this was ${shown.readinessThen}% complete rather than ${readinessPercent}%`}
              .
            </p>
          )}

          {/* A finding quotes the words it is about. Rewrite the answer and
              the quote describes text that is no longer there, so a stored
              review has to say what has moved under it. */}
          {shown.when !== null && answersEdited > 0 ? (
            <p className="notice notice-caution" style={{ marginTop: 'var(--s-3)' }}>
              <span aria-hidden="true">⚠</span>
              <span>
                {answersEdited} answer{answersEdited === 1 ? ' has' : 's have'} changed since
                this reading. Each finding quotes the words it is about, so any quoting an
                answer you have rewritten may no longer apply. Read it again when you are done.
              </span>
            </p>
          ) : null}

          <p
            className="headline"
            style={{ fontWeight: 600, marginTop: shown.when === null ? 0 : 'var(--s-3)' }}
          >
            {shown.mode === 'red_team' ? 'Read sceptically. ' : ''}
            {shown.message}
          </p>

          {shown.injected.length > 0 ? (
            <p className="notice notice-caution" style={{ marginTop: 'var(--s-3)' }}>
              <span aria-hidden="true">⚠</span>
              <span>
                {shown.injected.length} passage
                {shown.injected.length === 1 ? '' : 's'} in this application tried to instruct the
                reviewer. That was ignored, but it is worth knowing it is in there.
              </span>
            </p>
          ) : null}

          {shown.mostImportant === null ? null : (
            <p className="notice notice-neutral" style={{ marginTop: 'var(--s-3)' }}>
              <span>
                <strong>If you only change one thing: </strong>
                {shown.mostImportant}
              </span>
            </p>
          )}

          {shown.findings.map((finding, index) => {
            const badge = SEVERITY_LABEL[finding.severity];
            return (
              <section
                className="card"
                key={`${finding.kind}-${index}`}
                style={{ marginTop: 'var(--s-3)' }}
              >
                <div className="row-between">
                  <p className="eyebrow">
                    {findingLabel(finding.kind)}
                    {finding.questionNumber === null
                      ? ' · whole application'
                      : ` · question ${finding.questionNumber}`}
                  </p>
                  <span className={badge.className}>
                    <span aria-hidden="true">{badge.mark}</span>
                    {badge.label}
                  </span>
                </div>

                {finding.quote === null ? null : (
                  <blockquote className="quote" style={{ marginTop: 'var(--s-2)' }}>
                    <q>{finding.quote}</q>
                  </blockquote>
                )}

                <p className="headline" style={{ marginTop: 'var(--s-3)', fontWeight: 500 }}>
                  {finding.problem}
                </p>
                <p className="criteria-why" style={{ marginTop: 'var(--s-2)' }}>
                  <strong>Try: </strong>
                  {finding.suggestion}
                </p>
              </section>
            );
          })}

          {shown.strengths.length > 0 ? (
            <section className="card" style={{ marginTop: 'var(--s-4)' }}>
              <h3 className="card-title">What it already does well</h3>
              <ul className="list" style={{ marginTop: 'var(--s-2)' }}>
                {shown.strengths.map((strength) => (
                  <li key={strength}>{strength}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="hint" style={{ marginTop: 'var(--s-4)' }}>
            This is a first pass, not a verdict — it says nothing about whether you will be
            funded, because it cannot know.
            {shown.discarded > 0
              ? ` ${shown.discarded} finding${shown.discarded === 1 ? '' : 's'} quoted wording your application does not contain, so ${shown.discarded === 1 ? 'it was' : 'they were'} dropped.`
              : ''}
          </p>
        </div>
      )}
    </section>
  );
}
