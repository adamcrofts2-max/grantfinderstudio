'use client';

import { useActionState } from 'react';

import type { EffectiveSetting } from '@/settings/registry';

import { saveSettingAction } from './actions';
import { EMPTY_SETTING_ACTION } from './state';

const SOURCE_NOTE: Record<string, string> = {
  database: 'Set here.',
  environment: 'From the hosting environment. Saving here overrides it.',
  default: 'The built-in default.',
};

/**
 * One operational setting.
 *
 * The SOURCE is shown next to the value and is the point of this component.
 * Database beats environment beats default, and an operator who cannot see
 * which is in force will eventually change the wrong one and conclude the
 * product is broken.
 */
export function SettingForm({ setting }: { setting: EffectiveSetting }) {
  const [state, submit, saving] = useActionState(saveSettingAction, EMPTY_SETTING_ACTION);
  const mine = state.key === setting.definition.key;

  return (
    <form action={submit} className="setting">
      <input type="hidden" name="key" value={setting.definition.key} />
      <div className="setting-head">
        <label className="label" htmlFor={`s-${setting.definition.key}`}>
          {setting.definition.label}
        </label>
        <span className={`badge ${setting.source === 'database' ? 'badge-accent' : 'badge-neutral'}`}>
          {setting.source === 'database' ? 'Set here' : setting.source === 'environment' ? 'From environment' : 'Default'}
        </span>
      </div>
      <p className="hint">{setting.definition.help}</p>

      <div className="row" style={{ marginTop: 'var(--s-3)', flexWrap: 'nowrap' }}>
        <input
          id={`s-${setting.definition.key}`}
          className={`input ${setting.definition.kind === 'url' ? 'input-mono' : 'input-narrow'}`}
          name="value"
          defaultValue={setting.source === 'database' ? setting.value : ''}
          placeholder={setting.value}
          inputMode={setting.definition.kind === 'integer' ? 'numeric' : 'url'}
        />
        <button className="btn btn-secondary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <p className="hint" style={{ marginTop: 'var(--s-2)' }}>
        {SOURCE_NOTE[setting.source]} In force: <code>{setting.value}</code>
        {setting.source === 'database' ? ' — clear the box and save to go back.' : ''}
      </p>

      {mine && state.message !== '' ? (
        <p
          className={`hint ${state.ok ? '' : 'setting-problem'}`}
          role={state.ok ? 'status' : 'alert'}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
