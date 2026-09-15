'use client';

import { useActionState, useState } from 'react';
import type { ClaimStanding } from '@/domain/provenance/facts';
import { countWords } from '@/domain/questions/words';

import { draftAnswerAction, saveOwnAnswerAction } from './actions';
import { EMPTY_DRAFT, EMPTY_WRITE } from './state';
import { CopyButton } from './CopyButton';

export interface QuestionView {
  id: string;
  position: number;
  question: string;
  wordLimit: number | null;
  assesses: string | null;
  answer: string | null;
  wordCount: number;
  /**
   * Provenance from the last saved draft.
   *
   * `standing` is resolved against the fact base by the caller — the page or
   * the draft action, both through `claimStanding` — so this component never
   * decides for itself what counts as unsupported. It used to, from `factId
   * === null` alone, and contradicted the action in the same card.
   */
  claims: Array<{ text: string; factId: string | null; standing?: ClaimStanding }>;
}

/**
 * Only what is genuinely standing on nothing.
 *
 * This counted every `factId === null` — so a linking sentence, which the
 * Writer is INSTRUCTED to leave uncited because it asserts nothing factual,
 * was reported as unsupported, highlighted, and added to the copy button's
 * count. Meanwhile `groundClaims` skipped those sentences, so the action
 * said "every claim traced to a confirmed fact" in the same card. It would
 * have happened on nearly every real draft, because prose has joins in it.
 *
 * `standing` is resolved against the fact base by whoever supplied these
 * claims — the page or the draft action, both through `claimStanding`.
 */
function standingOf(claim: {
  factId: string | null;
  standing?: ClaimStanding;
}): ClaimStanding {
  return claim.standing ?? (claim.factId === null ? 'no_claim' : 'supported');
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
  const [written, save, saving] = useActionState(saveOwnAnswerAction, EMPTY_WRITE);
  const result = state.questionId === question.id ? state : null;
  const saved = written.questionId === question.id ? written : null;

  /**
   * What is in the box.
   *
   * Seeded from what is stored and then owned by the person typing, so the
   * counter moves as they write rather than after a round trip. A draft
   * arriving from the Writer replaces it — that is a new answer for this
   * question, and leaving stale text in the box under a fresh draft is how
   * somebody pastes the wrong one into a portal.
   */
  const [text, setText] = useState(question.answer ?? '');
  const [draftShown, setDraftShown] = useState<string | null>(null);
  const drafted = result?.ok === true ? result.claims.map((c) => c.text).join(' ') : null;
  if (drafted !== null && drafted !== draftShown) {
    setDraftShown(drafted);
    setText(drafted);
  }

  // Prefer the provenance from the draft just produced, falling back to what
  // was stored the last time this question was answered. A saved answer of
  // one's own has none, and clears what was there — see `saveOwnAnswerAction`.
  const claims =
    saved?.ok === true
      ? []
      : result?.ok && result.claims.length > 0
        ? result.claims
        : question.claims.map((c) => ({ ...c, factLabel: null }));

  // The box is the truth about the answer's length once anybody has typed in
  // it, and `countWords` is the same function the Writer checks its own draft
  // against — so the number here and the number in its verdict cannot differ.
  const words = countWords(text);
  const overLimit = question.wordLimit !== null && words > question.wordLimit;

  // What actually goes on the clipboard: the prose alone, no markers.
  const answerText = text;
  const unsupportedCount = claims.filter((c) => standingOf(c) === 'unsupported').length;

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

      <form action={save} style={{ marginTop: 'var(--s-4)' }}>
        <input type="hidden" name="questionId" value={question.id} />
        <input type="hidden" name="applicationId" value={applicationId} />
        <div className="field">
          <label className="label" htmlFor={`answer-${question.id}`}>
            Your answer
          </label>
          <textarea
            className="input"
            id={`answer-${question.id}`}
            name="content"
            onChange={(event) => setText(event.target.value)}
            placeholder="Write it in your own words, or have it drafted below and edit what comes back."
            rows={8}
            value={text}
          />
          <div className="row" style={{ marginTop: 'var(--s-3)', gap: 'var(--s-3)' }}>
            <button className="btn btn-primary" disabled={saving} type="submit">
              {saving ? 'Saving…' : 'Save this answer'}
            </button>
            <span className={overLimit ? 'badge badge-negative' : 'badge badge-neutral'}>
              {words}
              {question.wordLimit === null ? ' words' : ` / ${question.wordLimit} words`}
            </span>
          </div>
        </div>
      </form>

      <div aria-live="polite">
        {saved?.message ? (
          <p
            className={`notice ${saved.ok ? 'notice-neutral' : 'notice-caution'}`}
            style={{
              marginTop: 'var(--s-3)',
              color: saved.ok ? 'var(--positive)' : undefined,
              fontWeight: 550,
            }}
          >
            <span aria-hidden="true">{saved.ok ? '✓' : '⚠'}</span>
            <span>{saved.message}</span>
          </p>
        ) : null}
      </div>

      <div className="row" style={{ marginTop: 'var(--s-4)', gap: 'var(--s-3)' }}>
        <form action={draft}>
          <input type="hidden" name="questionId" value={question.id} />
          <input type="hidden" name="applicationId" value={applicationId} />
          <button className="btn btn-secondary" type="submit" disabled={drafting}>
            {drafting ? 'Writing…' : question.answer ? 'Draft again' : 'Draft from my facts'}
          </button>
        </form>
        <span className="hint">
          A draft lands in the box above for you to edit. Tracing each sentence to a
          confirmed fact only describes what the Writer produced, so saving your own words
          clears it.
        </span>
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
              className={standingOf(claim) === 'unsupported' ? 'claim claim-unsupported' : 'claim'}
              title={
                standingOf(claim) === 'unsupported'
                  ? 'Nothing in your confirmed facts supports this'
                  : standingOf(claim) === 'no_claim'
                    ? 'No factual claim, so nothing to evidence'
                    : `From: ${readable(
                        ('factLabel' in claim && claim.factLabel) || claim.factId || 'a fact',
                      )}`
              }
            >
              {claim.text}{' '}
            </span>
          ))}
        </div>
      ) : null}

      {unsupportedCount > 0 ? (
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
