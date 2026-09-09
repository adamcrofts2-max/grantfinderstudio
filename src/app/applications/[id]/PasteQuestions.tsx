'use client';

import { useActionState, useState } from 'react';
import { parseQuestions, type ParsedQuestion } from '@/domain/questions/parse';
import { addQuestionsAction } from './actions';
import { EMPTY_ADD } from './state';

/**
 * Paste questions straight out of a funder's portal.
 *
 * Parsing runs here in the browser — the parser is pure, so the applicant sees
 * what was detected as they type and can fix it before anything is saved. A
 * misparse then costs an edit rather than a wrong draft.
 */
export function PasteQuestions({
  applicationId,
  open = false,
}: {
  applicationId: string;
  /** Open when it is the only thing to do — see the page's empty state. */
  open?: boolean;
}) {
  const [pasted, setPasted] = useState('');
  const [edits, setEdits] = useState<Record<number, number | null>>({});
  const [state, add, adding] = useActionState(addQuestionsAction, EMPTY_ADD);

  // Applying the user's word-limit corrections over what was detected. The
  // parser returns a fresh array each keystroke, so assigning in place is safe.
  const detected: ParsedQuestion[] = parseQuestions(pasted).map((q) => {
    if (q.position in edits) q.wordLimit = edits[q.position] ?? null;
    return q;
  });

  const missingLimits = detected.filter((q) => q.wordLimit === null).length;

  return (
    <details className="card paste" open={open}>
      <summary className="paste-summary">
        <span>Add questions from the funder’s form</span>
        <span className="chev chev-toggle" aria-hidden="true" />
      </summary>

      <div className="paste-body">
        <div className="field">
          <label className="label" htmlFor="pasted">
            Paste the questions
          </label>
          <textarea
            id="pasted"
            className="input"
            rows={7}
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
              setEdits({});
            }}
            placeholder={'1. Tell us about your organisation. (Max 200 words)\n2. What need does your project address? (250 words)'}
            aria-describedby="paste-hint"
          />
          <p className="hint" id="paste-hint">
            Copy them straight out of the funder’s portal — numbering, word limits and all.
            We pull out the word limits because drafting without them is drafting blind.
          </p>
        </div>

        {detected.length > 0 ? (
          <>
            <p className="eyebrow" style={{ marginTop: 'var(--s-4)' }}>
              {detected.length} question{detected.length === 1 ? '' : 's'} found
              {missingLimits > 0
                ? ` · ${missingLimits} without a word limit`
                : ' · all with word limits'}
            </p>

            <ul className="detected">
              {detected.map((q) => (
                <li key={q.position}>
                  <p className="detected-q">{q.question}</p>
                  {q.guidance ? <p className="detected-g">{q.guidance}</p> : null}
                  <div className="row" style={{ marginTop: 'var(--s-2)' }}>
                    <label className="hint" htmlFor={`wl-${q.position}`}>
                      Word limit
                    </label>
                    <input
                      id={`wl-${q.position}`}
                      className="input input-narrow"
                      type="number"
                      min={10}
                      max={5000}
                      value={q.wordLimit ?? ''}
                      placeholder="none"
                      onChange={(e) =>
                        setEdits((prev) => ({
                          ...prev,
                          [q.position]: e.target.value === '' ? null : Number(e.target.value),
                        }))
                      }
                    />
                    {q.wordLimit === null ? (
                      <span className="badge badge-caution">
                        <span aria-hidden="true">?</span>none found
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            <form action={add} style={{ marginTop: 'var(--s-4)' }}>
              <input type="hidden" name="applicationId" value={applicationId} />
              <input type="hidden" name="questions" value={JSON.stringify(detected)} />
              <button className="btn btn-primary" type="submit" disabled={adding}>
                {adding
                  ? 'Adding…'
                  : `Add ${detected.length} question${detected.length === 1 ? '' : 's'}`}
              </button>
            </form>
          </>
        ) : null}

        <div aria-live="polite">
          {state.message ? (
            <p
              className={`notice ${state.ok ? 'notice-neutral' : 'notice-caution'}`}
              style={{ marginTop: 'var(--s-3)', color: state.ok ? 'var(--positive)' : undefined, fontWeight: 550 }}
            >
              <span aria-hidden="true">{state.ok ? '✓' : '⚠'}</span>
              <span>{state.message}</span>
            </p>
          ) : null}
        </div>
      </div>
    </details>
  );
}
