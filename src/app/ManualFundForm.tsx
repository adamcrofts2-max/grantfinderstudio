'use client';

import { useActionState } from 'react';

import { DEADLINE_KINDS } from '@/domain/opportunity/manual';
import { JURISDICTIONS } from '@/domain/types';
import { NO_VALUES, selectKey, valueOf, type FormValues } from '@/app/formValues';

export const MANUAL_FUND_FIELDS = [
  'funderName',
  'title',
  'sourceUrl',
  'minAmountGbp',
  'maxAmountGbp',
  'deadlineKind',
  'deadline',
  'jurisdiction',
  'summary',
] as const;

export interface ManualFundFormState {
  saved: boolean;
  message: string;
  errors: Record<string, string>;
  /** What was typed, so a rejected form is not handed back empty. */
  values: FormValues;
}

export const EMPTY_MANUAL_FUND: ManualFundFormState = {
  saved: false,
  message: '',
  errors: {},
  values: NO_VALUES,
};

const JURISDICTION_LABEL: Record<string, string> = {
  england: 'England',
  wales: 'Wales',
  scotland: 'Scotland',
  northern_ireland: 'Northern Ireland',
  uk_wide: 'Anywhere in the UK',
};

const DEADLINE_LABEL: Record<string, string> = {
  confirmed: 'The funder published this date',
  expected: 'Expected, from what they have said',
  estimated: 'My estimate',
  rolling: 'No deadline — applications are rolling',
  unknown: 'I do not know yet',
};

/**
 * Entering a fund by hand.
 *
 * The same six fields wherever it appears: a CIC adding a fund to their own
 * list, and an operator adding one to the shared catalogue. Only two are
 * required, because a form that demands the amounts before it will save
 * anything is a form people abandon at the funder's website — and an unknown
 * is reported as unknown here rather than guessed at.
 *
 * The action arrives as a prop so the two callers can write to different
 * places without a second copy of the form drifting away from this one.
 */
export function ManualFundForm({
  action,
  submitLabel,
  initial,
}: {
  action: (
    previous: ManualFundFormState,
    formData: FormData,
  ) => Promise<ManualFundFormState>;
  submitLabel: string;
  initial: ManualFundFormState;
}) {
  const [state, submit, saving] = useActionState(action, initial);
  const error = (field: string): string | undefined => state.errors[field];
  const was = (field: string): string => valueOf(state.values, field);

  const problem = (field: string) =>
    error(field) === undefined ? null : (
      <p className="hint" style={{ color: 'var(--negative)' }} id={`${field}-error`}>
        {error(field)}
      </p>
    );

  return (
    <form action={submit}>
      <div className="field">
        <label className="label" htmlFor="funderName">Who is offering it</label>
        <input
          id="funderName"
          className="input"
          name="funderName"
          placeholder="The Wells Trust"
          aria-invalid={error('funderName') !== undefined}
          aria-describedby={error('funderName') === undefined ? undefined : 'funderName-error'}
          required
          defaultValue={was('funderName')}
        />
        <p className="hint">The trust, foundation, council or company behind the money.</p>
        {problem('funderName')}
      </div>

      <div className="field" style={{ marginTop: 'var(--s-4)' }}>
        <label className="label" htmlFor="title">What the fund is called</label>
        <input
          id="title"
          className="input"
          name="title"
          placeholder="Community Buildings Fund"
          aria-invalid={error('title') !== undefined}
          required
          defaultValue={was('title')}
        />
        <p className="hint">Their name for it, so you recognise it on their website later.</p>
        {problem('title')}
      </div>

      <div className="field" style={{ marginTop: 'var(--s-4)' }}>
        <label className="label" htmlFor="sourceUrl">
          Link to their page <span className="hint">(optional)</span>
        </label>
        <input
          id="sourceUrl"
          className="input"
          name="sourceUrl"
          type="url"
          inputMode="url"
          placeholder="https://example.org/our-grants"
          defaultValue={was('sourceUrl')}
        />
        <p className="hint">So you can go straight back to the guidance when you apply.</p>
        {problem('sourceUrl')}
      </div>

      <div className="row" style={{ marginTop: 'var(--s-4)', alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: '1 1 9rem' }}>
          <label className="label" htmlFor="minAmountGbp">
            Smallest grant <span className="hint">(optional)</span>
          </label>
          <input id="minAmountGbp" className="input" name="minAmountGbp" inputMode="numeric"
            placeholder="5000"
          defaultValue={was('minAmountGbp')}
        />
          {problem('minAmountGbp')}
        </div>
        <div className="field" style={{ flex: '1 1 9rem' }}>
          <label className="label" htmlFor="maxAmountGbp">
            Largest grant <span className="hint">(optional)</span>
          </label>
          <input id="maxAmountGbp" className="input" name="maxAmountGbp" inputMode="numeric"
            placeholder="25000"
          defaultValue={was('maxAmountGbp')}
        />
          {problem('maxAmountGbp')}
        </div>
      </div>
      <p className="hint">
        In pounds. These decide whether what you are asking for is the size this funder
        actually gives.
      </p>

      <div className="field" style={{ marginTop: 'var(--s-4)' }}>
        <label className="label" htmlFor="deadlineKind">The closing date</label>
        <select key={selectKey(state.values, 'deadlineKind')} id="deadlineKind" className="input" name="deadlineKind"
          defaultValue={was('deadlineKind') === '' ? 'unknown' : was('deadlineKind')}>
          {DEADLINE_KINDS.map((kind) => (
            <option key={kind} value={kind}>{DEADLINE_LABEL[kind] ?? kind}</option>
          ))}
        </select>
        <p className="hint">
          Kept apart from the date itself, so an estimate can never be shown as though the
          funder published it.
        </p>
      </div>

      <div className="field" style={{ marginTop: 'var(--s-4)' }}>
        <label className="label" htmlFor="deadline">
          Date <span className="hint">(leave blank if there is none)</span>
        </label>
        <input id="deadline" className="input" name="deadline" type="date"
          aria-invalid={error('deadline') !== undefined}
          defaultValue={was('deadline')}
        />
        <p className="hint">Use the calendar button — the typed order follows your browser.</p>
        {problem('deadline')}
      </div>

      <div className="field" style={{ marginTop: 'var(--s-4)' }}>
        <label className="label" htmlFor="jurisdiction">
          Where they fund <span className="hint">(optional)</span>
        </label>
        <select key={selectKey(state.values, 'jurisdiction')} id="jurisdiction" className="input" name="jurisdiction"
          defaultValue={was('jurisdiction')}>
          <option value="">Not sure</option>
          {JURISDICTIONS.map((j) => (
            <option key={j} value={j}>{JURISDICTION_LABEL[j] ?? j}</option>
          ))}
        </select>
        {problem('jurisdiction')}
      </div>

      <div className="field" style={{ marginTop: 'var(--s-4)' }}>
        <label className="label" htmlFor="summary">
          Anything worth remembering <span className="hint">(optional)</span>
        </label>
        <textarea id="summary" className="input" name="summary" rows={3}
          defaultValue={was('summary')}
          placeholder="Only for capital work. They said to ring first." />
      </div>

      <button className="btn btn-primary" type="submit" disabled={saving}
        style={{ marginTop: 'var(--s-5)' }}>
        {saving ? 'Saving…' : submitLabel}
      </button>

      {state.message === '' ? null : (
        <p
          className={`notice ${state.saved ? 'notice-neutral' : 'notice-caution'}`}
          style={{ marginTop: 'var(--s-4)' }}
          role={state.saved ? 'status' : 'alert'}
        >
          {state.saved ? null : <span aria-hidden="true">⚠</span>}
          <span>{state.message}</span>
        </p>
      )}
    </form>
  );
}
