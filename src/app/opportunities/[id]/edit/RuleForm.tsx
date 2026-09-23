'use client';

import { useActionState, useId, useState } from 'react';

import { valueOf } from '@/app/formValues';
import {
  CIC_TREATMENT_CHOICE,
  HAND_RULE_KINDS,
  HAND_RULE_QUESTION,
  isHandRuleKind,
  type HandRuleKind,
} from '@/domain/eligibility/hand-rule';
import { CIC_TREATMENTS, JURISDICTIONS } from '@/domain/types';

import { addRuleAction } from './actions';
import { EMPTY_RULE } from './state';

const NATION_LABEL: Record<string, string> = {
  england: 'England',
  wales: 'Wales',
  scotland: 'Scotland',
  northern_ireland: 'Northern Ireland',
  uk_wide: 'Anywhere in the UK',
};

/** The two ends of a range, in the words that fit each kind. */
const RANGE_WORDS: Partial<Record<HandRuleKind, { min: string; max: string; hint: string; money: boolean }>> = {
  amount: {
    min: 'Smallest grant',
    max: 'Largest grant',
    hint: 'In pounds. Leave an end blank if they do not give one.',
    money: true,
  },
  turnover: {
    min: 'Smallest annual income they fund',
    max: 'Largest annual income they fund',
    hint: 'In pounds — usually a ceiling, such as “organisations with income under £500,000”.',
    money: true,
  },
  duration: {
    min: 'Shortest project, in months',
    max: 'Longest project, in months',
    hint: 'Whole months. Two years is 24.',
    money: false,
  },
};

/**
 * Add a rule from the funder's guidance.
 *
 * One kind at a time, and only that kind's fields on screen: a form showing
 * every term of every kind at once is a tax return. Choosing the kind is the
 * person reading the guidance and saying what it is about; the fields are the
 * terms of that one rule, checked for completeness before anything is saved.
 */
export function RuleForm({
  opportunityId,
  beneficiaryChoices,
}: {
  opportunityId: string;
  beneficiaryChoices: readonly string[];
}) {
  const [state, save, saving] = useActionState(addRuleAction, EMPTY_RULE);
  const initialKind = valueOf(state.values, 'kind');
  const [kind, setKind] = useState<HandRuleKind>(
    isHandRuleKind(initialKind) ? initialKind : 'legal_form',
  );
  const uid = useId();
  const fid = (field: string): string => `${uid}-${field}`;
  const error = (field: string): string | undefined => state.errors[field];
  const was = (field: string): string => valueOf(state.values, field);
  const problem = (field: string) =>
    error(field) === undefined ? null : (
      <p className="hint" style={{ color: 'var(--negative)' }} id={`${fid(field)}-error`} role="alert">
        {error(field)}
      </p>
    );
  const range = RANGE_WORDS[kind];

  return (
    <form action={save} className="rule-form">
      <input type="hidden" name="opportunityId" value={opportunityId} />

      <div className="field">
        <label className="label" htmlFor={fid('kind')}>What the rule is about</label>
        <select
          id={fid('kind')}
          className="input"
          name="kind"
          value={kind}
          onChange={(event) => {
            if (isHandRuleKind(event.target.value)) setKind(event.target.value);
          }}
        >
          {HAND_RULE_KINDS.map((k) => (
            <option key={k} value={k}>{HAND_RULE_QUESTION[k]}</option>
          ))}
        </select>
        {problem('kind')}
      </div>

      {kind === 'legal_form' ? (
        <fieldset className="field rule-choices">
          <legend className="label">What the guidance says</legend>
          {CIC_TREATMENTS.map((treatment) => (
            <label key={treatment} className="rule-choice">
              <input
                type="radio"
                name="cicTreatment"
                value={treatment}
                defaultChecked={was('cicTreatment') === treatment}
              />
              {CIC_TREATMENT_CHOICE[treatment]}
            </label>
          ))}
          {problem('cicTreatment')}
          <label className="label" htmlFor={fid('conditions')} style={{ marginTop: 'var(--s-3)' }}>
            The conditions <span className="hint">(if there are any)</span>
          </label>
          <input
            id={fid('conditions')}
            className="input"
            name="conditions"
            placeholder="An asset lock in your articles"
            defaultValue={was('conditions')}
          />
          {problem('conditions')}
        </fieldset>
      ) : null}

      {kind === 'organisation_age' ? (
        <div className="field">
          <label className="label" htmlFor={fid('minYears')}>At least how many years</label>
          <input
            id={fid('minYears')}
            className="input input-short"
            name="minYears"
            inputMode="decimal"
            placeholder="2"
            defaultValue={was('minYears')}
          />
          <p className="hint">Often phrased as “two years of accounts”. Half years are fine: 1.5.</p>
          {problem('minYears')}
        </div>
      ) : null}

      {kind === 'jurisdiction' ? (
        <fieldset className="field rule-choices">
          <legend className="label">Where they fund</legend>
          {JURISDICTIONS.map((nation) => (
            <label key={nation} className="rule-choice">
              <input type="checkbox" name="nations" value={nation} />
              {NATION_LABEL[nation] ?? nation}
            </label>
          ))}
          {problem('nations')}
        </fieldset>
      ) : null}

      {kind === 'region' ? (
        <div className="field">
          <label className="label" htmlFor={fid('regions')}>The areas they fund</label>
          <input
            id={fid('regions')}
            className="input"
            name="regions"
            placeholder="Somerset, Devon, Dorset"
            defaultValue={was('regions')}
          />
          <p className="hint">
            Separated by commas, named the way your own area is named on Your organisation — that
            is what they are compared against.
          </p>
          {problem('regions')}
        </div>
      ) : null}

      {kind === 'beneficiary' ? (
        <fieldset className="field rule-choices">
          <legend className="label">Who they fund work for</legend>
          <p className="hint">
            The same groups your project is described with, so the two can be matched. Tick any
            the guidance names.
          </p>
          {beneficiaryChoices.map((group) => (
            <label key={group} className="rule-choice">
              <input type="checkbox" name="groups" value={group} />
              {group}
            </label>
          ))}
          {problem('groups')}
        </fieldset>
      ) : null}

      {range === undefined ? null : (
        <>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: '1 1 10rem' }}>
              <label className="label" htmlFor={fid('min')}>
                {range.min} <span className="hint">(optional)</span>
              </label>
              <input
                id={fid('min')}
                className="input"
                name="min"
                inputMode="numeric"
                placeholder={range.money ? '1000' : '6'}
                defaultValue={was('min')}
              />
              {problem('min')}
            </div>
            <div className="field" style={{ flex: '1 1 10rem' }}>
              <label className="label" htmlFor={fid('max')}>
                {range.max} <span className="hint">(optional)</span>
              </label>
              <input
                id={fid('max')}
                className="input"
                name="max"
                inputMode="numeric"
                placeholder={range.money ? '25000' : '24'}
                defaultValue={was('max')}
              />
              {problem('max')}
            </div>
          </div>
          <p className="hint">{range.hint}</p>
        </>
      )}

      {kind === 'capital_revenue' ? (
        <fieldset className="field rule-choices">
          <legend className="label">What they will pay for</legend>
          <label className="rule-choice">
            <input type="checkbox" name="spend" value="capital" />
            Capital — building work, equipment, vehicles
          </label>
          <label className="rule-choice">
            <input type="checkbox" name="spend" value="revenue" />
            Running costs — staff, sessions, delivery
          </label>
          {problem('spend')}
        </fieldset>
      ) : null}

      {kind === 'match_funding' ? (
        <p className="hint">
          Adds “Match funding required”. You will be asked whether you have it — a rule that only
          said it was not required could never rule anybody out, so there is nothing to add for
          that.
        </p>
      ) : null}

      <div className="field">
        <label className="label" htmlFor={fid('sourceSpan')}>
          Their words <span className="hint">(optional)</span>
        </label>
        <textarea
          id={fid('sourceSpan')}
          className="input"
          name="sourceSpan"
          rows={2}
          placeholder="Paste the sentence from their guidance, so you can check it later."
          defaultValue={was('sourceSpan')}
        />
        {problem('sourceSpan')}
      </div>

      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? 'Adding…' : 'Add this rule'}
      </button>

      {state.message === '' ? null : (
        <p
          className={`notice ${state.saved ? 'notice-neutral' : 'notice-caution'}`}
          role={state.saved ? 'status' : 'alert'}
        >
          {state.saved ? null : <span aria-hidden="true">⚠</span>}
          <span>{state.message}</span>
        </p>
      )}
    </form>
  );
}
