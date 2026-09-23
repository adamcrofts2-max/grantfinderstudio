'use client';

import { useActionState } from 'react';

import { valueOf } from '@/app/formValues';
import type { WorkQuestion } from '@/domain/provenance/about-the-work';

import { saveAboutTheWorkAction } from './actions';
import { EMPTY_WORK } from './state';

/**
 * What you do, who it is for, and how many you reach.
 *
 * Asked straight after who you are, because setup used to stop there: five
 * confirmed facts, every one of them legal identity, and a Writer declared
 * ready to write about work nobody had described to it.
 *
 * Only the questions still unanswered are asked. A mission already confirmed
 * from the organisation's website is an answer, and asking again for
 * something already held reads as the product not listening.
 */
export function WorkForm({
  questions,
  open = false,
}: {
  questions: readonly WorkQuestion[];
  open?: boolean;
}) {
  const [state, save, saving] = useActionState(saveAboutTheWorkAction, EMPTY_WORK);
  const error = (field: string): string | undefined => state.errors[field];
  const was = (field: string): string => valueOf(state.values, field);

  if (questions.length === 0) return null;

  return (
    <details className="card" id="work" open={open}>
      <summary className="paste-summary">
        <span>Your work</span>
        <span className="chev chev-toggle" aria-hidden="true" />
      </summary>

      <form className="paste-body work-form" action={save}>
        <p className="card-sub">
          Write it the way you would say it to a funder on the phone. A sentence or two each is
          plenty, and you can change any of it later on Your organisation. Leave one blank if
          you would rather come back to it.
        </p>

        {questions.map((question) => (
          <div className="field" style={{ marginTop: 'var(--s-4)' }} key={question.claim}>
            <label className="label" htmlFor={`work-${question.claim}`}>
              {question.question}
            </label>
            <textarea
              id={`work-${question.claim}`}
              className="input"
              name={question.claim}
              rows={question.id === 'how_many' ? 2 : 3}
              placeholder={question.placeholder}
              defaultValue={was(question.claim)}
              aria-describedby={`work-${question.claim}-why`}
              aria-invalid={error(question.claim) === undefined ? undefined : true}
            />
            <p className="hint" id={`work-${question.claim}-why`}>
              {question.why}
            </p>
            {error(question.claim) ? (
              <p className="hint" style={{ color: 'var(--negative)' }} role="alert">
                {error(question.claim)}
              </p>
            ) : null}
          </div>
        ))}

        <button
          className="btn btn-primary"
          type="submit"
          disabled={saving}
          style={{ marginTop: 'var(--s-5)' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>

        {state.message !== '' ? (
          <p
            className={`notice ${state.saved ? 'notice-neutral' : 'notice-caution'}`}
            style={{ marginTop: 'var(--s-4)' }}
            role={state.saved ? 'status' : 'alert'}
          >
            {state.saved ? null : <span aria-hidden="true">⚠</span>}
            <span>{state.message}</span>
          </p>
        ) : null}
      </form>
    </details>
  );
}
