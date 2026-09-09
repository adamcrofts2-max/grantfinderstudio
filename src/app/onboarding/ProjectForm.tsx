'use client';

import { useActionState } from 'react';

import { selectKey, valueOf } from '@/app/formValues';

import { saveProjectAction } from './actions';
import { BENEFICIARY_CHOICES, EMPTY_PROJECT, SPEND_CHOICES } from './state';

/**
 * What you are trying to fund.
 *
 * Three of the ten criteria the eligibility engine evaluates come from here —
 * amount, duration and beneficiary group — and they are the three that change
 * per application. Without them a fund can only ever be judged on legal form,
 * which is most of the way to no answer at all.
 */
export function ProjectForm({ open = false }: { open?: boolean }) {
  const [state, save, saving] = useActionState(saveProjectAction, EMPTY_PROJECT);
  const error = (field: string): string | undefined => state.errors[field];
  const was = (field: string): string => valueOf(state.values, field);

  return (
    // Open when this is the step the guide just sent them to. A newcomer told
    // "add your project" and handed a collapsed row labelled "Open" has been
    // let go of at exactly the moment they were being led.
    <details className="card" id="project" open={open}>
      <summary className="paste-summary">
        <span>What you are trying to fund</span>
        <span className="chev chev-toggle" aria-hidden="true" />
      </summary>

      <form className="paste-body" action={save}>
        <p className="card-sub">
          Leave anything blank that you do not know yet. An unknown is reported as unknown
          rather than guessed at — but the more of this we have, the more funds we can rule in
          or out for you.
        </p>

        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <label className="label" htmlFor="projectName">Project name</label>
          <input id="projectName" className="input" name="projectName" required
            placeholder="Green Skills Programme"
              defaultValue={was('projectName')}
            />
          {error('projectName') ? (
            <p className="hint" style={{ color: 'var(--negative)' }}>{error('projectName')}</p>
          ) : null}
        </div>

        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <label className="label" htmlFor="description">
            What it does <span className="hint">(optional)</span>
          </label>
          <textarea id="description" className="input" name="description" rows={3}
            placeholder="A twelve-week practical skills course for young people aged 14 to 19."
            defaultValue={was('description')}
          />
        </div>

        <div className="row" style={{ marginTop: 'var(--s-4)', alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: '1 1 12rem' }}>
            <label className="label" htmlFor="amountSoughtGbp">
              How much you need <span className="hint">(optional)</span>
            </label>
            <input id="amountSoughtGbp" className="input" name="amountSoughtGbp"
              inputMode="numeric" placeholder="25000"
              defaultValue={was('amountSoughtGbp')}
            />
            <p className="hint">In pounds. This decides which funds are the right size.</p>
            {error('amountSoughtGbp') ? (
              <p className="hint" style={{ color: 'var(--negative)' }}>{error('amountSoughtGbp')}</p>
            ) : null}
          </div>

          <div className="field" style={{ flex: '1 1 10rem' }}>
            <label className="label" htmlFor="durationMonths">
              Over how many months <span className="hint">(optional)</span>
            </label>
            <input id="durationMonths" className="input" name="durationMonths"
              inputMode="numeric" placeholder="12"
              defaultValue={was('durationMonths')}
            />
            {error('durationMonths') ? (
              <p className="hint" style={{ color: 'var(--negative)' }}>{error('durationMonths')}</p>
            ) : null}
          </div>
        </div>

        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <label className="label" htmlFor="capitalOrRevenue">What the money is for</label>
          <select key={selectKey(state.values, 'capitalOrRevenue')} id="capitalOrRevenue" className="input" name="capitalOrRevenue"
            defaultValue={was('capitalOrRevenue')}>
            <option value="">Not sure yet</option>
            {SPEND_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>{choice.label}</option>
            ))}
          </select>
          <p className="hint">Some funders will only pay for one or the other.</p>
        </div>

        <fieldset className="field" style={{ marginTop: 'var(--s-4)', border: 0, padding: 0 }}>
          <legend className="label">Who benefits</legend>
          <p className="hint" style={{ marginBottom: 'var(--s-2)' }}>
            Tick every group that applies. Funders name these groups in their criteria, so this
            is what a match is made against.
          </p>
          <div className="row" style={{ gap: 'var(--s-2) var(--s-4)' }}>
            {BENEFICIARY_CHOICES.map((group) => (
              <label key={group} className="hint" style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
                <input type="checkbox" name="beneficiaries" value={group} />
                {group}
              </label>
            ))}
          </div>
        </fieldset>

        <button className="btn btn-primary" type="submit" disabled={saving}
          style={{ marginTop: 'var(--s-5)' }}>
          {saving ? 'Saving…' : 'Save the project'}
        </button>

        {state.message !== '' ? (
          <p className={`notice ${state.saved ? 'notice-neutral' : 'notice-caution'}`}
            style={{ marginTop: 'var(--s-4)' }} role={state.saved ? 'status' : 'alert'}>
            {state.saved ? null : <span aria-hidden="true">⚠</span>}
            <span>
              {state.message}
              {state.saved ? <> <a href="/">See your opportunities</a>.</> : null}
            </span>
          </p>
        ) : null}
      </form>
    </details>
  );
}
