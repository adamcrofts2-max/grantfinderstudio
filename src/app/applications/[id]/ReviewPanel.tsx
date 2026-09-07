'use client';

import { useActionState } from 'react';

import { reviewApplicationAction } from './actions';
import { EMPTY_REVIEW, findingLabel, SEVERITY_LABEL } from './state';

/**
 * Review the whole application before it goes in.
 *
 * Deliberately framed as a first pass, not a verdict. It is the free step
 * before a person reads it: the machine takes the structural faults so that
 * whoever reads it next — a trustee, a colleague, later a paid bid writer —
 * spends their time on judgement instead of on things arithmetic can catch.
 */
export function ReviewPanel({ applicationId }: { applicationId: string }) {
  const [state, review, reviewing] = useActionState(reviewApplicationAction, EMPTY_REVIEW);

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
          <button className="btn btn-primary" type="submit" disabled={reviewing}>
            {reviewing ? 'Reading it…' : 'Review the application'}
          </button>
        </form>
        <form action={review}>
          <input type="hidden" name="applicationId" value={applicationId} />
          <input type="hidden" name="mode" value="red_team" />
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

      {state.ok === true ? (
        <div style={{ marginTop: 'var(--s-5)' }}>
          <p className="headline" style={{ fontWeight: 600 }}>
            {state.mode === 'red_team' ? 'Read sceptically. ' : ''}
            {state.message}
          </p>

          {state.injected.length > 0 ? (
            <p className="notice notice-caution" style={{ marginTop: 'var(--s-3)' }}>
              <span aria-hidden="true">⚠</span>
              <span>
                {state.injected.length} passage
                {state.injected.length === 1 ? '' : 's'} in this application tried to instruct the
                reviewer. That was ignored, but it is worth knowing it is in there.
              </span>
            </p>
          ) : null}

          {state.mostImportant === null ? null : (
            <p className="notice notice-neutral" style={{ marginTop: 'var(--s-3)' }}>
              <span>
                <strong>If you only change one thing: </strong>
                {state.mostImportant}
              </span>
            </p>
          )}

          {state.findings.map((finding, index) => {
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

          {state.strengths.length > 0 ? (
            <section className="card" style={{ marginTop: 'var(--s-4)' }}>
              <h3 className="card-title">What it already does well</h3>
              <ul className="list" style={{ marginTop: 'var(--s-2)' }}>
                {state.strengths.map((strength) => (
                  <li key={strength}>{strength}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="hint" style={{ marginTop: 'var(--s-4)' }}>
            This is a first pass, not a verdict — it says nothing about whether you will be
            funded, because it cannot know.
            {state.discarded > 0
              ? ` ${state.discarded} finding${state.discarded === 1 ? '' : 's'} quoted wording your application does not contain, so ${state.discarded === 1 ? 'it was' : 'they were'} dropped.`
              : ''}
          </p>
        </div>
      ) : null}
    </section>
  );
}
