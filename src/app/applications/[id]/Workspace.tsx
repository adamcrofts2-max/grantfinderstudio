'use client';

import { useActionState } from 'react';
import { draftAnswerAction } from './actions';
import { EMPTY_DRAFT } from './state';
import { CopyButton } from './CopyButton';

export interface QuestionView {
  id: string;
  position: number;
  question: string;
  wordLimit: number | null;
  assesses: string | null;
  answer: string | null;
  wordCount: number;
  /** Provenance from the last saved draft. */
  claims: Array<{ text: string; factId: string | null }>;
}

function readable(claim: string): string {
  return claim.replaceAll('_', ' ');
}

function Question({
  applicationId,
  question,
}: {
  applicationId: string;
  question: QuestionView;
}) {
  const [state, draft, drafting] = useActionState(draftAnswerAction, EMPTY_DRAFT);
  const result = state.questionId === question.id ? state : null;

  // Prefer the provenance from the draft just produced, falling back to what
  // was stored the last time this question was answered.
  const claims =
    result?.ok && result.claims.length > 0
      ? result.claims
      : question.claims.map((c) => ({ ...c, factLabel: null }));

  const words = result?.ok ? result.wordCount : question.wordCount;
  const overLimit = question.wordLimit !== null && words > question.wordLimit;

  // What actually goes on the clipboard: the prose alone, no markers.
  const answerText =
    claims.length > 0 ? claims.map((c) => c.text).join(' ') : (question.answer ?? '');
  const unsupportedCount = claims.filter((c) => c.factId === null).length;

  return (
    <section className="card">
      <p className="eyebrow">Question {question.position}</p>
      <h2 className="card-title" style={{ marginTop: 'var(--s-2)' }}>
        {question.question}
      </h2>

      {question.assesses ? (
        <p className="assesses">
          <strong>What they are really asking:</strong> {question.assesses}
        </p>
      ) : null}

      <div className="row" style={{ marginTop: 'var(--s-3)', gap: 'var(--s-3)' }}>
        <form action={draft}>
          <input type="hidden" name="questionId" value={question.id} />
          <input type="hidden" name="applicationId" value={applicationId} />
          <button className="btn btn-primary" type="submit" disabled={drafting}>
            {drafting ? 'Writing…' : question.answer ? 'Draft again' : 'Draft from my facts'}
          </button>
        </form>
        {question.wordLimit === null ? null : (
          <span className={overLimit ? 'badge badge-negative' : 'badge badge-neutral'}>
            {words} / {question.wordLimit} words
          </span>
        )}
      </div>

      <div aria-live="polite">
        {result?.message ? (
          <p
            className={`notice ${result.ok ? 'notice-neutral' : 'notice-caution'}`}
            style={{
              marginTop: 'var(--s-3)',
              color: result.ok ? 'var(--positive)' : undefined,
              fontWeight: 550,
            }}
          >
            <span aria-hidden="true">{result.ok ? '✓' : '⚠'}</span>
            <span>{result.message}</span>
          </p>
        ) : null}
      </div>

      {answerText !== '' ? (
        <div className="row" style={{ marginTop: 'var(--s-4)' }}>
          <CopyButton
            text={answerText}
            unsupportedCount={unsupportedCount}
            variant="primary"
          />
          <span className="hint">Plain text, ready to paste into the funder’s form.</span>
        </div>
      ) : null}

      {claims.length > 0 ? (
        <div className="answer">
          {claims.map((claim, index) => (
            <span
              key={`${question.id}-${index}`}
              className={claim.factId === null ? 'claim claim-unsupported' : 'claim'}
              title={
                claim.factId === null
                  ? 'Nothing in your confirmed facts supports this'
                  : `From: ${readable(('factLabel' in claim && claim.factLabel) || claim.factId)}`
              }
            >
              {claim.text}{' '}
            </span>
          ))}
        </div>
      ) : question.answer ? (
        <div className="answer">{question.answer}</div>
      ) : null}

      {claims.some((c) => c.factId === null) ? (
        <p className="notice notice-caution" style={{ marginTop: 'var(--s-2)' }}>
          <span aria-hidden="true">⚠</span>
          <span>
            Highlighted sentences have nothing behind them. Either evidence them or take them
            out — an assessor will ask.
          </span>
        </p>
      ) : null}

      {result?.gaps && result.gaps.length > 0 ? (
        <div className="gaps">
          <h3>It needs these from you</h3>
          <ul>
            {result.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function Workspace({
  applicationId,
  questions,
}: {
  applicationId: string;
  questions: QuestionView[];
}) {
  return (
    <>
      {questions.map((question) => (
        <Question key={question.id} applicationId={applicationId} question={question} />
      ))}
    </>
  );
}
